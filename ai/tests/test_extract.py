"""Extraction endpoint degrades gracefully without a Groq key."""


from app.extract import extract_document
from app.schemas import ExtractRequest


def test_extract_disabled_without_key(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    res = extract_document(ExtractRequest(imageBase64="", mimeType="image/jpeg"))
    assert res.enabled is False
    assert res.note and "GROQ_API_KEY" in res.note


def test_paise_conversion():
    from app.extract import _paise

    assert _paise(100) == 10000
    assert _paise("12.34") == 1234
    assert _paise(None) is None
    assert _paise("") is None
    assert _paise("nan-value") is None
