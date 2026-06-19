// Base URL of the NoLoop backend (override with NEXT_PUBLIC_API_URL in .env.local).
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tenantId: string | null;
}
export interface AuthResponse {
  token: string;
  user: AuthUser;
}

const TOKEN_KEY = "noloop_token";
const USER_KEY = "noloop_user";

export function storeAuth(res: AuthResponse) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, res.token);
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
}
export function getToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}
export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}
export function clearAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Where each role lands after login. */
export function homeForRole(role: string): string {
  if (role === "HOSPITAL_ADMIN" || role === "HOSPITAL_STAFF") return "/hospital";
  if (role === "INSURER_ADMIN" || role === "INSURER_ADJUDICATOR")
    return "/insurer";
  if (role === "PATIENT") return "/patient";
  return "/";
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readError(data: any, status: number): string {
  return Array.isArray(data?.message)
    ? data.message.join(", ")
    : (data?.message ?? `Request failed (${status})`);
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, readError(data, res.status));
  return data as T;
}

export async function authedGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, readError(data, res.status));
  return data as T;
}

export async function authedPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, readError(data, res.status));
  return data as T;
}

/** Public GET (no auth) — used by the claim-tracking page. */
export async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, readError(data, res.status));
  return data as T;
}

// ── formatting helpers (money is always paise) ──
export function inr(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

/** Compact rupees: ₹12.5L, ₹1.2Cr. */
export function inrCompact(paise: number | null | undefined): string {
  if (paise == null) return "—";
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}k`;
  return "₹" + Math.round(r).toLocaleString("en-IN");
}

export function fmtTat(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${seconds % 60}s`;
}

export function fmtDate(s: string | Date): string {
  return new Date(s).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDay(s: string | Date): string {
  return new Date(s).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}
