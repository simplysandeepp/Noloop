"""Port of src/claims — submit + auto-adjudicate, listing, override, track."""

import base64
import secrets
import time
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import ai_client, observability
from .. import models as m
from ..ai_client import inr
from ..common import iso, js_round
from ..db import get_db
from ..deps import require_roles
from ..hardening import rate_limit

router = APIRouter(prefix="/claims", tags=["claims"])
track_router = APIRouter(prefix="/track", tags=["track"])

DAY_MS = 86_400_000

HospitalRoles = Depends(require_roles(m.Role.HOSPITAL_ADMIN, m.Role.HOSPITAL_STAFF))
InsurerRoles = Depends(
    require_roles(
        m.Role.INSURER_ADMIN, m.Role.INSURER_ADJUDICATOR, m.Role.PLATFORM_ADMIN
    )
)
AnyClaimRole = Depends(
    require_roles(
        m.Role.HOSPITAL_ADMIN,
        m.Role.HOSPITAL_STAFF,
        m.Role.INSURER_ADMIN,
        m.Role.INSURER_ADJUDICATOR,
        m.Role.PLATFORM_ADMIN,
    )
)


class LineItemIn(BaseModel):
    desc: str = Field(min_length=2)
    amountPaise: int = Field(ge=0)


class SubmitClaimIn(BaseModel):
    insurerTenantId: str
    type: Literal["CASHLESS", "REIMBURSEMENT"] | None = None
    patientName: str = Field(min_length=2)
    patientAge: int = Field(ge=0)
    patientGender: str
    memberId: str | None = None
    diagnosis: str = Field(min_length=2)
    procedure: str = Field(min_length=2)
    admittedAt: str
    dischargedAt: str
    lineItems: list[LineItemIn]
    totalPaise: int | None = Field(default=None, ge=0)
    admissionId: str | None = None


class OverrideClaimIn(BaseModel):
    verdict: Literal["APPROVE", "DENY", "QUERY"]
    approvedAmountPaise: int | None = Field(default=None, ge=0)
    note: str = Field(min_length=3)
    settle: bool | None = None


class RespondIn(BaseModel):
    message: str = ""


# ── helpers ──────────────────────────────────────────────


def _parse_dt(raw: str) -> datetime:
    """new Date(isoString) equivalent — store naive UTC like Prisma."""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(400, "Invalid date") from e
    if dt.tzinfo:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


async def _new_claim_number(db: AsyncSession) -> str:
    for _ in range(8):
        candidate = f"CLM-{100000 + secrets.randbelow(899999)}"
        taken = (
            await db.execute(
                select(m.Claim.id).where(m.Claim.claimNumber == candidate)
            )
        ).scalar_one_or_none()
        if not taken:
            return candidate
    return f"CLM-{int(time.time() * 1000)}"


def _verdict_to_status(v: str) -> m.ClaimStatus:
    if v == "APPROVE":
        return m.ClaimStatus.APPROVED
    if v == "DENY":
        return m.ClaimStatus.DENIED
    return m.ClaimStatus.QUERIED


def _severity(s: str) -> m.FraudSeverity:
    return (
        m.FraudSeverity.HIGH
        if s == "HIGH"
        else m.FraudSeverity.LOW
        if s == "LOW"
        else m.FraudSeverity.MEDIUM
    )


def _scope(user: dict) -> list:
    """Restrict a claim query to what this user is allowed to see."""
    role, tenant_id = user.get("role"), user.get("tenantId")
    if role == "PLATFORM_ADMIN":
        return []
    if role in ("HOSPITAL_ADMIN", "HOSPITAL_STAFF"):
        return [m.Claim.hospitalTenantId == (tenant_id or "__none__")]
    if role in ("INSURER_ADMIN", "INSURER_ADJUDICATOR"):
        return [m.Claim.insurerTenantId == (tenant_id or "__none__")]
    return [m.Claim.id == "__none__"]


def _event_row(e: m.ClaimEvent) -> dict:
    return {
        "id": e.id,
        "claimId": e.claimId,
        "type": e.type.value,
        "message": e.message,
        "actorId": e.actorId,
        "metadata": e.metadata_,
        "createdAt": iso(e.createdAt),
    }


def _full(c: m.Claim) -> dict:
    """Prisma's get() include shape: every scalar + the named relations."""
    return {
        "id": c.id,
        "claimNumber": c.claimNumber,
        "type": c.type.value,
        "hospitalTenantId": c.hospitalTenantId,
        "insurerTenantId": c.insurerTenantId,
        "policyId": c.policyId,
        "patientId": c.patientId,
        "admissionId": c.admissionId,
        "patientName": c.patientName,
        "patientAge": c.patientAge,
        "patientGender": c.patientGender,
        "diagnosis": c.diagnosis,
        "procedure": c.procedure,
        "admittedAt": iso(c.admittedAt),
        "dischargedAt": iso(c.dischargedAt),
        "lengthOfStayDays": c.lengthOfStayDays,
        "sumInsuredPaise": c.sumInsuredPaise,
        "billedPaise": c.billedPaise,
        "lineItems": c.lineItems,
        "status": c.status.value,
        "verdict": c.verdict.value if c.verdict else None,
        "approvedAmountPaise": c.approvedAmountPaise,
        "confidence": c.confidence,
        "rationale": c.rationale,
        "citedClauseRefs": c.citedClauseRefs,
        "aiModel": c.aiModel,
        "aiLatencyMs": c.aiLatencyMs,
        "tatSeconds": c.tatSeconds,
        "submittedById": c.submittedById,
        "overriddenById": c.overriddenById,
        "overrideNote": c.overrideNote,
        "overriddenAt": iso(c.overriddenAt),
        "submittedAt": iso(c.submittedAt),
        "decidedAt": iso(c.decidedAt),
        "settledAt": iso(c.settledAt),
        "hospital": {"name": c.hospital.name},
        "insurer": {"name": c.insurer.name},
        "policy": (
            {"name": c.policy.name, "planCode": c.policy.planCode}
            if c.policy
            else None
        ),
        "patient": {"memberId": c.patient.memberId} if c.patient else None,
        "fraudFlags": [
            {
                "id": f.id,
                "claimId": f.claimId,
                "signal": f.signal,
                "severity": f.severity.value,
                "detail": f.detail,
                "createdAt": iso(f.createdAt),
            }
            for f in sorted(c.fraudFlags, key=lambda f: f.createdAt)
        ],
        "events": [_event_row(e) for e in sorted(c.events, key=lambda e: e.createdAt)],
        "decisions": [
            {
                "id": d.id,
                "claimId": d.claimId,
                "verdict": d.verdict.value,
                "approvedAmountPaise": d.approvedAmountPaise,
                "confidence": d.confidence,
                "rationale": d.rationale,
                "citedClauseRefs": d.citedClauseRefs,
                "model": d.model,
                "latencyMs": d.latencyMs,
                "createdAt": iso(d.createdAt),
            }
            for d in sorted(c.decisions, key=lambda d: d.createdAt, reverse=True)
        ],
        "overriddenBy": (
            {"name": c.overriddenBy.name, "email": c.overriddenBy.email}
            if c.overriddenBy
            else None
        ),
    }


_FULL_OPTS = (
    selectinload(m.Claim.hospital),
    selectinload(m.Claim.insurer),
    selectinload(m.Claim.policy),
    selectinload(m.Claim.patient),
    selectinload(m.Claim.fraudFlags),
    selectinload(m.Claim.events),
    selectinload(m.Claim.decisions),
    selectinload(m.Claim.overriddenBy),
)


async def _get_full(db: AsyncSession, user: dict, claim_id: str) -> dict:
    claim = (
        await db.execute(
            select(m.Claim)
            .where(m.Claim.id == claim_id, *_scope(user))
            .options(*_FULL_OPTS)
        )
    ).scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Claim not found")
    return _full(claim)


async def _scoped_claim(db: AsyncSession, user: dict, claim_id: str) -> m.Claim:
    claim = (
        await db.execute(select(m.Claim).where(m.Claim.id == claim_id, *_scope(user)))
    ).scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "Claim not found")
    return claim


# ── submit + auto-adjudicate (the automated workflow) ─────


@router.post("")
async def submit(
    dto: SubmitClaimIn, user: dict = HospitalRoles, db: AsyncSession = Depends(get_db)
):
    if not user.get("tenantId"):
        raise HTTPException(400, "No hospital on token")
    hospital = await db.get(m.Tenant, user["tenantId"])
    if not hospital or hospital.type != m.TenantType.HOSPITAL:
        raise HTTPException(403, "Only hospitals can submit claims")

    insurer = await db.get(m.Tenant, dto.insurerTenantId)
    if not insurer or insurer.type != m.TenantType.INSURER:
        raise HTTPException(400, "Target insurer not found")

    # Resolve patient (optional) + the policy that governs coverage.
    patient = None
    if dto.memberId:
        patient = (
            await db.execute(
                select(m.Patient)
                .where(m.Patient.memberId == dto.memberId)
                .options(selectinload(m.Patient.policy))
            )
        ).scalar_one_or_none()
        if patient and patient.insurerTenantId != insurer.id:
            patient = None

    policy = patient.policy if patient and patient.policy else None
    if not policy:
        policy = (
            await db.execute(
                select(m.Policy)
                .where(m.Policy.insurerTenantId == insurer.id)
                .order_by(m.Policy.createdAt.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
    if not policy:
        raise HTTPException(400, "This insurer has no policy configured yet")

    billed = (
        dto.totalPaise
        if dto.totalPaise is not None
        else sum(li.amountPaise for li in dto.lineItems)
    )
    admitted_at = _parse_dt(dto.admittedAt)
    discharged_at = _parse_dt(dto.dischargedAt)
    delta_ms = (discharged_at - admitted_at).total_seconds() * 1000
    los = max(1, int(delta_ms / DAY_MS + 0.5))

    claim_number = await _new_claim_number(db)
    submitted_at = _now()

    # 1. Persist the claim in PROCESSING with its opening timeline events.
    claim = m.Claim(
        claimNumber=claim_number,
        type=m.ClaimType(dto.type) if dto.type else m.ClaimType.CASHLESS,
        hospitalTenantId=hospital.id,
        insurerTenantId=insurer.id,
        policyId=policy.id,
        patientId=patient.id if patient else None,
        admissionId=dto.admissionId,
        patientName=dto.patientName,
        patientAge=dto.patientAge,
        patientGender=dto.patientGender,
        diagnosis=dto.diagnosis,
        procedure=dto.procedure,
        admittedAt=admitted_at,
        dischargedAt=discharged_at,
        lengthOfStayDays=los,
        sumInsuredPaise=policy.sumInsuredPaise,
        billedPaise=billed,
        lineItems=[li.model_dump() for li in dto.lineItems],
        status=m.ClaimStatus.PROCESSING,
        submittedById=user["sub"],
        submittedAt=submitted_at,
    )
    db.add(claim)
    await db.flush()
    db.add(
        m.ClaimEvent(
            claimId=claim.id,
            type=m.ClaimEventType.SUBMITTED,
            message=f"Claim {claim_number} submitted by {hospital.name} to {insurer.name}.",
            actorId=user["sub"],
        )
    )
    db.add(
        m.ClaimEvent(
            claimId=claim.id,
            type=m.ClaimEventType.AI_STARTED,
            message="AI adjudication engine started.",
        )
    )
    await db.commit()

    # 2. Run the engine.
    packet = {
        "ref": claim_number,
        "type": claim.type.value,
        "hospital": hospital.name,
        "insurer": insurer.name,
        "policy": {
            "policyNo": policy.planCode,
            "sumInsuredPaise": policy.sumInsuredPaise,
            "roomRentCapPerDayPaise": policy.roomRentCapPerDayPaise,
            "copayPct": policy.copayPct,
            "coveredProcedures": policy.coveredProcedures,
            "exclusions": policy.exclusions,
        },
        "admission": {
            "admittedAt": dto.admittedAt[:10],
            "dischargedAt": dto.dischargedAt[:10],
            "lengthOfStayDays": los,
            "procedure": dto.procedure,
            "diagnosis": dto.diagnosis,
        },
        "bill": {
            "lineItems": [li.model_dump() for li in dto.lineItems],
            "totalPaise": billed,
        },
        "dischargeSummary": (
            f"Patient {dto.patientName} ({dto.patientAge}y) admitted for "
            f"{dto.procedure}; {los} day(s); billed ₹{inr(billed / 100)}."
        ),
    }
    decision, latency_ms = await ai_client.adjudicate(packet)
    observability.record_decision(decision)

    decided_at = _now()
    tat_seconds = max(0, int((decided_at - submitted_at).total_seconds() + 0.5))
    status = _verdict_to_status(decision["verdict"])

    # 3. Persist decision, flags, and closing events; mirror onto the claim.
    db.add(
        m.Decision(
            claimId=claim.id,
            verdict=m.Verdict(decision["verdict"]),
            approvedAmountPaise=decision.get("approvedAmountPaise"),
            confidence=decision["confidence"],
            rationale=decision["rationale"],
            citedClauseRefs=decision["citedClauseRefs"],
            model=decision["model"],
            latencyMs=latency_ms,
        )
    )
    for f in decision["fraudFlags"]:
        db.add(
            m.FraudFlag(
                claimId=claim.id,
                signal=f["signal"],
                severity=_severity(f["severity"]),
                detail=f["detail"],
            )
        )
    db.add(
        m.ClaimEvent(
            claimId=claim.id,
            type=m.ClaimEventType.AI_DECISION,
            message=(
                f"AI verdict: {decision['verdict']} "
                f"({js_round(decision['confidence'] * 100)}% confidence, {latency_ms}ms). "
                f"{decision['rationale']}"
            ),
        )
    )
    if decision["fraudFlags"]:
        db.add(
            m.ClaimEvent(
                claimId=claim.id,
                type=m.ClaimEventType.FRAUD_FLAGGED,
                message=(
                    f"{len(decision['fraudFlags'])} anomaly signal(s): "
                    + ", ".join(f["signal"] for f in decision["fraudFlags"])
                    + "."
                ),
            )
        )
    if decision["verdict"] == "QUERY":
        db.add(
            m.ClaimEvent(
                claimId=claim.id,
                type=m.ClaimEventType.QUERY_RAISED,
                message="Routed for review — additional information required.",
            )
        )
    claim.status = status
    claim.verdict = m.Verdict(decision["verdict"])
    claim.approvedAmountPaise = decision.get("approvedAmountPaise")
    claim.confidence = decision["confidence"]
    claim.rationale = decision["rationale"]
    claim.citedClauseRefs = decision["citedClauseRefs"]
    claim.aiModel = decision["model"]
    claim.aiLatencyMs = latency_ms
    claim.tatSeconds = tat_seconds
    claim.decidedAt = decided_at
    await db.commit()

    return await _get_full(db, user, claim.id)


@router.post("/extract")
async def extract(file: UploadFile | None = None, user: dict = HospitalRoles):
    """OCR an uploaded claim document (bill / discharge summary) via Groq vision."""
    if file is None:
        raise HTTPException(400, "No file uploaded")
    data = await file.read()
    if not data:
        raise HTTPException(400, "No file uploaded")
    return await ai_client.extract_document(
        base64.b64encode(data).decode(), file.content_type or "image/jpeg"
    )


# ── listing + detail ─────────────────────────────────────


@router.get("")
async def list_claims(
    status: str | None = Query(default=None),
    user: dict = AnyClaimRole,
    db: AsyncSession = Depends(get_db),
):
    where = _scope(user)
    if status:
        where.append(m.Claim.status == m.ClaimStatus(status))
    rows = (
        await db.execute(
            select(m.Claim, func.count(m.FraudFlag.id))
            .outerjoin(m.FraudFlag, m.FraudFlag.claimId == m.Claim.id)
            .where(*where)
            .group_by(m.Claim.id)
            .order_by(m.Claim.submittedAt.desc())
            .limit(200)
            .options(selectinload(m.Claim.hospital), selectinload(m.Claim.insurer))
        )
    ).all()
    return [
        {
            "id": c.id,
            "claimNumber": c.claimNumber,
            "type": c.type.value,
            "patientName": c.patientName,
            "procedure": c.procedure,
            "hospital": c.hospital.name,
            "insurer": c.insurer.name,
            "billedPaise": c.billedPaise,
            "approvedAmountPaise": c.approvedAmountPaise,
            "status": c.status.value,
            "verdict": c.verdict.value if c.verdict else None,
            "confidence": c.confidence,
            "fraudFlagCount": n,
            "tatSeconds": c.tatSeconds,
            "submittedAt": iso(c.submittedAt),
            "decidedAt": iso(c.decidedAt),
        }
        for c, n in rows
    ]


@router.get("/{claim_id}")
async def get_claim(
    claim_id: str, user: dict = AnyClaimRole, db: AsyncSession = Depends(get_db)
):
    return await _get_full(db, user, claim_id)


# ── insurer override / settle ────────────────────────────


@router.post("/{claim_id}/override")
async def override(
    claim_id: str,
    dto: OverrideClaimIn,
    user: dict = InsurerRoles,
    db: AsyncSession = Depends(get_db),
):
    claim = await _scoped_claim(db, user, claim_id)

    status = (
        (m.ClaimStatus.SETTLED if dto.settle else m.ClaimStatus.APPROVED)
        if dto.verdict == "APPROVE"
        else m.ClaimStatus.DENIED
        if dto.verdict == "DENY"
        else m.ClaimStatus.UNDER_REVIEW
    )
    approved = (
        (
            dto.approvedAmountPaise
            if dto.approvedAmountPaise is not None
            else claim.approvedAmountPaise
            if claim.approvedAmountPaise is not None
            else claim.billedPaise
        )
        if dto.verdict == "APPROVE"
        else 0
        if dto.verdict == "DENY"
        else claim.approvedAmountPaise
    )

    claim.status = status
    claim.verdict = m.Verdict(dto.verdict)
    claim.approvedAmountPaise = approved
    claim.overriddenById = user["sub"]
    claim.overrideNote = dto.note
    claim.overriddenAt = _now()
    if dto.settle:
        claim.settledAt = _now()
    amount_part = (
        f" (₹{inr(approved / 100)})"
        if dto.verdict == "APPROVE" and approved is not None
        else ""
    )
    db.add(
        m.ClaimEvent(
            claimId=claim_id,
            type=m.ClaimEventType.OVERRIDDEN,
            message=f"Adjudicator override → {dto.verdict}{amount_part}. {dto.note}",
            actorId=user["sub"],
        )
    )
    if dto.settle:
        db.add(
            m.ClaimEvent(
                claimId=claim_id,
                type=m.ClaimEventType.SETTLED,
                message="Claim settled — payout released.",
                actorId=user["sub"],
            )
        )
    await db.commit()
    return await _get_full(db, user, claim_id)


@router.post("/{claim_id}/settle")
async def settle(
    claim_id: str, user: dict = InsurerRoles, db: AsyncSession = Depends(get_db)
):
    claim = await _scoped_claim(db, user, claim_id)
    claim.status = m.ClaimStatus.SETTLED
    claim.settledAt = _now()
    db.add(
        m.ClaimEvent(
            claimId=claim_id,
            type=m.ClaimEventType.SETTLED,
            message="Claim settled — payout released.",
            actorId=user["sub"],
        )
    )
    await db.commit()
    return await _get_full(db, user, claim_id)


@router.post("/{claim_id}/respond")
async def respond(
    claim_id: str,
    body: RespondIn,
    user: dict = HospitalRoles,
    db: AsyncSession = Depends(get_db),
):
    """Hospital responds to a raised query; routes the claim to a human reviewer."""
    claim = await _scoped_claim(db, user, claim_id)
    claim.status = m.ClaimStatus.UNDER_REVIEW
    db.add(
        m.ClaimEvent(
            claimId=claim_id,
            type=m.ClaimEventType.NOTE,
            message=f"Hospital response: {body.message}",
            actorId=user["sub"],
        )
    )
    await db.commit()
    return await _get_full(db, user, claim_id)


# ── public claim tracking (patient timeline) ─────────────


@track_router.get("/{claim_number}")
async def track(
    claim_number: str,
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(rate_limit("track", limit=30, window=60)),
):
    """Public claim tracking — a patient can follow a claim by its number."""
    claim = (
        await db.execute(
            select(m.Claim)
            .where(m.Claim.claimNumber == claim_number)
            .options(
                selectinload(m.Claim.hospital),
                selectinload(m.Claim.insurer),
                selectinload(m.Claim.events),
                selectinload(m.Claim.fraudFlags),
            )
        )
    ).scalar_one_or_none()
    if not claim:
        raise HTTPException(404, "No claim with that number")
    return {
        "claimNumber": claim.claimNumber,
        "patientName": claim.patientName,
        "procedure": claim.procedure,
        "hospital": claim.hospital.name,
        "insurer": claim.insurer.name,
        "status": claim.status.value,
        "verdict": claim.verdict.value if claim.verdict else None,
        "billedPaise": claim.billedPaise,
        "approvedAmountPaise": claim.approvedAmountPaise,
        "rationale": claim.rationale,
        "tatSeconds": claim.tatSeconds,
        "submittedAt": iso(claim.submittedAt),
        "decidedAt": iso(claim.decidedAt),
        "settledAt": iso(claim.settledAt),
        "events": [
            _event_row(e) for e in sorted(claim.events, key=lambda e: e.createdAt)
        ],
        "flagCount": len(claim.fraudFlags),
    }
