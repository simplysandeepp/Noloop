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

export async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, readError(data, res.status));
  return data as T;
}
