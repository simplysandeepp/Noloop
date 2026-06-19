"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJSON, storeAuth, homeForRole, type AuthResponse } from "../../lib/api";
import Logo from "../../components/ui/Logo";

type OrgType = "HOSPITAL" | "INSURER";

export default function SignupPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<OrgType>("HOSPITAL");
  const [adminName, setAdminName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AuthResponse | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await postJSON<AuthResponse>("/auth/signup", {
        orgName,
        orgType,
        adminName,
        password,
      });
      storeAuth(data);
      setCreated(data);
      setTimeout(() => router.push(homeForRole(data.user.role)), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  const input =
    "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition";
  const label = "block text-sm font-semibold text-slate-700 mb-1.5";

  if (created) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-sky-50 to-white">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center mb-6">
            <Logo size={40} />
          </div>
          <div className="bg-white border border-sky-100 rounded-3xl p-8 shadow-xl shadow-sky-100/50">
            <p className="text-2xl mb-2">🎉</p>
            <h1 className="text-xl font-black text-slate-900">Organization created</h1>
            <p className="text-sm text-slate-500 mt-1 mb-4">
              Your system-generated login email:
            </p>
            <div className="rounded-xl px-3.5 py-3 bg-emerald-50 border border-emerald-100 text-emerald-700 font-bold break-all">
              {created.user.email}
            </div>
            <p className="mt-4 text-sm text-slate-400">Taking you to your portal…</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-gradient-to-b from-sky-50 to-white">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo size={40} />
        </div>
        <form
          onSubmit={onSubmit}
          className="bg-white border border-sky-100 rounded-3xl p-8 shadow-xl shadow-sky-100/50"
        >
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Create your organization
          </h1>
          <p className="text-sm text-slate-500 mt-1 mb-6">
            We&apos;ll generate your login email from the organization name.
          </p>

          <div className="space-y-4">
            <div>
              <label className={label}>Organization name</label>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Acme Hospital"
                required
                className={input}
              />
            </div>
            <div>
              <label className={label}>Organization type</label>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value as OrgType)}
                className={input}
              >
                <option value="HOSPITAL">Hospital</option>
                <option value="INSURER">Insurance company</option>
              </select>
            </div>
            <div>
              <label className={label}>Your name (admin)</label>
              <input
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="e.g. Dr. Sandeep"
                required
                className={input}
              />
            </div>
            <div>
              <label className={label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
                className={input}
              />
            </div>
          </div>

          <button
            disabled={loading}
            className="mt-6 w-full py-3 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 transition-all hover:scale-[1.01] disabled:opacity-60 shadow-sm shadow-sky-200"
          >
            {loading ? "Creating…" : "Create account"}
          </button>

          {error && (
            <div className="mt-4 text-sm rounded-xl px-3.5 py-2.5 bg-red-50 text-red-600 border border-red-100">
              {error}
            </div>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-sky-600 hover:text-sky-700">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
