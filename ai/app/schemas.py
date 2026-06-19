"""Pydantic models for the NoLoop adjudication engine.

These mirror the synthetic claim packets produced by the generator
(Noloop/backend/scripts/generate-synthetic-claims.ts) and the Decision
shape the platform stores. Money is always in paise (integers).
"""

from __future__ import annotations

from enum import Enum
from pydantic import BaseModel, Field


# ── enums (mirror packages/shared + Prisma) ──
class Verdict(str, Enum):
    APPROVE = "APPROVE"
    DENY = "DENY"
    QUERY = "QUERY"


class FraudSignal(str, Enum):
    BILL_MATH_MISMATCH = "BILL_MATH_MISMATCH"
    DATE_INCONSISTENCY = "DATE_INCONSISTENCY"
    DUPLICATE_CLAIM = "DUPLICATE_CLAIM"
    LENGTH_OF_STAY_ANOMALY = "LENGTH_OF_STAY_ANOMALY"
    AMOUNT_OUTLIER = "AMOUNT_OUTLIER"
    POLICY_EXCLUSION = "POLICY_EXCLUSION"
    LLM_ANOMALY = "LLM_ANOMALY"


class Severity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


# ── input: a claim packet ──
class LineItem(BaseModel):
    desc: str
    amountPaise: int


class Policy(BaseModel):
    policyNo: str | None = None
    sumInsuredPaise: int
    # Per-day room-rent ceiling — anything above is the patient's liability.
    roomRentCapPerDayPaise: int | None = None
    # Mandatory co-payment percentage borne by the patient.
    copayPct: int = 0
    coveredProcedures: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)


class Admission(BaseModel):
    admittedAt: str | None = None
    dischargedAt: str | None = None
    lengthOfStayDays: int
    procedure: str
    diagnosis: str | None = None


class Bill(BaseModel):
    lineItems: list[LineItem] = Field(default_factory=list)
    totalPaise: int


class ClaimPacket(BaseModel):
    ref: str
    type: str | None = None  # CASHLESS | REIMBURSEMENT
    hospital: str | None = None
    insurer: str | None = None
    policy: Policy
    admission: Admission
    bill: Bill
    dischargeSummary: str | None = None


# ── output ──
class FraudFlag(BaseModel):
    signal: FraudSignal
    severity: Severity
    detail: str


class CoverageResult(BaseModel):
    covered: bool
    reason: str
    citedClauseRefs: list[str] = Field(default_factory=list)


class Deduction(BaseModel):
    """A line of money subtracted from the billed amount, with a reason."""
    label: str
    amountPaise: int


# ── document extraction (OCR via Groq vision) ──
class ExtractRequest(BaseModel):
    imageBase64: str
    mimeType: str = "image/jpeg"


class ExtractedLineItem(BaseModel):
    desc: str
    amountPaise: int


class ExtractResult(BaseModel):
    enabled: bool
    patientName: str | None = None
    patientAge: int | None = None
    patientGender: str | None = None
    procedure: str | None = None
    diagnosis: str | None = None
    admittedAt: str | None = None
    dischargedAt: str | None = None
    lineItems: list[ExtractedLineItem] = Field(default_factory=list)
    totalPaise: int | None = None
    note: str | None = None
    model: str | None = None


class Decision(BaseModel):
    ref: str
    verdict: Verdict
    rationale: str
    citedClauseRefs: list[str] = Field(default_factory=list)
    fraudFlags: list[FraudFlag] = Field(default_factory=list)
    approvedAmountPaise: int | None = None
    deductions: list[Deduction] = Field(default_factory=list)
    confidence: float = 0.5
    # Which engine produced this — "rule-engine-v1" or a Claude model id.
    model: str = "rule-engine-v1"
