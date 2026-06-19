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

/** POST JSON to the backend; throws a readable Error on non-2xx. */
export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // NestJS validation errors come back as an array of strings.
    const msg = Array.isArray(data?.message)
      ? data.message.join(", ")
      : (data?.message ?? `Request failed (${res.status})`);
    throw new Error(msg);
  }
  return data as T;
}

/** Stash the JWT (simple localStorage for now; httpOnly cookies come later). */
export function storeToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("noloop_token", token);
  }
}
