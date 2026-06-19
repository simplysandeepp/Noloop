// Shared shapes for talking to the NoLoop AI engine (Noloop/ai).
// These mirror the Pydantic models in ai/app/schemas.py exactly.

export interface AiLineItem {
  desc: string;
  amountPaise: number;
}

export interface AiPolicy {
  policyNo?: string | null;
  sumInsuredPaise: number;
  roomRentCapPerDayPaise?: number | null;
  copayPct?: number;
  coveredProcedures: string[];
  exclusions: string[];
}

export interface AiAdmission {
  admittedAt?: string | null;
  dischargedAt?: string | null;
  lengthOfStayDays: number;
  procedure: string;
  diagnosis?: string | null;
}

export interface AiBill {
  lineItems: AiLineItem[];
  totalPaise: number;
}

export interface ClaimPacket {
  ref: string;
  type?: string | null;
  hospital?: string | null;
  insurer?: string | null;
  policy: AiPolicy;
  admission: AiAdmission;
  bill: AiBill;
  dischargeSummary?: string | null;
}

export type Verdict = "APPROVE" | "DENY" | "QUERY";
export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface AiFraudFlag {
  signal: string;
  severity: Severity;
  detail: string;
}

export interface AiDeduction {
  label: string;
  amountPaise: number;
}

export interface AiDecision {
  ref: string;
  verdict: Verdict;
  rationale: string;
  citedClauseRefs: string[];
  fraudFlags: AiFraudFlag[];
  approvedAmountPaise: number | null;
  deductions: AiDeduction[];
  confidence: number;
  model: string;
}
