import base64
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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

def _get_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_validation(validation: dict) -> tuple[list[dict], list[dict]]:
    return (
        validation.get("errors", []),
        validation.get("warnings", []),
    )


def _normalize_validation(validation: dict) -> tuple[list[dict], list[dict]]:
    return _get_validation(validation)


def _utc_now_iso() -> str:
    return _get_timestamp()

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
    form_id: str,
    batch_id: str,
    sequence_number: int,
    transcript: str,
    source_type: str = "audio",
    source_index: int = 0,
    preview_url: Optional[str] = None,
    filled_form_image_bytes: Optional[bytes],
    filled_form_image_mime: Optional[str],
) -> Dict[str, Any]:
    payload = await parse_transcription(
        form_type=form_id,
        transcript=transcript,
        filled_form_image_bytes=filled_form_image_bytes,
        filled_form_image_mime=filled_form_image_mime,
    )

    template = await get_active_template(form_id)
    validation = validate_payload(form_id, payload, template)
    validation_errors, validation_warnings = _normalize_validation(validation)

    draft_id = str(uuid.uuid4())
    now = _utc_now_iso()
    db = get_db()

    doc = {
        "draftId": draft_id,
        "formId": form_id,
        # Frontend compatibility: it expects `formType` and `templateVersion`.
        "formType": form_id,
        "templateVersion": template.get("version"),
        "batchId": batch_id,
        "sequenceNumber": sequence_number,
        "reviewStatus": "in_review",
        "sourceType": source_type,
        "sourceIndex": source_index,
        "previewUrl": preview_url,
        "status": "draft",
        "payload": payload,
        "validationErrors": validation_errors,
        "validationWarnings": validation_warnings,
        "validation": {
            "errors": validation_errors,
            "warnings": validation_warnings,
        },
        "transcript": transcript,
        "runId": None,
        "finalizedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }

    await db["form_drafts"].insert_one(doc)

    await db["form_batches"].update_one(
        {"batchId": batch_id},
        {
            "$inc": {"totalDrafts": 1},
            "$set": {"updatedAt": now},
        },
    )

    return doc

async def create_single_form_draft(
    *,
    form_id: str,
    transcript: str,
    created_by: str,
    source_type: str = "audio",
    source_index: int = 0,
    preview_url: Optional[str] = None,
    filled_form_image_bytes: Optional[bytes],
    filled_form_image_mime: Optional[str],
) -> Dict[str, Any]:
    batch = await create_form_batch(created_by=created_by)

    return await create_form_draft(
        form_id=form_id,
        batch_id=batch["batchId"],
        sequence_number=1,
        transcript=transcript,
        source_type=source_type,
        source_index=source_index,
        preview_url=preview_url,
        filled_form_image_bytes=filled_form_image_bytes,
        filled_form_image_mime=filled_form_image_mime,
    )


async def add_draft_to_batch(
    *,
    batch_id: str,
    form_id: str,
    transcript: str,
    source_type: str = "audio",
    preview_url: Optional[str] = None,
    filled_form_image_bytes: Optional[bytes] = None,
    filled_form_image_mime: Optional[str] = None,
) -> Dict[str, Any]:
    """Append a new draft to an existing batch (next sequence number)."""
    db = get_db()
    batch = await db["form_batches"].find_one({"batchId": batch_id})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    last = await (
        db["form_drafts"]
        .find({"batchId": batch_id})
        .sort("sequenceNumber", -1)
        .limit(1)
        .to_list(length=1)
    )
    seq = (last[0]["sequenceNumber"] + 1) if last else 1
    source_index = seq - 1

    return await create_form_draft(
        form_id=form_id,
        batch_id=batch_id,
        sequence_number=seq,
        transcript=transcript,
        source_type=source_type,
        source_index=source_index,
        preview_url=preview_url,
        filled_form_image_bytes=filled_form_image_bytes,
        filled_form_image_mime=filled_form_image_mime,
    )


async def bulk_add_transcript_drafts_to_batch(
    *,
    batch_id: str,
    form_id: str,
    transcripts: list[str],
) -> Dict[str, Any]:
    """
    Create one draft per transcript (no per-item images). Useful after batch STT on the client.
    """
    if not transcripts:
        raise HTTPException(status_code=400, detail="transcripts must be non-empty")

    created: list[Dict[str, Any]] = []
    for t in transcripts:
        doc = await add_draft_to_batch(
            batch_id=batch_id,
            form_id=form_id,
            transcript=t or "",
            source_type="transcript",
            filled_form_image_bytes=None,
            filled_form_image_mime=None,
        )
        created.append(
            {
                "draftId": doc["draftId"],
                "sequenceNumber": doc["sequenceNumber"],
                "validationErrors": doc.get("validationErrors", []),
                "validationWarnings": doc.get("validationWarnings", []),
            }
        )

    return {"batchId": batch_id, "drafts": created}


async def create_form_batch(*, created_by: str) -> Dict[str, Any]:
    db = get_db()
    batch_id = str(uuid.uuid4())
    now = _get_timestamp()

    doc = {
        "batchId": batch_id,
        "createdBy": created_by,
        "status": "processing",
        "totalDrafts": 0,
        "approvedCount": 0,
        "rejectedCount": 0,
        "finalizedCount": 0,
        "createdAt": now,
        "updatedAt": now,
    }

    await db["form_batches"].insert_one(doc)
    return doc

async def cancel_form_draft(*, draft_id: str) -> Dict[str, Any]:
    """Mark a draft as cancelled and remove it from batch active counts."""
    db = get_db()
    draft = await db["form_drafts"].find_one({"draftId": draft_id, "status": "draft"})
    if not draft:
        raise HTTPException(
            status_code=404,
            detail="Draft not found or already finalized/cancelled",
        )

    batch_id = draft.get("batchId")
    now = _utc_now_iso()
    await db["form_drafts"].update_one(
        {"draftId": draft_id},
        {
            "$set": {
                "status": "cancelled",
                "updatedAt": now,
                "reviewStatus": "rejected",
            }
        },
    )
    if batch_id:
        await db["form_batches"].update_one(
            {"batchId": batch_id},
            {
                "$inc": {"totalDrafts": -1, "rejectedCount": 1},
                "$set": {"updatedAt": now},
            },
        )
    return {"ok": True, "draftId": draft_id, "status": "cancelled"}


async def get_form_batch(batch_id: str) -> Dict[str, Any]:
    db = get_db()

    batch = await db["form_batches"].find_one({"batchId": batch_id})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    drafts = await db["form_drafts"].find(
        {"batchId": batch_id, "status": {"$ne": "cancelled"}}
    ).sort("sequenceNumber", 1).to_list(length=1000)

    return {
        "batch": batch,
        "drafts": drafts,
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
        "createdAt": _get_timestamp(),
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

    form_id = draft["formId"]
    transcript = draft.get("transcript", "")
    payload = confirmed_payload or draft.get("payload") or {}

    template = await get_active_template(form_id)
    validation = validate_payload(form_id, payload, template)
    validation_errors, validation_warnings = _normalize_validation(validation)

    now = _utc_now_iso()

    if validation_errors:
        await db["form_drafts"].update_one(
            {"draftId": draft_id},
            {
                "$set": {
                    "payload": payload,
                    "validationErrors": validation_errors,
                    "validationWarnings": validation_warnings,
                    "updatedAt": now,
                }
            },
        )
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Validation failed",
                "validationErrors": validation_errors,
                "validationWarnings": validation_warnings,
            },
        )

    run_res = await finalize_payload_to_run(
        form_type=form_id,
        transcript=transcript,
        payload=payload,
    )

    await db["form_drafts"].update_one(
        {"draftId": draft_id},
        {
            "$set": {
                "payload": payload,
                "validationErrors": validation_errors,
                "validationWarnings": validation_warnings,
                "reviewStatus": "approved",
                "status": "submitted",
                "runId": run_res["runId"],
                "finalizedAt": now,
                "updatedAt": now,
            }
        },
    )

    batch_id = draft["batchId"]
    await db["form_batches"].update_one(
        {"batchId": batch_id},
        {
            "$inc": {
                "approvedCount": 1,
                "finalizedCount": 1,
            },
            "$set": {"updatedAt": now},
        },
    )

    updated = await db["form_drafts"].find_one({"draftId": draft_id})

    return {
        "draft": updated,
        "run": run_res,
    }

async def finalize_form_batch(
    *,
    batch_id: str,
    confirmed_payloads_by_draft_id: Optional[dict[str, dict]] = None,
) -> Dict[str, Any]:
    db = get_db()

    batch = await db["form_batches"].find_one({"batchId": batch_id})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    drafts = await db["form_drafts"].find(
        {"batchId": batch_id, "status": "draft"}
    ).sort("sequenceNumber", 1).to_list(length=1000)

    if not drafts:
        return {
            "batchId": batch_id,
            "status": batch.get("status", "processing"),
            "results": [],
        }

    results = []

    for draft in drafts:
        draft_id = draft["draftId"]
        confirmed_payload = None
        if confirmed_payloads_by_draft_id:
            confirmed_payload = confirmed_payloads_by_draft_id.get(draft_id)

        try:
            res = await finalize_form_draft(
                draft_id=draft_id,
                confirmed_payload=confirmed_payload,
            )
            results.append({
                "draftId": draft_id,
                "ok": True,
                "runId": res["run"]["runId"],
            })
        except HTTPException as exc:
            results.append({
                "draftId": draft_id,
                "ok": False,
                "error": exc.detail,
            })

    remaining = await db["form_drafts"].count_documents({
        "batchId": batch_id,
        "status": "draft",
    })

    batch_status = "completed" if remaining == 0 else "processing"

    await db["form_batches"].update_one(
        {"batchId": batch_id},
        {"$set": {"status": batch_status, "updatedAt": _utc_now_iso()}},
    )

    return {
        "batchId": batch_id,
        "status": batch_status,
        "results": results,
    }


def _wizard_slug_key(label: str, used: set) -> str:
    s = (label or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    if not s:
        s = "field"
    if s[0].isdigit():
        s = "f_" + s
    base = s
    k = base
    n = 2
    while k in used:
        k = f"{base}_{n}"
        n += 1
    used.add(k)
    return k


def wizard_form_type_from_display(display_name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (display_name or "").strip().lower()).strip("_")
    if not s:
        s = "form_template"
    if s[0].isdigit():
        s = "f_" + s
    return s[:80]


def build_json_schema_from_wizard_fields(raw_fields: List[Dict[str, Any]]) -> Dict[str, Any]:
    properties: Dict[str, Any] = {}
    required: List[str] = []
    used_keys: set = set()
    for item in raw_fields:
        label = (item.get("label") or "").strip()
        if not label:
            continue
        raw_key = (item.get("key") or "").strip()
        if raw_key:
            k = re.sub(r"[^a-z0-9_]", "", raw_key.lower())
            if not k or k[0].isdigit():
                key = _wizard_slug_key(label, used_keys)
            elif k in used_keys:
                key = _wizard_slug_key(label, used_keys)
            else:
                used_keys.add(k)
                key = k
        else:
            key = _wizard_slug_key(label, used_keys)
        ftype = str(item.get("type") or "string").lower()
        if ftype == "date":
            properties[key] = {"type": "string", "title": label, "format": "date"}
        elif ftype in ("number", "integer"):
            properties[key] = {"type": "number", "title": label}
        else:
            properties[key] = {"type": "string", "title": label}
        if item.get("required"):
            required.append(key)
    if not properties:
        raise HTTPException(
            status_code=400,
            detail="Add at least one field with a name (label).",
        )
    out: Dict[str, Any] = {"properties": properties}
    if required:
        out["required"] = list(dict.fromkeys(required))
    return out


def _pillow_bytes_to_png_pages(
    data: bytes, max_side: int, max_pages: int
) -> List[bytes]:
    """Open raster images (PNG, JPEG, WebP, BMP, GIF, TIFF, etc.) when PyMuPDF fails."""
    from io import BytesIO

    from PIL import Image, ImageOps

    pages_png: List[bytes] = []
    bio = BytesIO(data)
    try:
        img = Image.open(bio)
        img.load()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read the image file. Try PNG or JPEG. ({e!s})",
        ) from e

    try:
        idx = 0
        while idx < max_pages:
            try:
                img.seek(idx)
            except EOFError:
                break
            except ValueError:
                break
            frame = ImageOps.exif_transpose(img)
            if frame.mode in ("RGBA", "P", "LA"):
                rgb = Image.new("RGB", frame.size, (255, 255, 255))
                if frame.mode == "P":
                    frame = frame.convert("RGBA")
                rgb.paste(frame, mask=frame.split()[-1] if frame.mode in ("RGBA", "LA") else None)
                frame = rgb
            else:
                frame = frame.convert("RGB")
            w, h = frame.size
            if w < 1 or h < 1:
                idx += 1
                continue
            scale = min(max_side / max(w, h), 4.0)
            if scale < 1.0:
                frame = frame.resize(
                    (max(1, int(w * scale)), max(1, int(h * scale))),
                    Image.Resampling.LANCZOS,
                )
            out = BytesIO()
            frame.save(out, format="PNG", optimize=True)
            pages_png.append(out.getvalue())
            idx += 1
    finally:
        try:
            img.close()
        except Exception:
            pass

    return pages_png


def _rasterize_blank_form_to_png_pages(
    data: bytes, filename: str, max_side: int, max_pages: int = 40
) -> List[bytes]:
    import fitz

    name = filename or "upload"
    ext = os.path.splitext(name)[1].lower()
    is_pdf = ext == ".pdf" or (len(data) >= 4 and data[:4] == b"%PDF")

    if is_pdf:
        doc = None
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            n = min(len(doc), max_pages)
            pages_png: List[bytes] = []
            for i in range(n):
                page = doc.load_page(i)
                r = page.rect
                scale = min(
                    max_side / max(r.width, 1.0),
                    max_side / max(r.height, 1.0),
                    4.0,
                )
                mat = fitz.Matrix(scale, scale)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                pages_png.append(pix.tobytes("png"))
            return pages_png
        finally:
            if doc is not None:
                doc.close()

    # Raster: detect real format (filename often wrong, e.g. .png file that is actually JPEG)
    def _sniff_image_filetype(b: bytes) -> Optional[str]:
        if len(b) >= 2 and b[:2] == b"\xff\xd8":
            return "jpeg"
        if len(b) >= 8 and b[:8] == b"\x89PNG\r\n\x1a\n":
            return "png"
        if len(b) >= 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP":
            return "webp"
        if len(b) >= 6 and (b[:6] in (b"GIF87a", b"GIF89a")):
            return "gif"
        if len(b) >= 2 and b[:2] == b"BM":
            return "bmp"
        return None

    doc = None
    try:
        ft = "png"
        if ext in (".jpg", ".jpeg"):
            ft = "jpeg"
        elif ext == ".webp":
            ft = "webp"
        sniffed = _sniff_image_filetype(data)
        try_order = []
        if sniffed:
            try_order.append(sniffed)
        if ft not in try_order:
            try_order.append(ft)
        for x in ("png", "jpeg", "webp", "gif", "bmp", "pdf"):
            if x not in try_order:
                try_order.append(x)
        for attempt in try_order:
            try:
                doc = fitz.open(stream=data, filetype=attempt)
                if doc is not None and len(doc) > 0:
                    break
            except Exception:
                doc = None
                continue
        if doc is not None and len(doc) > 0:
            pages_png = []
            n = min(len(doc), max_pages)
            for i in range(n):
                page = doc.load_page(i)
                r = page.rect
                scale = min(
                    max_side / max(r.width, 1.0),
                    max_side / max(r.height, 1.0),
                    4.0,
                )
                mat = fitz.Matrix(scale, scale)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                pages_png.append(pix.tobytes("png"))
            return pages_png
    finally:
        if doc is not None:
            doc.close()

    pillow_pages = _pillow_bytes_to_png_pages(data, max_side, max_pages)
    if pillow_pages:
        return pillow_pages

    raise HTTPException(
        status_code=400,
        detail="Could not read the file. Use a PDF or a standard image (PNG, JPEG, WebP).",
    )


async def preview_blank_form_b64_pages(
    data: bytes, filename: str, *, max_side: int = 960, max_pages: int = 15
) -> List[str]:
    def _work() -> List[str]:
        pngs = _rasterize_blank_form_to_png_pages(data, filename, max_side, max_pages)
        return [base64.standard_b64encode(b).decode("ascii") for b in pngs]

    return await run_in_threadpool(_work)


async def create_form_template_from_wizard(
    *,
    form_type: str,
    display_name: str,
    version: int,
    blank_file_bytes: bytes,
    blank_filename: str,
    fields: List[Dict[str, Any]],
    field_regions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    json_schema = build_json_schema_from_wizard_fields(fields)

    def _rasterize() -> List[Tuple[str, bytes]]:
        pngs = _rasterize_blank_form_to_png_pages(
            blank_file_bytes, blank_filename, max_side=2000, max_pages=40
        )
        return [(f"page_{i + 1}.png", b) for i, b in enumerate(pngs)]

    template_images = await run_in_threadpool(_rasterize)

    base_rules = [
        "Return ONLY valid JSON (no markdown, no code fences).",
        "If unknown/not visible, use empty string.",
        "No extra keys; must conform to schema.",
        "Template images are layout references only; do NOT copy example/placeholder values from them.",
        "Use transcript to fill fields; if a filled form photo is provided, prefer the photo.",
        "Interpret relative dates (tomorrow/next Monday) using the provided reference date; output YYYY-MM-DD.",
    ]
    if field_regions:
        lines = [
            "Field layout hints (normalized 0–1 on each page image, origin top-left):",
        ]
        for r in field_regions:
            try:
                pg = int(r.get("page", 0)) + 1
                x = float(r.get("x", 0))
                y = float(r.get("y", 0))
                w = float(r.get("w", 0))
                h = float(r.get("h", 0))
                lab = r.get("label") or "?"
                ky = r.get("key") or "?"
                lines.append(
                    f"  • {lab} [key={ky}]: page {pg}, box x={x:.4f} y={y:.4f} w={w:.4f} h={h:.4f}"
                )
            except (TypeError, ValueError):
                continue
        base_rules.append("\n".join(lines))

    db = get_db()
    await db["form_templates"].update_many(
        {"formType": form_type, "status": "active"},
        {"$set": {"status": "deprecated"}},
    )

    base_dir = _ensure_storage_dir("forms", form_type, f"v{version}")
    stored_paths: list[str] = []
    public_urls: list[str] = []

    for i, (fname, b) in enumerate(template_images):
        fs_name = f"template_{i + 1}.png"
        fs_path = os.path.join(base_dir, fs_name)
        with open(fs_path, "wb") as f:
            f.write(b)
        stored_paths.append(fs_path)
        public_urls.append(f"/storage/forms/{form_type}/v{version}/{fs_name}")

    doc = {
        "formType": form_type,
        "displayName": display_name,
        "version": version,
        "status": "active",
        "templateImagePaths": stored_paths,
        "templateImageUrls": public_urls,
        "jsonSchema": json_schema,
        "wizardFieldRegions": field_regions or [],
        "promptSpec": {"rules": base_rules},
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    await db["form_templates"].insert_one(doc)
    return {
        "ok": True,
        "formType": form_type,
        "version": version,
        "templateImageUrls": public_urls,
    }


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


async def archive_form_template(*, form_type: str) -> Dict[str, Any]:
    """Mark all active versions of this form type as archived (hidden from list)."""
    db = get_db()
    now = _get_timestamp()
    result = await db["form_templates"].update_many(
        {"formType": form_type, "status": "active"},
        {"$set": {"status": "archived", "archivedAt": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="No active template found for this form type")
    return {"ok": True, "formType": form_type, "archivedCount": result.modified_count}


async def update_form_draft_payload(
    *,
    draft_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    db = get_db()
    draft = await db["form_drafts"].find_one({"draftId": draft_id, "status": "draft"})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found or not in draft state")

    form_id = draft["formId"]
    template = await get_active_template(form_id)
    validation = validate_payload(form_id, payload, template)
    validation_errors, validation_warnings = _get_validation(validation)
    now = _get_timestamp()

    await db["form_drafts"].update_one(
        {"draftId": draft_id},
        {
            "$set": {
                "payload": payload,
                "validationErrors": validation_errors,
                "validationWarnings": validation_warnings,
                "validation": {
                    "errors": validation_errors,
                    "warnings": validation_warnings,
                },
                "updatedAt": now,
            }
        },
    )
    updated = await db["form_drafts"].find_one({"draftId": draft_id})
    assert updated is not None
    return {
        "draftId": updated["draftId"],
        "formType": updated.get("formId"),
        "payload": updated.get("payload", {}),
        "validation": {
            "errors": updated.get("validationErrors", []),
            "warnings": updated.get("validationWarnings", []),
        },
        "status": updated.get("status", "draft"),
        "updatedAt": updated.get("updatedAt"),
    }


async def reextract_form_draft(
    *,
    draft_id: str,
    transcript: str,
    form_type_override: Optional[str] = None,
    filled_form_image_bytes: Optional[bytes],
    filled_form_image_mime: Optional[str],
) -> Dict[str, Any]:
    db = get_db()
    draft = await db["form_drafts"].find_one({"draftId": draft_id, "status": "draft"})
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found or not in draft state")

    form_id = form_type_override or draft["formId"]

    payload = await parse_transcription(
        form_type=form_id,
        transcript=transcript,
        filled_form_image_bytes=filled_form_image_bytes,
        filled_form_image_mime=filled_form_image_mime,
    )

    template = await get_active_template(form_id)
    validation = validate_payload(form_id, payload, template)
    validation_errors, validation_warnings = _get_validation(validation)

    now = _get_timestamp()

    await db["form_drafts"].update_one(
        {"draftId": draft_id},
        {
            "$set": {
                "formId": form_id,
                "formType": form_id,
                "templateVersion": template.get("version"),
                "transcript": transcript,
                "payload": payload,
                "validationErrors": validation_errors,
                "validationWarnings": validation_warnings,
                "validation": {
                    "errors": validation_errors,
                    "warnings": validation_warnings,
                },
                "updatedAt": now,
            }
        },
    )

    updated = await db["form_drafts"].find_one({"draftId": draft_id})
    # Keep response normalized for the frontend.
    return {
        "draftId": updated["draftId"],
        "formType": updated.get("formType") or updated.get("formId"),
        "templateVersion": updated.get("templateVersion"),
        "payload": updated.get("payload", {}),
        "validation": updated.get("validation", {"errors": [], "warnings": []}),
        "transcript": updated.get("transcript", ""),
        "status": updated.get("status", "draft"),
        "runId": updated.get("runId"),
        "updatedAt": updated.get("updatedAt"),
    }