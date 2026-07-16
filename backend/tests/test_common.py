"""Pure-helper tests — the JS-parity functions that silently drift if broken."""

from datetime import datetime

from app.common import iso, js_round, to_compact, to_dotted


def test_js_round_half_up():
    # Python's round() is banker's rounding (half-to-even); JS Math.round is
    # half-up. These are the cases that diverge.
    assert js_round(12.5) == 13
    assert js_round(13.5) == 14
    assert js_round(2.5) == 3
    assert js_round(0.5) == 1
    assert js_round(-0.5) == 0  # JS Math.round(-0.5) === -0 → 0


def test_js_round_percentages():
    # 0.925*100 == 92.5 → half-up rounds to 93 (banker's rounding would give 92).
    assert js_round(0.925 * 100) == 93
    assert js_round(0.6 * 100) == 60


def test_iso_appends_z_millis():
    dt = datetime(2026, 3, 25, 10, 30, 45, 123456)
    assert iso(dt) == "2026-03-25T10:30:45.123Z"


def test_iso_none():
    assert iso(None) is None


def test_to_dotted():
    assert to_dotted("Acme Hospital") == "acme.hospital"
    assert to_dotted("St. Mary's  Clinic!") == "st.mary.s.clinic"


def test_to_compact():
    assert to_compact("Acme Hospital") == "acmehospital"
    assert to_compact("St. Mary's Clinic") == "stmarysclinic"
