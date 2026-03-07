# services/stt_service.py
from __future__ import annotations

import base64
import os
import subprocess
import tempfile
from typing import Optional
import shutil
from imageio_ffmpeg import get_ffmpeg_exe

import httpx

from ..config import settings

def _resolve_ffmpeg() -> str:
    return shutil.which("ffmpeg") or get_ffmpeg_exe()
    
def _target_ext(fmt: str) -> str:
    f = (fmt or "").lower().strip()
    return f if f in ("wav", "mp3") else "wav"


def _run_ffmpeg_convert(in_path: str, out_path: str, *, sample_rate: int = 16000) -> None:
    ffmpeg_bin = _resolve_ffmpeg()

    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", in_path,
        "-vn",
        "-ac", "1",
        "-ar", str(sample_rate),
        out_path,
    ]

    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (code {p.returncode}): {p.stderr.strip() or p.stdout.strip()}"
        )

    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise RuntimeError("ffmpeg produced no output file (out_path missing or empty)")

def _guess_input_ext(mime_type: Optional[str]) -> str:
    mt = (mime_type or "").lower()
    if "webm" in mt:
        return "webm"
    if "wav" in mt or "x-wav" in mt:
        return "wav"
    if "mpeg" in mt or "mp3" in mt:
        return "mp3"
    if "mp4" in mt:
        return "mp4"
    if "ogg" in mt:
        return "ogg"
    if "flac" in mt:
        return "flac"
    if "aac" in mt:
        return "aac"
    return "bin"


def _extract_text_from_or_message_content(content) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str):
                parts.append(p["text"])
        return "\n".join(parts).strip()
    return ""


async def transcribe_audio(audio: bytes, mime_type: str | None, segment_type: str | None):
    if not audio:
        return {"transcript": "", "segmentType": segment_type or "unknown"}

    if not settings.OPENROUTER_API_KEY:
        return {"transcript": "", "segmentType": segment_type or "unknown", "error": "OPENROUTER_API_KEY missing"}

    target_fmt = _target_ext(settings.STT_TARGET_FORMAT)

    in_ext = _guess_input_ext(mime_type)
    with tempfile.TemporaryDirectory() as td:
        in_path = os.path.join(td, f"in.{in_ext}")
        out_path = os.path.join(td, f"out.{target_fmt}")

        with open(in_path, "wb") as f:
            f.write(audio)

        try:
            _run_ffmpeg_convert(in_path, out_path, sample_rate=16000)
        except Exception as e:
            return {"transcript": "", "segmentType": segment_type or "unknown", "error": "Audio conversion failed", "detail": str(e)}

        with open(out_path, "rb") as f:
            converted = f.read()

    b64 = base64.b64encode(converted).decode("utf-8")

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    if settings.OPENROUTER_HTTP_REFERER:
        headers["HTTP-Referer"] = settings.OPENROUTER_HTTP_REFERER
    if settings.OPENROUTER_APP_TITLE:
        headers["X-OpenRouter-Title"] = settings.OPENROUTER_APP_TITLE

    payload = {
        "model": settings.STT_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": b64, "format": target_fmt}},
                    {"type": "text", "text": "Transcribe the audio. Return ONLY the transcript text."},
                ],
            }
        ],
        "temperature": 0,
    }

    # IMPORTANT: config default already ends with /chat/completions
    url = settings.OPENROUTER_BASE_URL

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            print("Auth header starts:", headers["Authorization"][:20])
            r = await client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        return {"transcript": "", "segmentType": segment_type or "unknown", "error": "OpenRouter request failed", "detail": str(e)}

    try:
        choice0 = (data.get("choices") or [])[0]
        msg = choice0.get("message") or {}
        transcript = _extract_text_from_or_message_content(msg.get("content"))
        return {"transcript": transcript, "segmentType": segment_type or "unknown"}
    except Exception as e:
        return {"transcript": "", "segmentType": segment_type or "unknown", "error": "Bad OpenRouter response shape", "detail": str(e), "raw": data}