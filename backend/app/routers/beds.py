"""Port of src/beds — live capacity, admit into first free bed, discharge."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import models as m
from ..common import iso, js_round
from ..db import get_db
from ..deps import require_roles

router = APIRouter(prefix="/beds", tags=["beds"])

HospitalRoles = Depends(require_roles(m.Role.HOSPITAL_ADMIN, m.Role.HOSPITAL_STAFF))


class AdmitIn(BaseModel):
    patientName: str = Field(min_length=2)
    patientAge: int = Field(ge=0)
    patientGender: str
    diagnosis: str = Field(min_length=2)
    procedure: str = Field(min_length=2)
    wardId: str | None = None
    memberId: str | None = None


async def _hospital(db: AsyncSession, tenant_id: str | None) -> m.Tenant:
    if not tenant_id:
        raise HTTPException(400, "No hospital on token")
    t = await db.get(m.Tenant, tenant_id)
    if not t or t.type != m.TenantType.HOSPITAL:
        raise HTTPException(400, "Not a hospital account")
    return t


def _admission_row(a: m.Admission) -> dict:
    return {
        "id": a.id,
        "hospitalTenantId": a.hospitalTenantId,
        "bedId": a.bedId,
        "patientId": a.patientId,
        "patientName": a.patientName,
        "patientAge": a.patientAge,
        "patientGender": a.patientGender,
        "diagnosis": a.diagnosis,
        "procedure": a.procedure,
        "status": a.status.value,
        "admittedAt": iso(a.admittedAt),
        "dischargedAt": iso(a.dischargedAt),
        "createdAt": iso(a.createdAt),
    }


@router.get("/overview")
async def overview(user: dict = HospitalRoles, db: AsyncSession = Depends(get_db)):
    """Live capacity snapshot: per-ward counts + who is in each occupied bed."""
    hospital = await _hospital(db, user.get("tenantId"))
    wards = (
        (
            await db.execute(
                select(m.Ward)
                .where(m.Ward.hospitalTenantId == hospital.id)
                .order_by(m.Ward.name.asc())
                .options(selectinload(m.Ward.beds))
            )
        )
        .scalars()
        .all()
    )
    active = (
        (
            await db.execute(
                select(m.Admission)
                .where(
                    m.Admission.hospitalTenantId == hospital.id,
                    m.Admission.status == m.AdmissionStatus.ADMITTED,
                )
                .order_by(m.Admission.admittedAt.desc())
                .options(selectinload(m.Admission.bed).selectinload(m.Bed.ward))
            )
        )
        .scalars()
        .all()
    )

    total_beds = sum(len(w.beds) for w in wards)
    occupied = sum(
        1 for w in wards for b in w.beds if b.status == m.BedStatus.OCCUPIED
    )
    maintenance = sum(
        1 for w in wards for b in w.beds if b.status == m.BedStatus.MAINTENANCE
    )

    return {
        "totalBeds": total_beds,
        "available": total_beds - occupied - maintenance,
        "occupied": occupied,
        "maintenance": maintenance,
        "occupancyRate": js_round(occupied / total_beds * 100) if total_beds else 0,
        "wards": [
            {
                "id": w.id,
                "name": w.name,
                "totalBeds": len(w.beds),
                "occupied": (
                    occ := sum(1 for b in w.beds if b.status == m.BedStatus.OCCUPIED)
                ),
                "available": len(w.beds)
                - occ
                - sum(1 for b in w.beds if b.status == m.BedStatus.MAINTENANCE),
            }
            for w in wards
        ],
        "patients": [
            {
                "admissionId": a.id,
                "patientName": a.patientName,
                "patientAge": a.patientAge,
                "patientGender": a.patientGender,
                "diagnosis": a.diagnosis,
                "procedure": a.procedure,
                "ward": a.bed.ward.name if a.bed else "—",
                "bed": a.bed.label if a.bed else "—",
                "admittedAt": iso(a.admittedAt),
            }
            for a in active
        ],
    }


@router.post("/admit")
async def admit(
    dto: AdmitIn, user: dict = HospitalRoles, db: AsyncSession = Depends(get_db)
):
    """Admit a patient into the first available bed (optionally in a ward)."""
    hospital = await _hospital(db, user.get("tenantId"))
    q = select(m.Bed).where(
        m.Bed.hospitalTenantId == hospital.id,
        m.Bed.status == m.BedStatus.AVAILABLE,
    )
    if dto.wardId:
        q = q.where(m.Bed.wardId == dto.wardId)
    bed = (
        await db.execute(q.order_by(m.Bed.label.asc()).limit(1))
    ).scalar_one_or_none()
    if not bed:
        raise HTTPException(
            400, "No available beds" + (" in that ward" if dto.wardId else "")
        )

    patient = None
    if dto.memberId:
        patient = (
            await db.execute(
                select(m.Patient).where(m.Patient.memberId == dto.memberId)
            )
        ).scalar_one_or_none()

    admission = m.Admission(
        hospitalTenantId=hospital.id,
        bedId=bed.id,
        patientId=patient.id if patient else None,
        patientName=dto.patientName,
        patientAge=dto.patientAge,
        patientGender=dto.patientGender,
        diagnosis=dto.diagnosis,
        procedure=dto.procedure,
        status=m.AdmissionStatus.ADMITTED,
    )
    db.add(admission)
    bed.status = m.BedStatus.OCCUPIED
    await db.commit()
    return _admission_row(admission)


@router.post("/discharge/{admission_id}")
async def discharge(
    admission_id: str, user: dict = HospitalRoles, db: AsyncSession = Depends(get_db)
):
    """Discharge a patient and free their bed."""
    hospital = await _hospital(db, user.get("tenantId"))
    admission = (
        await db.execute(
            select(m.Admission).where(
                m.Admission.id == admission_id,
                m.Admission.hospitalTenantId == hospital.id,
            )
        )
    ).scalar_one_or_none()
    if not admission:
        raise HTTPException(404, "Admission not found")
    if admission.status == m.AdmissionStatus.DISCHARGED:
        return _admission_row(admission)

    admission.status = m.AdmissionStatus.DISCHARGED
    admission.dischargedAt = datetime.now(UTC).replace(tzinfo=None)
    if admission.bedId:
        bed = await db.get(m.Bed, admission.bedId)
        if bed:
            bed.status = m.BedStatus.AVAILABLE
    await db.commit()
    return _admission_row(admission)
