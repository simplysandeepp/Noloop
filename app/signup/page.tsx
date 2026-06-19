"use client";

import Link from "next/link";
import { useState } from "react";
import { postJSON, storeToken, type AuthResponse } from "../../lib/api";

type OrgType = "HOSPITAL" | "INSURER";

export default function SignupPage() {
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<OrgType>("HOSPITAL");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await postJSON<AuthResponse>("/auth/signup", {
        orgName,
        orgType,
        adminName,
        email,
        password,
      });
      storeToken(data.token);
      setSuccess(
        `Account created — welcome, ${data.user.name} (${data.user.role}).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="form-card" onSubmit={onSubmit}>
        <h1>Create your organization</h1>
        <p className="lead">
          Register your hospital or insurance company on NoLoop.
        </p>

        <div className="field">
          <label htmlFor="orgName">Organization name</label>
          <input
            id="orgName"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. Apollo Hospital"
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
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@org.in"
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
        {success && <div className="msg msg-success">{success}</div>}

        <p className="alt">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
