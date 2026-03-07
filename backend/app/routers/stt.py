from fastapi import APIRouter, File, Form, UploadFile, Depends, HTTPException
import json
from ..deps import require_auth
from ..services.stt_service import transcribe_audio
from .extraction_agent import StructuredExtractionAgent

router = APIRouter()

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