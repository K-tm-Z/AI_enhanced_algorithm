import json
import re
from typing import Any, Dict, List

import httpx
from fastapi import HTTPException

from ..config import settings
from ..db import get_db


def _strip_code_fences(s: str) -> str:
    """
    Strips surrounding ```json ... ``` or ``` ... ``` blocks.
    """
    s = (s or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


async def segment_batch_transcript(transcript: str) -> List[Dict[str, str]]:
    """
    Split a long transcript into multiple form-specific segments.

    Returns:
      [{ "formId": "<formType>", "transcript": "<transcript excerpt>"}, ...]
    """
    if not transcript or not transcript.strip():
        return []

    # Use active templates so the model must pick from known IDs.
    db = get_db()
    templates = await db["form_templates"].find({"status": "active"}).to_list(length=200)
    form_ids = [t.get("formType") for t in templates if isinstance(t.get("formType"), str) and t.get("formType")]
    if not form_ids:
        raise HTTPException(status_code=500, detail="No active form templates configured")

    system = (
        "You split transcripts into multiple form segments for a backend extraction pipeline. "
        "Return ONLY valid JSON that conforms to the required schema. "
        "No markdown and no extra keys."
    )

    user = {
        "availableFormIds": form_ids,
        "instructions": (
            "Split the transcript into segments, where each segment corresponds to exactly one form to be filled. "
            "Each segment must be returned with: formId (must be one of availableFormIds), transcript (the excerpt relevant to that form). "
            "Keep segments in the order they appear in the transcript. "
            "If a form cannot be determined confidently, omit it rather than guessing."
        ),
        "transcript": transcript,
        "requiredOutputSchemaExample": [
            {"formId": form_ids[0], "transcript": "Example excerpt..."}
        ],
    }

    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY missing")

    payload: Dict[str, Any] = {
        "model": settings.OPENROUTER_MM_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user)},
        ],
        "temperature": 0,
    }

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    # OpenRouter is already configured with /chat/completions in settings.
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(settings.OPENROUTER_BASE_URL, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to segment transcript: {str(e)}")

    try:
        raw_text = data["choices"][0]["message"]["content"]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Bad OpenRouter response shape: {str(e)}")

    text = _strip_code_fences(raw_text)
    try:
        parsed = json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Segmentation model did not return JSON: {str(e)}")

    # Allow either a raw list or {"segments":[...]}.
    if isinstance(parsed, dict) and isinstance(parsed.get("segments"), list):
        parsed = parsed["segments"]

    if not isinstance(parsed, list):
        raise HTTPException(status_code=502, detail="Segmentation model returned non-list JSON")

    segments: List[Dict[str, str]] = []
    for seg in parsed:
        if not isinstance(seg, dict):
            continue
        form_id = (
            seg.get("formId")
            or seg.get("form_id")
            or seg.get("formType")
            or seg.get("form_type")
        )
        seg_transcript = seg.get("transcript") or seg.get("text") or seg.get("segmentTranscript")
        if isinstance(form_id, str) and form_id and isinstance(seg_transcript, str):
            segments.append({"formId": form_id, "transcript": seg_transcript})

    return segments

