"""SQLAlchemy models mirroring prisma/schema.prisma 1:1.

Table names are Prisma's PascalCase model names, columns stay camelCase,
enum types reuse the Postgres enums Prisma already created — so this maps
onto the EXISTING Supabase tables with no migration. IDs keep the cuid
format via cuid2 (client-side default, like Prisma).
"""

import enum
from datetime import datetime

from cuid2 import Cuid
from sqlalchemy import (
    ARRAY,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

_cuid = Cuid(length=25)


def new_id() -> str:
    return _cuid.generate()


class Base(DeclarativeBase):
    pass


# ── enums (names must match the Postgres enum types Prisma created) ──


class TenantType(str, enum.Enum):
    INSURER = "INSURER"
    HOSPITAL = "HOSPITAL"


class Role(str, enum.Enum):
    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    HOSPITAL_ADMIN = "HOSPITAL_ADMIN"
    INSURER_ADMIN = "INSURER_ADMIN"
    HOSPITAL_STAFF = "HOSPITAL_STAFF"
    INSURER_ADJUDICATOR = "INSURER_ADJUDICATOR"
    PATIENT = "PATIENT"


class UserStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"


class ClaimType(str, enum.Enum):
    CASHLESS = "CASHLESS"
    REIMBURSEMENT = "REIMBURSEMENT"


class Verdict(str, enum.Enum):
    APPROVE = "APPROVE"
    DENY = "DENY"
    QUERY = "QUERY"


class ClaimStatus(str, enum.Enum):
    SUBMITTED = "SUBMITTED"
    PROCESSING = "PROCESSING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    QUERIED = "QUERIED"
    UNDER_REVIEW = "UNDER_REVIEW"
    SETTLED = "SETTLED"


class FraudSeverity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class BedStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    OCCUPIED = "OCCUPIED"
    MAINTENANCE = "MAINTENANCE"


class AdmissionStatus(str, enum.Enum):
    ADMITTED = "ADMITTED"
    DISCHARGED = "DISCHARGED"


class ClaimEventType(str, enum.Enum):
    SUBMITTED = "SUBMITTED"
    AI_STARTED = "AI_STARTED"
    AI_DECISION = "AI_DECISION"
    FRAUD_FLAGGED = "FRAUD_FLAGGED"
    QUERY_RAISED = "QUERY_RAISED"
    OVERRIDDEN = "OVERRIDDEN"
    SETTLED = "SETTLED"
    NOTE = "NOTE"


def _pg_enum(e: type[enum.Enum]) -> Enum:
    # values_callable keeps the string VALUES (not python names) on the wire;
    # create_type=False — Prisma already created these types in Postgres.
    return Enum(
        e,
        name=e.__name__,
        create_type=False,
        values_callable=lambda x: [i.value for i in x],
    )


# Prisma DateTime = timestamp(3) without time zone.
_ts = DateTime(timezone=False)


# ── models ──


class Tenant(Base):
    __tablename__ = "Tenant"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    type: Mapped[TenantType] = mapped_column(_pg_enum(TenantType))
    name: Mapped[str] = mapped_column(String)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="tenant")


class User(Base):
    __tablename__ = "User"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str | None] = mapped_column(String)
    passwordHash: Mapped[str] = mapped_column(String)
    role: Mapped[Role] = mapped_column(_pg_enum(Role))
    status: Mapped[UserStatus] = mapped_column(
        _pg_enum(UserStatus), default=UserStatus.ACTIVE
    )
    tenantId: Mapped[str | None] = mapped_column(ForeignKey("Tenant.id"))
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    tenant: Mapped[Tenant | None] = relationship(back_populates="users")


class ActivityLog(Base):
    __tablename__ = "ActivityLog"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    tenantId: Mapped[str | None] = mapped_column(ForeignKey("Tenant.id"))
    actorId: Mapped[str | None] = mapped_column(ForeignKey("User.id"))
    action: Mapped[str] = mapped_column(String)
    detail: Mapped[str | None] = mapped_column(String)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    tenant: Mapped[Tenant | None] = relationship()
    actor: Mapped[User | None] = relationship()


class Policy(Base):
    __tablename__ = "Policy"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    insurerTenantId: Mapped[str] = mapped_column(ForeignKey("Tenant.id"))
    name: Mapped[str] = mapped_column(String)
    planCode: Mapped[str] = mapped_column(String)
    sumInsuredPaise: Mapped[int] = mapped_column(Integer)
    roomRentCapPerDayPaise: Mapped[int | None] = mapped_column(Integer)
    copayPct: Mapped[int] = mapped_column(Integer, default=0)
    waitingPeriodDays: Mapped[int] = mapped_column(Integer, default=0)
    coveredProcedures: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    exclusions: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    insurer: Mapped[Tenant] = relationship()


class Patient(Base):
    __tablename__ = "Patient"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    insurerTenantId: Mapped[str] = mapped_column(ForeignKey("Tenant.id"))
    policyId: Mapped[str | None] = mapped_column(ForeignKey("Policy.id"))
    memberId: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    age: Mapped[int] = mapped_column(Integer)
    gender: Mapped[str] = mapped_column(String)
    phone: Mapped[str | None] = mapped_column(String)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    insurer: Mapped[Tenant] = relationship()
    policy: Mapped[Policy | None] = relationship()


class Ward(Base):
    __tablename__ = "Ward"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    hospitalTenantId: Mapped[str] = mapped_column(ForeignKey("Tenant.id"))
    name: Mapped[str] = mapped_column(String)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    beds: Mapped[list["Bed"]] = relationship(back_populates="ward")


class Bed(Base):
    __tablename__ = "Bed"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    hospitalTenantId: Mapped[str] = mapped_column(ForeignKey("Tenant.id"))
    wardId: Mapped[str] = mapped_column(ForeignKey("Ward.id"))
    label: Mapped[str] = mapped_column(String)
    status: Mapped[BedStatus] = mapped_column(
        _pg_enum(BedStatus), default=BedStatus.AVAILABLE
    )
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    ward: Mapped[Ward] = relationship(back_populates="beds")


class Admission(Base):
    __tablename__ = "Admission"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    hospitalTenantId: Mapped[str] = mapped_column(ForeignKey("Tenant.id"))
    bedId: Mapped[str | None] = mapped_column(ForeignKey("Bed.id"))
    patientId: Mapped[str | None] = mapped_column(ForeignKey("Patient.id"))
    patientName: Mapped[str] = mapped_column(String)
    patientAge: Mapped[int] = mapped_column(Integer)
    patientGender: Mapped[str] = mapped_column(String)
    diagnosis: Mapped[str] = mapped_column(String)
    procedure: Mapped[str] = mapped_column(String)
    status: Mapped[AdmissionStatus] = mapped_column(
        _pg_enum(AdmissionStatus), default=AdmissionStatus.ADMITTED
    )
    admittedAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)
    dischargedAt: Mapped[datetime | None] = mapped_column(_ts)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    bed: Mapped[Bed | None] = relationship()
    patient: Mapped[Patient | None] = relationship()


class Claim(Base):
    __tablename__ = "Claim"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    claimNumber: Mapped[str] = mapped_column(String, unique=True)
    type: Mapped[ClaimType] = mapped_column(
        _pg_enum(ClaimType), default=ClaimType.CASHLESS
    )

    hospitalTenantId: Mapped[str] = mapped_column(ForeignKey("Tenant.id"))
    insurerTenantId: Mapped[str] = mapped_column(ForeignKey("Tenant.id"))
    policyId: Mapped[str | None] = mapped_column(ForeignKey("Policy.id"))
    patientId: Mapped[str | None] = mapped_column(ForeignKey("Patient.id"))
    admissionId: Mapped[str | None] = mapped_column(
        ForeignKey("Admission.id"), unique=True
    )

    patientName: Mapped[str] = mapped_column(String)
    patientAge: Mapped[int] = mapped_column(Integer)
    patientGender: Mapped[str] = mapped_column(String)
    diagnosis: Mapped[str] = mapped_column(String)
    procedure: Mapped[str] = mapped_column(String)
    admittedAt: Mapped[datetime] = mapped_column(_ts)
    dischargedAt: Mapped[datetime] = mapped_column(_ts)
    lengthOfStayDays: Mapped[int] = mapped_column(Integer)
    sumInsuredPaise: Mapped[int] = mapped_column(Integer)
    billedPaise: Mapped[int] = mapped_column(Integer)
    lineItems: Mapped[list | dict] = mapped_column(JSONB)

    status: Mapped[ClaimStatus] = mapped_column(
        _pg_enum(ClaimStatus), default=ClaimStatus.SUBMITTED
    )

    verdict: Mapped[Verdict | None] = mapped_column(_pg_enum(Verdict))
    approvedAmountPaise: Mapped[int | None] = mapped_column(Integer)
    confidence: Mapped[float | None] = mapped_column(Float)
    rationale: Mapped[str | None] = mapped_column(Text)
    citedClauseRefs: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    aiModel: Mapped[str | None] = mapped_column(String)
    aiLatencyMs: Mapped[int | None] = mapped_column(Integer)
    tatSeconds: Mapped[int | None] = mapped_column(Integer)

    submittedById: Mapped[str | None] = mapped_column(ForeignKey("User.id"))
    overriddenById: Mapped[str | None] = mapped_column(ForeignKey("User.id"))
    overrideNote: Mapped[str | None] = mapped_column(Text)
    overriddenAt: Mapped[datetime | None] = mapped_column(_ts)

    submittedAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)
    decidedAt: Mapped[datetime | None] = mapped_column(_ts)
    settledAt: Mapped[datetime | None] = mapped_column(_ts)

    hospital: Mapped[Tenant] = relationship(foreign_keys=[hospitalTenantId])
    insurer: Mapped[Tenant] = relationship(foreign_keys=[insurerTenantId])
    policy: Mapped[Policy | None] = relationship()
    patient: Mapped[Patient | None] = relationship()
    admission: Mapped[Admission | None] = relationship()
    submittedBy: Mapped[User | None] = relationship(foreign_keys=[submittedById])
    overriddenBy: Mapped[User | None] = relationship(foreign_keys=[overriddenById])
    decisions: Mapped[list["Decision"]] = relationship(back_populates="claim")
    fraudFlags: Mapped[list["FraudFlag"]] = relationship(back_populates="claim")
    events: Mapped[list["ClaimEvent"]] = relationship(back_populates="claim")


class Decision(Base):
    __tablename__ = "Decision"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    claimId: Mapped[str] = mapped_column(ForeignKey("Claim.id", ondelete="CASCADE"))
    verdict: Mapped[Verdict] = mapped_column(_pg_enum(Verdict))
    approvedAmountPaise: Mapped[int | None] = mapped_column(Integer)
    confidence: Mapped[float] = mapped_column(Float)
    rationale: Mapped[str] = mapped_column(Text)
    citedClauseRefs: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    model: Mapped[str] = mapped_column(String)
    latencyMs: Mapped[int] = mapped_column(Integer)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    claim: Mapped[Claim] = relationship(back_populates="decisions")


class FraudFlag(Base):
    __tablename__ = "FraudFlag"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    claimId: Mapped[str] = mapped_column(ForeignKey("Claim.id", ondelete="CASCADE"))
    signal: Mapped[str] = mapped_column(String)
    severity: Mapped[FraudSeverity] = mapped_column(_pg_enum(FraudSeverity))
    detail: Mapped[str] = mapped_column(Text)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    claim: Mapped[Claim] = relationship(back_populates="fraudFlags")


class ClaimEvent(Base):
    __tablename__ = "ClaimEvent"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    claimId: Mapped[str] = mapped_column(ForeignKey("Claim.id", ondelete="CASCADE"))
    type: Mapped[ClaimEventType] = mapped_column(_pg_enum(ClaimEventType))
    message: Mapped[str] = mapped_column(Text)
    actorId: Mapped[str | None] = mapped_column(ForeignKey("User.id"))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    createdAt: Mapped[datetime] = mapped_column(_ts, default=datetime.utcnow)

    claim: Mapped[Claim] = relationship(back_populates="events")
    actor: Mapped[User | None] = relationship()
