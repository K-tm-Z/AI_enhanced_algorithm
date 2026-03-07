from __future__ import annotations
from typing import Any, Dict, List, Tuple
from io import BytesIO
import xml.etree.ElementTree as ET

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas


def _flatten(prefix: str, obj: Any) -> List[Tuple[str, str]]:
    """
    Turn nested dict/list into flat key paths for generic rendering.
    """
    rows: List[Tuple[str, str]] = []

    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            rows.extend(_flatten(key, v))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            key = f"{prefix}[{i}]"
            rows.extend(_flatten(key, v))
    else:
        rows.append((prefix, "" if obj is None else str(obj)))

    return rows


def render_pdf_bytes(form_type: str, payload: Dict[str, Any]) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)

    width, height = LETTER
    y = height - 50

    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, f"Form Output: {form_type}")
    y -= 30

    c.setFont("Helvetica", 10)

    rows = _flatten("", payload)
    for k, v in rows:
        line = f"{k}: {v}"
        # basic wrap
        while len(line) > 110:
            c.drawString(50, y, line[:110])
            line = line[110:]
            y -= 14
            if y < 50:
                c.showPage()
                c.setFont("Helvetica", 10)
                y = height - 50

        c.drawString(50, y, line)
        y -= 14
        if y < 50:
            c.showPage()
            c.setFont("Helvetica", 10)
            y = height - 50

    c.save()
    return buf.getvalue()


def dict_to_xml_bytes(root_name: str, payload: Dict[str, Any]) -> bytes:
    def build(parent: ET.Element, key: str, value: Any):
        el = ET.SubElement(parent, key)

        if isinstance(value, dict):
            for k, v in value.items():
                build(el, k, v)
        elif isinstance(value, list):
            for item in value:
                item_el = ET.SubElement(el, "item")
                if isinstance(item, (dict, list)):
                    # nest
                    if isinstance(item, dict):
                        for k, v in item.items():
                            build(item_el, k, v)
                    else:
                        # list of lists not expected; stringify
                        item_el.text = str(item)
                else:
                    item_el.text = "" if item is None else str(item)
        else:
            el.text = "" if value is None else str(value)

    root = ET.Element(root_name)
    for k, v in payload.items():
        build(root, k, v)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)