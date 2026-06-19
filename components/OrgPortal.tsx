"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalShell from "./PortalShell";
import { authedGet, authedPost, ApiError } from "../lib/api";

interface Overview {
  id: string;
  name: string;
  type: "HOSPITAL" | "INSURER";
  orgEmail: string | null;
  employeeCount: number;
  createdAt: string;
}
interface Employee {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

function fmt(s: string) {
  return new Date(s).toLocaleString();
}

export default function OrgPortal() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<string | null>(null);

  async function load() {
    try {
      const [o, e] = await Promise.all([
        authedGet<Overview>("/org/overview"),
        authedGet<Employee[]>("/org/employees"),
      ]);
      setOverview(o);
      setEmployees(e);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        router.replace("/login");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addEmployee(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    setLastCreated(null);
    try {
      const emp = await authedPost<Employee>("/org/employees", {
        name,
        password,
      });
      setLastCreated(emp.email);
      setName("");
      setPassword("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  const isHospital = overview?.type === "HOSPITAL";
  const orgCompact = overview?.name
    ? overview.name.toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "org";

  return (
    <PortalShell>
      <h1 className="page-title">
        {overview ? overview.name : "Portal"}{" "}
        {overview && (
          <span className={`tag ${isHospital ? "tag-hospital" : "tag-insurer"}`}>
            {overview.type}
          </span>
        )}
      </h1>
      {overview && (
        <p className="muted">
          Org login: <b>{overview.orgEmail}</b> · {overview.employeeCount}{" "}
          member(s)
        </p>
      )}

      <h2 className="section">Add employee</h2>
      <form className="inline-form" onSubmit={addEmployee}>
        <input
          placeholder="Employee name (e.g. Sachin)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          required
        />
        <input
          type="password"
          placeholder="Temp password (8+)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <button className="btn btn-primary" disabled={creating}>
          {creating ? "Creating…" : "Create"}
        </button>
      </form>
      <p className="muted small">
        Email is auto-generated, e.g. <code>sachin.{orgCompact}@noloop.in</code>
      </p>
      {lastCreated && (
        <div className="msg msg-success">
          Created: <b>{lastCreated}</b>
        </div>
      )}
      {formError && <div className="msg msg-error">{formError}</div>}

      <h2 className="section">Members ({employees.length})</h2>
      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((u) => (
                <tr key={u.id}>
                  <td>{u.name ?? "—"}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className="tag tag-role">{u.role}</span>
                  </td>
                  <td className="muted">{fmt(u.createdAt)}</td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="msg msg-error">{error}</div>}
    </PortalShell>
  );
}
