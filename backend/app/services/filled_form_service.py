import os
from typing import Optional, Tuple

import filetype
from fastapi import HTTPException, UploadFile


def _normalize_image_mime(mime: str, kind_mime: Optional[str], kind_ext: Optional[str]) -> str:
    if isinstance(mime, str) and mime.strip():
        return mime
    if isinstance(kind_mime, str) and kind_mime.strip():
        return kind_mime
    if isinstance(kind_ext, str) and kind_ext.strip():
        ext = kind_ext.lower().strip(".")
        return f"image/{ext}"
    return "image/png"


def _filename_ext(filename: Optional[str]) -> str:
    if not filename:
        return ""
    return os.path.splitext(filename)[1].lower().strip(".")


async def load_filled_form_image_bytes_and_mime(
    filled_form_file: UploadFile,
) -> Tuple[bytes, str]:
    """
    Loads the uploaded filled form and returns image bytes + a mime type suitable for the
    multimodal extraction pipeline.

    - If PDF: converts the first page to PNG bytes.
    - If image/*: returns original bytes.
    """
    data = await filled_form_file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty filled form file")

    # Prefer content sniffing over client-provided MIME.
    kind = filetype.guess(data)
    mime = filled_form_file.content_type or ""
    kind_mime = getattr(kind, "mime", None) if kind else None
    kind_ext = getattr(kind, "extension", None) if kind else None

    guessed_mime = _normalize_image_mime(mime=mime, kind_mime=kind_mime, kind_ext=kind_ext)
    ext = _filename_ext(filled_form_file.filename) or (kind_ext or "")

    is_pdf = (
        (isinstance(mime, str) and mime.lower().startswith("application/pdf"))
        or (kind_ext == "pdf")
        or (ext == "pdf")
    )

    if is_pdf:
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="PDF inputs require PyMuPDF. Add `pymupdf` to dependencies.",
            )

        try:
            doc = fitz.open(stream=data, filetype="pdf")
            if doc.page_count < 1:
                raise HTTPException(status_code=400, detail="PDF has no pages")
            page = doc.load_page(0)
            # 2x scale improves readability for OCR-like models.
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            png_bytes = pix.tobytes("png")
            return png_bytes, "image/png"
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed converting PDF: {str(e)}")

    # If it's an image, return as-is.
    if guessed_mime.startswith("image/"):
        return data, guessed_mime

    # Fallback: if filetype says it's an image by extension.
    if kind_ext in {"png", "jpg", "jpeg", "webp"}:
        ext_lower = kind_ext.lower()
        return data, f"image/{'jpeg' if ext_lower == 'jpg' else ext_lower}"

    raise HTTPException(
        status_code=400,
        detail=f"Unsupported filled form file type (mime={mime}, ext={ext}, kind_mime={kind_mime})",
    )

