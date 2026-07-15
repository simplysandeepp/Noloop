# NoLoop

**An AI that doesn't assist claim adjudicators — it *is* one.**

NoLoop is a multi-tenant platform that autonomously adjudicates health-insurance claims. A hospital submits a claim, the AI engine decides it in seconds — with the exact policy clause cited, fraud flags raised, and a plain-language rationale — an insurer reviews or overrides, and the patient tracks it live.

> 🎥 [Watch the demo](https://youtu.be/946GA4_ADkc?si=Zpp9CV9ecDXSeQLU)

## Why

Indian health-claim processing is manual and fragmented:

- Doctors hand-process **50–80 claims/day**; cashless takes **2–3 hrs/claim**, reimbursement **7–15 days**
- Fraud runs **~15%/yr**, costing insurers **₹8,000–10,000 cr/yr**
- Patients have **zero transparency** — no way to track a claim or learn why it was denied

## High-level architecture

```mermaid
flowchart TB
    subgraph Surfaces["4 role-scoped surfaces"]
        H[🏥 Hospital Portal<br/>submit & track claims]
        I[🛡️ Insurer Portal<br/>review AI verdicts, override]
        P[👤 Patient Portal<br/>live claim timeline]
        A[⚙️ Admin Dashboard<br/>orgs, users, policy KB, audit]
    end

    subgraph Backend["One Backend (FastAPI)"]
        AUTH[Auth + RBAC<br/>+ multi-tenancy]
        API[REST API]
        Q[Queue - arq/Celery planned]
    end

    subgraph Engine["AI Adjudication Engine (FastAPI)"]
        E1[EXTRACT]
        E2[COVERAGE - RAG]
        E3[VALIDATE - fraud]
        E4[ADJUDICATE]
        E1 --> E2 --> E3 --> E4
    end

    subgraph Data["Data stores"]
        PG[(Supabase Postgres<br/>+ pgvector)]
        ST[(Supabase Storage<br/>claim files)]
        RD[(Upstash Redis<br/>queue state)]
    end

    H & I & P & A --> API
    API --> AUTH
    API --> Q --> Engine
    Engine --> PG
    API --> PG & ST
    Q --> RD
```

One FastAPI API serves all roles — responses are scoped by the caller's **role + tenant**. The frontend never touches the database directly.

## The golden path — end-to-end claim workflow

```mermaid
sequenceDiagram
    autonumber
    actor HS as Hospital Staff
    participant BE as Backend (FastAPI)
    participant AI as AI Engine
    actor IN as Insurer Adjudicator
    actor PT as Patient

    HS->>BE: Submit claim packet (discharge summary, bills, KYC)
    BE->>BE: Validate, store files, create claim record
    BE->>AI: Send claim packet for adjudication
    AI->>AI: EXTRACT → COVERAGE (RAG) → VALIDATE → ADJUDICATE
    AI-->>BE: Verdict (APPROVE / DENY / QUERY)<br/>+ cited policy clause + fraud flags + rationale
    BE-->>IN: Verdict queued for human review
    IN->>BE: Approve verdict — or override with reason
    BE-->>PT: Status update in plain language
    BE-->>HS: Final claim status
    Note over PT: Patient tracks every step live —<br/>no more "pending" black box
```

## Inside the AI engine

The core is a **typed pipeline, not a chatbot**. Every claim is processed for real — nothing is hardcoded.

```mermaid
flowchart LR
    IN[/Claim packet:<br/>discharge summary,<br/>bills, KYC/] --> EX

    subgraph Pipeline["Adjudication pipeline"]
        EX["🔍 EXTRACT<br/>structured facts:<br/>diagnosis, treatment,<br/>amounts, dates"]
        CV["📄 COVERAGE<br/>RAG over policy docs<br/>(pgvector) — find the<br/>clauses that apply"]
        VA["🚨 VALIDATE<br/>fraud signals: inflated<br/>bills, impossible dates,<br/>extended stays"]
        AD["⚖️ ADJUDICATE<br/>final verdict with<br/>confidence + rationale"]
        EX --> CV --> VA --> AD
    end

    AD --> OUT[/"APPROVE / DENY / QUERY<br/>+ cited policy clause<br/>+ fraud flags<br/>+ plain-language rationale"/]
```

**Humans override — they don't operate.** Every verdict is auditable: the insurer sees exactly which policy clause drove the decision and can overrule it with a reason, which is logged.

## Claim lifecycle

```mermaid
stateDiagram-v2
    [*] --> SUBMITTED: hospital submits packet
    SUBMITTED --> PROCESSING: engine picks up claim
    PROCESSING --> AI_APPROVED: engine verdict APPROVE
    PROCESSING --> AI_DENIED: engine verdict DENY
    PROCESSING --> QUERY: engine needs more info
    QUERY --> SUBMITTED: hospital responds
    AI_APPROVED --> APPROVED: insurer confirms
    AI_APPROVED --> DENIED: insurer overrides
    AI_DENIED --> DENIED: insurer confirms
    AI_DENIED --> APPROVED: insurer overrides
    APPROVED --> [*]
    DENIED --> [*]
    note right of PROCESSING: Patient sees every<br/>transition in plain language
```

## Onboarding & identity

**Tenant** = an organization (hospital or insurer). **User** = a person who logs in, scoped to a tenant.

```mermaid
flowchart TD
    PA[Platform Admin<br/>runs Noloop-admin] -->|onboards org| ORG[Organization<br/>hospital or insurer]
    ORG -->|first account| OA[Org Admin]
    OA -->|creates| EMP[Staff accounts<br/>hospital staff / adjudicators]
    EMP -->|logs in| RT{Backend reads<br/>role + tenant}
    RT -->|hospital staff| HP[Hospital Portal]
    RT -->|insurer adjudicator| IP[Insurer Portal]
    PT2[Patient] -->|signs up directly| PP[Patient Portal]
```

Login is email + password with custom JWT. Org context comes from the user's `tenantId` — no separate company password.

## Data approach

Real insurer policy documents can't be used (IP/legal). All input data is **synthetic** — generated discharge summaries, bills, KYC, and fictional policy docs. The engine's *processing* is 100% real; only the *inputs* are synthetic.

## Repos & tech stack

| Piece | Tech | Where |
|---|---|---|
| Frontend (hospital / insurer / patient) | Next.js 15, React 19, Tailwind 4, Bun | `/` (this repo root) |
| Backend API | FastAPI + SQLAlchemy 2.0 (async) | `/backend` |
| AI Engine | FastAPI + Claude + pgvector RAG | `/ai` |
| Admin dashboard | Next.js (separate repo) | `Noloop-admin` |
| Data | Supabase Postgres + pgvector, Supabase Storage, Upstash Redis | — |

See [docs/](./docs/) for architecture, API, DB schema, and roadmap details.

## License

MIT — see [LICENSE](./LICENSE). The NoLoop name, brand, and demo assets are not covered by the code license.
