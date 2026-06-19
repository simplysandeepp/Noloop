"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  postJSON,
  storeAuth,
  homeForRole,
  type AuthResponse,
} from "../../lib/api";

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
      // Brief pause so they can see their generated login email, then go in.
      setTimeout(() => router.push(homeForRole(data.user.role)), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  if (created) {
    return (
      <main className="auth-page">
        <div className="form-card">
          <h1>Organization created 🎉</h1>
          <p className="lead">Your system-generated login email is:</p>
          <div className="msg msg-success" style={{ fontWeight: 700 }}>
            {created.user.email}
          </div>
          <p className="alt">Taking you to your portal…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <form className="form-card" onSubmit={onSubmit}>
        <h1>Create your organization</h1>
        <p className="lead">
          Register your hospital or insurance company. We&apos;ll generate your
          login email from the organization name.
        </p>

        <div className="field">
          <label htmlFor="orgName">Organization name</label>
          <input
            id="orgName"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. Bir Hospital"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="orgType">Organization type</label>
          <select
            id="orgType"
            value={orgType}
            onChange={(e) => setOrgType(e.target.value as OrgType)}
          >
            <option value="HOSPITAL">Hospital</option>
            <option value="INSURER">Insurance company</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="adminName">Your name (admin)</label>
          <input
            id="adminName"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="e.g. Dr. Sandeep"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </div>

        <button className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </button>

        {error && <div className="msg msg-error">{error}</div>}

        <p className="alt">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
