"""Document extraction (OCR) via Groq vision.

A hospital uploads a bill / discharge-summary image; a Groq multimodal model
reads it and returns the structured claim fields to pre-fill the claim form.

Requires GROQ_API_KEY. Without it (or on any failure) we return enabled=False
with a friendly note — the rest of the platform keeps working via the form.
"""

from __future__ import annotations

import json
import os

from .schemas import ExtractedLineItem, ExtractRequest, ExtractResult

VISION_MODEL = os.environ.get(
    "NOLOOP_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
)

PROMPT = (
    "You are reading a hospital bill or discharge summary for a health-insurance "
    "claim. Extract the fields and return ONLY a JSON object with these keys:\n"
    "  patientName (string), patientAge (integer), patientGender ('M' or 'F'),\n"
    "  procedure (string), diagnosis (string),\n"
    "  admittedAt (YYYY-MM-DD), dischargedAt (YYYY-MM-DD),\n"
    "  lineItems (array of objects with: desc (string), amountRupees (number)),\n"
    "  totalRupees (number).\n"
    "Use null for any field that is not visible. Amounts are in Indian Rupees."
)


def _paise(v) -> int | None:
    if v in (None, ""):
        return None
    try:
        return int(round(float(v) * 100))
    except (TypeError, ValueError):
        return None


def extract_document(req: ExtractRequest) -> ExtractResult:
    if not os.environ.get("GROQ_API_KEY"):
        return ExtractResult(
            enabled=False,
            note="Document scanning needs GROQ_API_KEY on the AI engine. Fill the form manually for now.",
        )
    try:
        from groq import Groq

        client = Groq()
        data_url = f"data:{req.mimeType};base64,{req.imageBase64}"
        resp = client.chat.completions.create(
            model=VISION_MODEL,
            temperature=0,
            max_tokens=1024,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        )
        data = json.loads(resp.choices[0].message.content or "{}")

        items: list[ExtractedLineItem] = []
        for li in data.get("lineItems") or []:
            amt = _paise(li.get("amountRupees"))
            if li.get("desc") and amt is not None:
                items.append(ExtractedLineItem(desc=str(li["desc"]), amountPaise=amt))

        age = data.get("patientAge")
        try:
            age = int(age) if age not in (None, "") else None
        except (TypeError, ValueError):
            age = None

        return ExtractResult(
            enabled=True,
            patientName=data.get("patientName"),
            patientAge=age,
            patientGender=data.get("patientGender"),
            procedure=data.get("procedure"),
            diagnosis=data.get("diagnosis"),
            admittedAt=data.get("admittedAt"),
            dischargedAt=data.get("dischargedAt"),
            lineItems=items,
            totalPaise=_paise(data.get("totalRupees")),
            note="Extracted by Groq vision — please review every field before submitting.",
            model=f"groq:{VISION_MODEL}",
        )
    except Exception as e:  # noqa: BLE001
        return ExtractResult(enabled=False, note=f"Extraction failed: {e}")
