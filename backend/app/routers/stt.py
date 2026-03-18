from typing import Any, Dict

from fastapi import APIRouter, File, Form, UploadFile, Depends, HTTPException
import json
from ..deps import require_auth
from ..services.stt_service import transcribe_audio
from ..services.form_service import create_form_batch, create_form_draft
from ..services.segmentation_service import segment_batch_transcript
from ..services.filled_form_service import load_filled_form_image_bytes_and_mime
from .extraction_agent import StructuredExtractionAgent

router = APIRouter()


async def _build_batch_from_segmented_transcript(transcript: str, user: Any) -> Dict[str, Any]:
    """Segment transcript into form slots and create batch + drafts."""
    segments = await segment_batch_transcript(transcript)
    if not segments:
        raise HTTPException(
            status_code=400,
            detail="Could not detect individual forms in transcript",
        )
    batch = await create_form_batch(created_by=user)
    batch_id = batch["batchId"]
    drafts = []
    for i, seg in enumerate(segments, start=1):
        draft = await create_form_draft(
            form_id=seg["formId"],
            batch_id=batch_id,
            sequence_number=i,
            source_type="audio",
            source_index=i - 1,
            transcript=seg["transcript"],
            filled_form_image_bytes=None,
            filled_form_image_mime=None,
        )
        drafts.append(draft)
    return {
        "batchId": batch_id,
        "rawTranscript": transcript,
        "drafts": drafts,
    }

# 
@router.post("/api/stt/transcribe")
async def stt_transcribe(
        audio: UploadFile = File(...),
        segmentType: str | None = Form(None),
        threadId: str | None = Form("default_session"),
        # user=Depends(require_auth),  # ensure only logged-in users can call this
    ):
        # 1. Transcription Handshake
        result = await transcribe_audio(await audio.read(), audio.content_type, segmentType)
        raw_transcript = result.get("transcript", "")

        # 2. AI Extraction with Safety Net
        try:
            # Try the real AI first
            agent = StructuredExtractionAgent(tools=[])  # Initialize your agent with any necessary tools
            ai_extraction_raw = agent.ask(raw_transcript or "Simulated paramedic report", thread_id=threadId)
            return {
                "transcript": raw_transcript,
                "structured_data": json.loads(ai_extraction_raw),
                "status": "LIVE_AI"
            }
        except Exception as e:
            # --- THE INSURANCE POLICY ---
            print(f"[DEMO MODE] AI failed (Error: {e}). Returning Mock Data.")
            
            mock_incident_data = {
                "form_type": "incident_report",
                "date": "2026-03-04",
                "time": "01:45",
                "report_id": "DEMO-001",
                "category": "Operational Incident",
                "reference_number": "REF-2026-03-04",
                "summary": "An equipment issue was reported on site and documented for follow-up.",
                "severity": "Medium",
                "severity_details": "No immediate safety risk identified.",
                "service_area": "Operations",
                "asset_id": "ASSET-24",
                "asset_description": "Mobile field unit",
                "reporter_role": "Operator",
                "reporter_role_details": "Primary on-site reporter",
                "staff_id": "STAFF-77",
                "external_party_a": True,
                "external_party_b": False,
                "observations": "Issue observed during routine operations.",
                "suggested_resolution": "Inspect asset and log maintenance follow-up.",
                "action_taken": "Incident documented and escalated for review.",
                "management_notes": "Pending supervisor review.",
                "requested_by": "Operations Lead",
                "requested_by_details": "Shift lead request",
                "report_creator": "Demo User",
                "report_creator_details": "Generated in fallback mode"
            }
            
            return {
                "transcript": raw_transcript or "Patient stabilized at scene, police arrived 2 minutes ago.",
                "structured_data": mock_incident_data,
                "status": "DEMO_MOCK_ACTIVE"
            }
        
@router.post("/batches/from-audio")
@router.post("/api/stt/batches/from-audio")
async def create_batch_from_audio(
    audio: UploadFile = File(...),
    user=Depends(require_auth),
):
    audio_bytes = await audio.read()
    stt_res = await transcribe_audio(
        audio=audio_bytes,
        mime_type=audio.content_type,
        segment_type="batch_forms",
    )

    transcript = stt_res.get("transcript", "")
    if not transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript was empty")
    return await _build_batch_from_segmented_transcript(transcript, user)


@router.post("/batches/from-transcript")
@router.post("/api/stt/batches/from-transcript")
async def create_batch_from_transcript(
    transcript: str = Form(...),
    user=Depends(require_auth),
):
    """Create batch slots from pasted text (same segmentation as after STT)."""
    t = (transcript or "").strip()
    if not t:
        raise HTTPException(status_code=400, detail="Transcript was empty")
    return await _build_batch_from_segmented_transcript(t, user)


@router.post("/batches/from-audio-with-filled-forms")
@router.post("/api/stt/batches/from-audio-with-filled-forms")
async def create_batch_from_audio_with_filled_forms(
    audio: UploadFile = File(...),
    filledForms: list[UploadFile] = File(default=[]),
    user=Depends(require_auth),
):
    """
    Speech -> STT -> segment into per-form transcript chunks -> create one draft per segment.
    Each draft also receives its corresponding filled form image/PDF converted to an image.
    """
    audio_bytes = await audio.read()
    stt_res = await transcribe_audio(
        audio=audio_bytes,
        mime_type=audio.content_type,
        segment_type="batch_forms",
    )

    transcript = stt_res.get("transcript", "")
    if not transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript was empty")

    segments = await segment_batch_transcript(transcript)
    if not segments:
        raise HTTPException(status_code=400, detail="Could not detect individual forms in transcript")

    if filledForms:
        if len(filledForms) != len(segments):
            raise HTTPException(
                status_code=400,
                detail=f"filledForms count ({len(filledForms)}) must match segment count ({len(segments)})",
            )

    batch = await create_form_batch(created_by=user)
    batch_id = batch["batchId"]

    drafts = []
    for i, seg in enumerate(segments, start=1):
        filled_bytes = None
        filled_mime = None
        if filledForms:
            filled_bytes, filled_mime = await load_filled_form_image_bytes_and_mime(filledForms[i - 1])

        draft = await create_form_draft(
            form_id=seg["formId"],
            batch_id=batch_id,
            sequence_number=i,
            source_type="audio",
            source_index=i - 1,
            transcript=seg["transcript"],
            filled_form_image_bytes=filled_bytes,
            filled_form_image_mime=filled_mime,
        )
        drafts.append(draft)

    return {
        "batchId": batch_id,
        "rawTranscript": transcript,
        "drafts": drafts,
    }