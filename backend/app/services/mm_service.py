import base64
import json
import re
from typing import Any, Dict, List, Optional
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
        "You are a data extraction engine. "
        "You must output ONLY valid JSON that conforms exactly to the provided JSON Schema. "
        "No markdown, no code fences, no commentary."
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

    text = data["choices"][0]["message"]["content"]
    text = _strip_code_fences(text)

    try:
        return json.loads(text)
    except Exception as e:
        raise ValueError(f"Model did not return valid JSON. Raw: {text[:500]}") from e


async def bytes_to_data_url(image_bytes: bytes, mime: str) -> Dict[str, str]:
    return {"data_url": _b64_data_url(image_bytes, mime)}