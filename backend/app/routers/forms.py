from typing import List, Any, Dict, Optional
import json
import re

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Body

from ..db import get_db
from ..services.stt_service import transcribe_audio
from ..deps import require_auth
from ..services.form_service import (
    archive_form_template,
    create_form_template,
    create_form_template_from_wizard,
    preview_blank_form_b64_pages,
    wizard_form_type_from_display,
    process_form_pipeline,
    create_single_form_draft,
    create_form_batch,
    get_form_batch,
    add_draft_to_batch,
    bulk_add_transcript_drafts_to_batch,
    finalize_form_draft,
    finalize_form_batch,
    update_form_draft_payload,
    reextract_form_draft,
    cancel_form_draft,
)
from ..services.filled_form_service import load_filled_form_image_bytes_and_mime

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


@router.post("/templates/preview-pages")
async def templates_preview_pages(
    blankForm: UploadFile = File(...),
    user=Depends(require_auth),
):
    """
    Rasterize a PDF or image into PNG page previews (for the template wizard UI).
    """
    data = await blankForm.read()
    if len(data) > 35 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 35 MB)")
    b64_list = await preview_blank_form_b64_pages(data, blankForm.filename or "upload")
    return {
        "pages": [f"data:image/png;base64,{b}" for b in b64_list],
        "pageCount": len(b64_list),
    }


@router.post("/templates/wizard")
async def templates_wizard(
    blankForm: UploadFile = File(...),
    displayName: str = Form(...),
    formType: str = Form(""),
    version: int = Form(1),
    fieldsJson: str = Form(...),
    fieldRegionsJson: str = Form("[]"),
    user=Depends(require_auth),
):
    """
    Create a template from a blank PDF/image + human-readable field list (no raw JSON for managers).
    """
    data = await blankForm.read()
    if len(data) > 35 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 35 MB)")
    dn = (displayName or "").strip()
    if not dn:
        raise HTTPException(status_code=400, detail="Display name is required")
    ft = (formType or "").strip().lower()
    ft = re.sub(r"[^a-z0-9_]", "", ft.replace("-", "_"))
    if not ft:
        ft = wizard_form_type_from_display(dn)
    try:
        fields = json.loads(fieldsJson)
    except Exception:
        raise HTTPException(status_code=400, detail="fieldsJson must be a valid JSON array")
    if not isinstance(fields, list):
        raise HTTPException(status_code=400, detail="fieldsJson must be a JSON array")
    try:
        regions = json.loads(fieldRegionsJson or "[]")
    except Exception:
        regions = []
    if not isinstance(regions, list):
        regions = []
    return await create_form_template_from_wizard(
        form_type=ft,
        display_name=dn,
        version=int(version),
        blank_file_bytes=data,
        blank_filename=blankForm.filename or "upload",
        fields=fields,
        field_regions=regions or None,
    )


@router.delete("/templates/{form_type}")
async def delete_form_template(form_type: str, user=Depends(require_auth)):
    """Archive the active template(s) for this form type (removes from workspace list)."""
    return await archive_form_template(form_type=form_type)


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
        filled_bytes, filled_mime = await load_filled_form_image_bytes_and_mime(filledFormImage)

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
        filled_bytes, filled_mime = await load_filled_form_image_bytes_and_mime(filledFormImage)

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
        filled_bytes, filled_mime = await load_filled_form_image_bytes_and_mime(filledFormImage)

    return await create_single_form_draft(
        form_id=formType,
        transcript=transcript or "",
        created_by=user,
        filled_form_image_bytes=filled_bytes,
        filled_form_image_mime=filled_mime,
    )


# --- Multi-submission (batch) API -------------------------------------------------


@router.post("/batches")
async def create_batch(user=Depends(require_auth)):
    """
    Start a batch. Add drafts with POST /batches/{batchId}/drafts (per audio/image)
    or POST .../drafts/bulk-transcripts (many transcripts at once).
    """
    batch = await create_form_batch(created_by=user)
    return {"batchId": batch["batchId"], "createdAt": batch.get("createdAt")}


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str, user=Depends(require_auth)):
    data = await get_form_batch(batch_id)
    b = data["batch"]
    drafts_out = []
    for d in data["drafts"]:
        drafts_out.append(
            {
                "draftId": d.get("draftId"),
                "sequenceNumber": d.get("sequenceNumber"),
                "formType": d.get("formId"),
                "status": d.get("status", "draft"),
                "transcript": d.get("transcript", ""),
                "payload": d.get("payload", {}),
                "validation": {
                    "errors": d.get("validationErrors", []),
                    "warnings": d.get("validationWarnings", []),
                },
                "runId": d.get("runId"),
                "createdAt": d.get("createdAt"),
                "updatedAt": d.get("updatedAt"),
            }
        )
    return {
        "batchId": b.get("batchId"),
        "status": b.get("status"),
        "totalDrafts": b.get("totalDrafts", 0),
        "approvedCount": b.get("approvedCount", 0),
        "finalizedCount": b.get("finalizedCount", 0),
        "drafts": drafts_out,
    }


@router.post("/batches/{batch_id}/drafts")
async def add_draft_to_batch_route(
    batch_id: str,
    formType: str = Form(...),
    audio: UploadFile | None = File(default=None),
    transcript: str | None = Form(default=None),
    filledFormImage: UploadFile | None = File(default=None),
    user=Depends(require_auth),
):
    """Append one extracted draft to a batch (same inputs as POST /drafts)."""
    if not transcript:
        if not audio:
            raise HTTPException(status_code=400, detail="Provide either transcript or audio")
        audio_bytes = await audio.read()
        stt_res = await transcribe_audio(
            audio=audio_bytes, mime_type=audio.content_type, segment_type="form"
        )
        transcript = stt_res.get("transcript", "")

    filled_bytes = None
    filled_mime = None
    if filledFormImage:
        filled_bytes, filled_mime = await load_filled_form_image_bytes_and_mime(filledFormImage)

    doc = await add_draft_to_batch(
        batch_id=batch_id,
        form_id=formType,
        transcript=transcript or "",
        source_type="audio" if audio else "transcript",
        filled_form_image_bytes=filled_bytes,
        filled_form_image_mime=filled_mime,
    )
    return {
        "draftId": doc["draftId"],
        "batchId": doc["batchId"],
        "sequenceNumber": doc["sequenceNumber"],
        "payload": doc.get("payload", {}),
        "validation": {
            "errors": doc.get("validationErrors", []),
            "warnings": doc.get("validationWarnings", []),
        },
    }


@router.post("/batches/{batch_id}/drafts/bulk-transcripts")
async def bulk_transcript_drafts(
    batch_id: str,
    body: Dict[str, Any] = Body(...),
    user=Depends(require_auth),
):
    """
    Body: { "formType": "...", "transcripts": ["...", "..."] }
    Creates one draft per string (no images). Combine with per-draft PATCH/reextract if needed.
    """
    form_type = body.get("formType") or body.get("form_type")
    transcripts = body.get("transcripts")
    if not form_type or not isinstance(transcripts, list):
        raise HTTPException(
            status_code=400,
            detail="JSON body must include formType and transcripts (array of strings)",
        )
    str_list = [t if isinstance(t, str) else "" for t in transcripts]
    return await bulk_add_transcript_drafts_to_batch(
        batch_id=batch_id,
        form_id=form_type,
        transcripts=str_list,
    )


@router.post("/batches/{batch_id}/finalize")
async def finalize_batch_route(
    batch_id: str,
    confirmed_payloads: Optional[Dict[str, Dict[str, Any]]] = Body(default=None),
    user=Depends(require_auth),
):
    """
    Finalize every draft still in status=draft. Optional body maps draftId -> payload overrides.
    Each successful draft produces its own PDF/XML/email run (same as single finalize).
    """
    return await finalize_form_batch(
        batch_id=batch_id,
        confirmed_payloads_by_draft_id=confirmed_payloads,
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
        "formType": draft.get("formId") or draft.get("formType"),
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


@router.delete("/drafts/{draft_id}")
async def cancel_draft(
    draft_id: str,
    user=Depends(require_auth),
):
    """Drop a slot from the batch (will not be finalized)."""
    return await cancel_form_draft(draft_id=draft_id)


@router.post("/drafts/{draft_id}/reextract")
async def reextract_draft(
    draft_id: str,
    # allow user to re-run extraction with updated transcript/audio/image
    formType: str | None = Form(default=None),
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
        filled_bytes, filled_mime = await load_filled_form_image_bytes_and_mime(filledFormImage)

    return await reextract_form_draft(
        draft_id=draft_id,
        transcript=transcript or "",
        form_type_override=formType,
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