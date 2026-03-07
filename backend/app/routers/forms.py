from typing import List, Any, Dict, Optional
import json

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Body

from ..db import get_db
from ..services.stt_service import transcribe_audio
from ..deps import require_auth
from ..services.form_service import (
    create_form_template,
    process_form_pipeline,
    create_form_draft,
    finalize_form_draft,
    update_form_draft_payload,
    reextract_form_draft,
)

router = APIRouter(prefix="/api/forms", tags=["forms"])


@router.get("")
async def list_forms(user=Depends(require_auth), db=Depends(get_db)):
    """
    List active form templates for selection in the client.
    """
    cursor = db["form_templates"].find({"status": "active"}).sort([("formType", 1), ("version", -1)])
    docs = await cursor.to_list(length=200)

    return [
        {
            "formType": d.get("formType"),
            "displayName": d.get("displayName"),
            "version": d.get("version"),
            "templateImageUrls": d.get("templateImageUrls", []),  # in this demo we return paths, but these could be public URLs in a real app
            "createdAt": d.get("createdAt"),
        }
        for d in docs
    ]


@router.get("/{form_type}")
async def get_form(form_type: str, user=Depends(require_auth), db=Depends(get_db)):
    doc = await db["form_templates"].find_one(
        {"formType": form_type, "status": "active"},
        sort=[("version", -1)]
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Template not found")

    return {
        "formType": doc.get("formType"),
        "displayName": doc.get("displayName"),
        "version": doc.get("version"),
        "templateImageUrls": doc.get("templateImageUrls", []),
        "jsonSchema": doc.get("jsonSchema", {}),
        "promptSpec": doc.get("promptSpec", {}),
        "createdAt": doc.get("createdAt"),
    }

@router.post("/templates")
async def upload_template(
    formType: str = Form(...),
    displayName: str = Form(...),
    version: int = Form(...),
    jsonSchema: str = Form(...),
    templateImages: list[UploadFile] = File(...),
    user=Depends(require_auth),
):
    imgs = []
    for img in templateImages:
        b = await img.read()
        imgs.append((img.filename, b))

    return await create_form_template(
        form_type=formType,
        display_name=displayName,
        version=version,
        json_schema_str=jsonSchema,
        template_images=imgs,
    )


@router.post("/process")
async def process_form(
    formType: str = Form(...),

    # either audio or transcript
    audio: UploadFile | None = File(default=None),
    transcript: str | None = Form(default=None),

    # optional filled form photo
    filledFormImage: UploadFile | None = File(default=None),
    user=Depends(require_auth),
):
    if not transcript:
        if not audio:
            raise HTTPException(status_code=400, detail="Provide either transcript or audio")

        audio_bytes = await audio.read()
        stt_res = await transcribe_audio(audio=audio_bytes, mime_type=audio.content_type, segment_type="form")
        transcript = stt_res.get("transcript", "")

    filled_bytes = None
    filled_mime = None
    if filledFormImage:
        filled_bytes = await filledFormImage.read()
        filled_mime = filledFormImage.content_type

    return await process_form_pipeline(
        form_type=formType,
        transcript=transcript or "",
        filled_form_image_bytes=filled_bytes,
        filled_form_image_mime=filled_mime,
    )


@router.post("/{form_id}/fill")
async def fill_form_with_transcript(
    form_id: str,
    transcript: str = Form(...),
    filledFormImage: UploadFile | None = File(default=None),
    user=Depends(require_auth),
):
    """
    Fill a specific form using an already-obtained transcript.
    This endpoint is intended to be used together with the STT endpoint,
    where the client first calls /api/stt/transcribe and then passes the
    resulting transcript here.
    """
    filled_bytes = None
    filled_mime = None
    if filledFormImage:
        filled_bytes = await filledFormImage.read()
        filled_mime = filledFormImage.content_type

    # Use the same pipeline, treating form_id as form_type key.
    return await process_form_pipeline(
        form_type=form_id,
        transcript=transcript or "",
        filled_form_image_bytes=filled_bytes,
        filled_form_image_mime=filled_mime,
    )

@router.post("/drafts")
async def create_draft(
    formType: str = Form(...),

    # either audio or transcript (same behavior as /process)
    audio: UploadFile | None = File(default=None),
    transcript: str | None = Form(default=None),

    # optional filled form photo
    filledFormImage: UploadFile | None = File(default=None),

    user=Depends(require_auth),
):
    if not transcript:
        if not audio:
            raise HTTPException(status_code=400, detail="Provide either transcript or audio")

        audio_bytes = await audio.read()
        stt_res = await transcribe_audio(audio=audio_bytes, mime_type=audio.content_type, segment_type="form")
        transcript = stt_res.get("transcript", "")

    filled_bytes = None
    filled_mime = None
    if filledFormImage:
        filled_bytes = await filledFormImage.read()
        filled_mime = filledFormImage.content_type

    return await create_form_draft(
        form_type=formType,
        transcript=transcript or "",
        filled_form_image_bytes=filled_bytes,
        filled_form_image_mime=filled_mime,
    )


@router.get("/drafts/{draft_id}")
async def get_draft(
    draft_id: str,
    user=Depends(require_auth),
    db=Depends(get_db),
):
    draft = await db["form_drafts"].find_one({"draftId": draft_id})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    # keep response clean
    return {
        "draftId": draft.get("draftId"),
        "formType": draft.get("formType"),
        "templateVersion": draft.get("templateVersion"),
        "transcript": draft.get("transcript", ""),
        "payload": draft.get("payload", {}),
        "validation": draft.get("validation", {"errors": [], "warnings": []}),
        "status": draft.get("status", "draft"),
        "createdAt": draft.get("createdAt"),
        "updatedAt": draft.get("updatedAt"),
        "runId": draft.get("runId"),
    }


@router.patch("/drafts/{draft_id}")
async def update_draft_payload(
    draft_id: str,
    payload: Dict[str, Any] = Body(...),  # application/json
    user=Depends(require_auth),
):
    # updates ONLY the payload (human edits), revalidates, persists
    return await update_form_draft_payload(
        draft_id=draft_id,
        payload=payload,
    )


@router.post("/drafts/{draft_id}/reextract")
async def reextract_draft(
    draft_id: str,
    # allow user to re-run extraction with updated transcript/audio/image
    audio: UploadFile | None = File(default=None),
    transcript: str | None = Form(default=None),
    filledFormImage: UploadFile | None = File(default=None),

    user=Depends(require_auth),
):
    if not transcript:
        if not audio:
            raise HTTPException(status_code=400, detail="Provide either transcript or audio")

        audio_bytes = await audio.read()
        stt_res = await transcribe_audio(audio=audio_bytes, mime_type=audio.content_type, segment_type="form")
        transcript = stt_res.get("transcript", "")

    filled_bytes = None
    filled_mime = None
    if filledFormImage:
        filled_bytes = await filledFormImage.read()
        filled_mime = filledFormImage.content_type

    return await reextract_form_draft(
        draft_id=draft_id,
        transcript=transcript or "",
        filled_form_image_bytes=filled_bytes,
        filled_form_image_mime=filled_mime,
    )


@router.post("/drafts/{draft_id}/finalize")
async def finalize_draft(
    draft_id: str,
    # confirmed_payload is optional; if omitted, it finalizes whatever is stored in draft
    confirmed_payload: Optional[Dict[str, Any]] = Body(default=None),
    user=Depends(require_auth),
):
    return await finalize_form_draft(
        draft_id=draft_id,
        confirmed_payload=confirmed_payload,
    )