import base64
import json
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from ..config import settings

def _b64_data_url(image_bytes: bytes, mime: str) -> str:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def _strip_code_fences(s: str) -> str:
    # handles ```json ... ``` and ``` ... ```
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _parse_json_object_from_text(text: str) -> Optional[Dict[str, Any]]:
    """
    Parse a JSON object from model output: full string, fenced block, or first {...} span.
    """
    if not text or not text.strip():
        return None
    cleaned = _strip_code_fences(text)
    for candidate in (cleaned, text.strip()):
        try:
            val = json.loads(candidate)
            if isinstance(val, dict):
                return val
        except json.JSONDecodeError:
            pass
    start = cleaned.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    quote = ""
    for i in range(start, len(cleaned)):
        c = cleaned[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == quote:
                in_str = False
            continue
        if c in ('"', "'"):
            in_str = True
            quote = c
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                chunk = cleaned[start : i + 1]
                try:
                    val = json.loads(chunk)
                    if isinstance(val, dict):
                        return val
                except json.JSONDecodeError:
                    pass
                break
    return None


async def extract_payload_multimodal(
    *,
    transcript: str,
    json_schema: Dict[str, Any],
    rules: List[str],
    template_images: List[Dict[str, str]],  # [{"data_url": "..."}]
    filled_image: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Returns a dict that MUST conform to json_schema.
    This function only calls the model; validation should happen server-side.
    """
    tz = ZoneInfo("America/Toronto")
    today = datetime.now(tz).date().isoformat()
    if not settings.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not set")

    # System + user prompt pattern: schema-bound extraction
    system = (
        "You are a data extraction engine for structured business/medical forms. "
        "The user provides dictation and optional form images; extracting field values is safe and expected. "
        "You must output ONLY valid JSON that conforms exactly to the provided JSON Schema. "
        "No markdown, no code fences, no commentary, no refusals—use empty strings for unknown fields."
    )

    user_text = {
        "type": "text",
        "text": (
            f"Today is {today} in America/Toronto.\n"
            f"Interpret relative dates (e.g., tomorrow, next Monday) using this reference date.\n\n"
            f"All date fields MUST be absolute dates in YYYY-MM-DD format.\n\n"
            f"Never output relative words like 'tomorrow' or 'next Monday'; always convert to absolute dates.\n\n"
            "Task: Produce JSON for the selected form.\n\n"
            f"Rules:\n- " + "\n- ".join(rules) + "\n\n"
            "Transcript (may contain dictated values):\n"
            f"{transcript}\n\n"
            "JSON Schema (must conform exactly):\n"
            f"{json.dumps(json_schema)}"
        ),
    }

    content: List[Dict[str, Any]] = [user_text]

    if filled_image:
        content.append({"type": "text", "text": "Filled form photo (values source of truth if readable):"})
        content.append({"type": "image_url", "image_url": {"url": filled_image["data_url"]}})

    content.append({"type": "text", "text": "Template images (layout only; ignore any example values):"})
    for img in template_images:
        content.append({"type": "image_url", "image_url": {"url": img["data_url"]}})

    payload = {
        "model": settings.OPENROUTER_MM_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "temperature": 0,
    }

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{settings.OPENROUTER_BASE_URL}", headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()

    raw = data["choices"][0]["message"]["content"] or ""
    text = raw if isinstance(raw, str) else str(raw)

    parsed = _parse_json_object_from_text(text)
    if parsed is not None:
        return parsed

    preview = (text or "").strip()[:500] or "(empty)"
    logger.warning(
        "Multimodal model returned no parseable JSON (refusal or invalid). Raw preview: %s",
        preview,
    )
    # Let draft creation continue; validation will surface missing required fields.
    return {}


async def bytes_to_data_url(image_bytes: bytes, mime: str) -> Dict[str, str]:
    return {"data_url": _b64_data_url(image_bytes, mime)}