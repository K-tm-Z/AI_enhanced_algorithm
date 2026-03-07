import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from ..db import get_db
from ..config import settings
from .mm_service import bytes_to_data_url, extract_payload_multimodal
from .render_service import render_pdf_bytes, dict_to_xml_bytes
from .email_service import send_email_with_attachments
from fastapi.concurrency import run_in_threadpool

def _ensure_storage_dir(*parts: str) -> str:
    path = os.path.join(settings.STORAGE_DIR, *parts)
    os.makedirs(path, exist_ok=True)
    return path


async def get_active_template(form_type: str) -> Dict[str, Any]:
    db = get_db()
    doc = await db["form_templates"].find_one({"formType": form_type, "status": "active"}, sort=[("version", -1)])
    if not doc:
        raise HTTPException(status_code=404, detail=f"Unknown formType: {form_type}")
    return doc


async def parse_transcription(
    *,
    form_type: str,
    transcript: str,
    filled_form_image_bytes: Optional[bytes],
    filled_form_image_mime: Optional[str],
) -> Dict[str, Any]:
    """
    Extract a structured payload for the given form type from a raw transcript,
    using the active form template, its JSON schema, and the associated images.
    """
    template = await get_active_template(form_type)

    # load template images from disk
    template_imgs = []
    for p in template.get("templateImagePaths", []):
        try:
            with open(p, "rb") as f:
                b = f.read()
            # assume png/jpg by extension; you can store mime in DB if needed
            mime = "image/png" if p.lower().endswith(".png") else "image/jpeg"
            template_imgs.append(await bytes_to_data_url(b, mime))
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail=f"Template image missing on server: {p}")

    filled_img = None
    if filled_form_image_bytes and filled_form_image_mime:
        filled_img = await bytes_to_data_url(filled_form_image_bytes, filled_form_image_mime)

    json_schema = template.get("jsonSchema") or {}
    rules = (template.get("promptSpec") or {}).get("rules") or [
        "Return ONLY valid JSON.",
        "No extra keys; match schema.",
        "Missing values -> empty string.",
    ]

    payload = await extract_payload_multimodal(
        transcript=transcript,
        json_schema=json_schema,
        rules=rules,
        template_images=template_imgs,
        filled_image=filled_img,
    )

    # (Optional but strongly recommended) validate against JSON Schema.
    # If you want strict enforcement, add `jsonschema` dependency and validate here.

    return payload

async def create_form_draft(
    *,
    form_type: str,
    transcript: str,
    filled_form_image_bytes: Optional[bytes],
    filled_form_image_mime: Optional[str],
) -> Dict[str, Any]:
    payload = await parse_transcription(
        form_type=form_type,
        transcript=transcript,
        filled_form_image_bytes=filled_form_image_bytes,
        filled_form_image_mime=filled_form_image_mime,
    )

    template = await get_active_template(form_type)

    validation = validate_payload(form_type, payload, template)  # you implement below

    draft_id = str(uuid.uuid4())
    db = get_db()
    await db["form_drafts"].insert_one({
        "draftId": draft_id,
        "formType": form_type,
        "templateVersion": template.get("version"),
        "transcript": transcript,
        "payload": payload,
        "validation": validation,
        "status": "draft",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })

    return {
        "draftId": draft_id,
        "formType": form_type,
        "templateVersion": template.get("version"),
        "payload": payload,
        "validation": validation,
        "transcript": transcript,
        "status": "draft",
    }

async def process_form_pipeline(
    *,
    form_type: str,
    transcript: str,
    filled_form_image_bytes: Optional[bytes],
    filled_form_image_mime: Optional[str],
) -> Dict[str, Any]:
    payload = await parse_transcription(
        form_type=form_type,
        transcript=transcript,
        filled_form_image_bytes=filled_form_image_bytes,
        filled_form_image_mime=filled_form_image_mime,
    )

    return await finalize_payload_to_run(
        form_type=form_type,
        transcript=transcript,
        payload=payload
    )

async def finalize_payload_to_run(
    *,
    form_type: str,
    transcript: str,
    payload: dict,
) -> Dict[str, Any]:
    template = await get_active_template(form_type)

    pdf_bytes = render_pdf_bytes(form_type, payload)
    xml_bytes = dict_to_xml_bytes(root_name=form_type, payload=payload)

    run_id = str(uuid.uuid4())
    run_dir = _ensure_storage_dir("runs", run_id)

    pdf_path = os.path.join(run_dir, f"{form_type}.pdf")
    xml_path = os.path.join(run_dir, f"{form_type}.xml")
    with open(pdf_path, "wb") as f:
        f.write(pdf_bytes)
    with open(xml_path, "wb") as f:
        f.write(xml_bytes)

    # persist run
    db = get_db()
    recipient_email = settings.FORMS_RECIPIENT_EMAIL or settings.SMTP_FROM

    await db["form_runs"].insert_one({
        "runId": run_id,
        "formType": form_type,
        "templateVersion": template.get("version"),
        "transcript": transcript,
        "payload": payload,
        "pdfPath": pdf_path,
        "pdfUrl": f"/storage/runs/{run_id}/{form_type}.pdf",
        "xmlPath": xml_path,
        "xmlUrl": f"/storage/runs/{run_id}/{form_type}.xml", 
        "emailedTo": recipient_email,
        "status": "pending",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    })
    
    status = "pending"
    email_error = None
    
    try:
        await run_in_threadpool(
            send_email_with_attachments,
            to_email=recipient_email,
            subject=f"{form_type} output",
            body="Attached are the generated PDF and XML outputs.",
            attachments=[
                (f"{form_type}.pdf", pdf_bytes, "application/pdf"),
                (f"{form_type}.xml", xml_bytes, "application/xml"),
            ],
        )
        status = "sent"
        await db["form_runs"].update_one({"runId": run_id}, {"$set": {"status": "sent"}})
    except Exception as e:
        status = "email_failed"
        email_error = str(e)
        await db["form_runs"].update_one(
            {"runId": run_id},
            {"$set": {"status": "email_failed", "emailError": email_error}},
        )

    return {
        "runId": run_id,
        "formType": form_type,
        "payload": payload,
        "pdfPath": pdf_path,
        "xmlPath": xml_path,
        "emailedTo": recipient_email,
        "status": status,
        **({"emailError": email_error} if email_error else {}),
    }

def validate_payload(form_type: str, payload: dict, template: dict) -> dict:
    errors = []
    warnings = []

    schema = template.get("jsonSchema") or {}
    required = schema.get("required") or []

    # required checks (only top-level; can expand later)
    for k in required:
        v = payload.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            errors.append({"path": k, "message": "Required field is missing/empty"})

    # heuristic: label-as-value
    def walk(obj, path=""):
        if isinstance(obj, dict):
            for kk, vv in obj.items():
                walk(vv, f"{path}.{kk}" if path else kk)
        elif isinstance(obj, list):
            for i, vv in enumerate(obj):
                walk(vv, f"{path}[{i}]")
        elif isinstance(obj, str):
            bad = {
                "first name",
                "last name",
                "staff id",
                "employee id",
                "date",
                "name",
                "id",
            }  # extend per your forms
            if obj.strip().lower() in bad:
                warnings.append({"path": path, "message": "Value looks like a label/placeholder"})
    walk(payload)

    return {"errors": errors, "warnings": warnings}

async def finalize_form_draft(
    *,
    draft_id: str,
    confirmed_payload: Optional[dict] = None,
) -> Dict[str, Any]:
    db = get_db()
    draft = await db["form_drafts"].find_one({"draftId": draft_id, "status": "draft"})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found or not in draft state")

    form_type = draft["formType"]
    transcript = draft.get("transcript", "")
    payload = confirmed_payload or draft.get("payload") or {}

    template = await get_active_template(form_type)
    validation = validate_payload(form_type, payload, template)

    if validation["errors"]:
        # Hard stop: user must correct
        await db["form_drafts"].update_one(
            {"draftId": draft_id},
            {"$set": {"payload": payload, "validation": validation, "updatedAt": datetime.now(timezone.utc).isoformat()}}
        )
        raise HTTPException(status_code=400, detail={"message": "Validation failed", "validation": validation})

    run_res = await finalize_payload_to_run(
        form_type=form_type,
        transcript=transcript,
        payload=payload,
    )

    await db["form_drafts"].update_one(
        {"draftId": draft_id},
        {"$set": {"status": "finalized", "updatedAt": datetime.now(timezone.utc).isoformat(), "runId": run_res["runId"]}}
    )

    return {"draftId": draft_id, "run": run_res}

async def create_form_template(
    *,
    form_type: str,
    display_name: str,
    version: int,
    json_schema_str: str,
    template_images: list[tuple[str, bytes]],  # [(filename, bytes)]
) -> Dict[str, Any]:
    db = get_db()

    if not template_images:
        raise HTTPException(status_code=400, detail="templateImages must include at least 1 image")

    try:
        json_schema = json.loads(json_schema_str)
    except Exception:
        raise HTTPException(status_code=400, detail="jsonSchema must be valid JSON")

    # Deactivate previous active versions first
    await db["form_templates"].update_many(
        {"formType": form_type, "status": "active"},
        {"$set": {"status": "deprecated"}},
    )

    base_dir = _ensure_storage_dir("forms", form_type, f"v{version}")

    stored_paths: list[str] = []
    public_urls: list[str] = []

    for i, (filename, b) in enumerate(template_images):
        ext = os.path.splitext(filename)[1].lower() or ".png"
        fs_name = f"template_{i+1}{ext}"
        fs_path = os.path.join(base_dir, fs_name)

        with open(fs_path, "wb") as f:
            f.write(b)

        # Option A (what you have now): store absolute-ish server path
        stored_paths.append(fs_path)

        # Public URL served by app.mount("/storage", StaticFiles(directory=storage_dir), name="storage")
        public_urls.append(f"/storage/forms/{form_type}/v{version}/{fs_name}")

    doc = {
        "formType": form_type,
        "displayName": display_name,
        "version": version,
        "status": "active",
        "templateImagePaths": stored_paths,
        "templateImageUrls": public_urls,
        "jsonSchema": json_schema,
        "promptSpec": {
            "rules": [
                "Return ONLY valid JSON (no markdown, no code fences).",
                "If unknown/not visible, use empty string.",
                "No extra keys; must conform to schema.",
                "Template images are layout references only; do NOT copy example/placeholder values from them.",
                "Use transcript to fill fields; if a filled form photo is provided, prefer the photo.",
                "Interpret relative dates (tomorrow/next Monday) using the provided reference date; output YYYY-MM-DD."
            ]
        },
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    await db["form_templates"].insert_one(doc)

    return {
        "ok": True,
        "formType": form_type,
        "version": version,
        "templateImageUrls": public_urls
    }

async def update_form_draft_payload(
    *,
    draft_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    db = get_db()
    draft = await db["form_drafts"].find_one({"draftId": draft_id, "status": "draft"})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found or not in draft state")

    form_type = draft["formType"]
    template = await get_active_template(form_type)

    validation = validate_payload(form_type, payload, template)

    await db["form_drafts"].update_one(
        {"draftId": draft_id},
        {"$set": {
            "payload": payload,
            "validation": validation,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }},
    )

    return {
        "draftId": draft_id,
        "formType": form_type,
        "templateVersion": draft.get("templateVersion"),
        "payload": payload,
        "validation": validation,
        "transcript": draft.get("transcript", ""),
        "status": "draft",
    }


async def reextract_form_draft(
    *,
    draft_id: str,
    transcript: str,
    filled_form_image_bytes: Optional[bytes],
    filled_form_image_mime: Optional[str],
) -> Dict[str, Any]:
    db = get_db()
    draft = await db["form_drafts"].find_one({"draftId": draft_id, "status": "draft"})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found or not in draft state")

    form_type = draft["formType"]

    payload = await parse_transcription(
        form_type=form_type,
        transcript=transcript,
        filled_form_image_bytes=filled_form_image_bytes,
        filled_form_image_mime=filled_form_image_mime,
    )

    template = await get_active_template(form_type)
    validation = validate_payload(form_type, payload, template)

    await db["form_drafts"].update_one(
        {"draftId": draft_id},
        {"$set": {
            "transcript": transcript,
            "payload": payload,
            "validation": validation,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }},
    )

    return {
        "draftId": draft_id,
        "formType": form_type,
        "templateVersion": draft.get("templateVersion"),
        "payload": payload,
        "validation": validation,
        "transcript": transcript,
        "status": "draft",
    }