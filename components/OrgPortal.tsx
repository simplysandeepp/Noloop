"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Users, Mail } from "lucide-react";
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
      const emp = await authedPost<Employee>("/org/employees", { name, password });
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
  const accent = isHospital ? "sky" : "teal";
  const orgCompact = overview?.name
    ? overview.name.toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "org";

  const input =
    "flex-1 min-w-[180px] px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition";

  return (
    <PortalShell>
      {/* Org header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          {overview ? overview.name : "Portal"}
        </h1>
        {overview && (
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              isHospital
                ? "bg-sky-100 text-sky-700"
                : "bg-teal-100 text-teal-700"
            }`}
          >
            {overview.type}
          </span>
        )}
      </div>
      {overview && (
        <p className="mt-1.5 text-sm text-slate-500 flex items-center gap-2 flex-wrap">
          <Mail className="w-4 h-4 text-slate-400" />
          Org login: <b className="text-slate-700">{overview.orgEmail}</b>
          <span className="text-slate-300">·</span>
          <Users className="w-4 h-4 text-slate-400" />
          {overview.employeeCount} member(s)
        </p>
      )}

      {/* Add employee */}
      <div className="mt-8 bg-white border border-sky-100 rounded-2xl p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 mb-1">
          <UserPlus className={`w-5 h-5 ${isHospital ? "text-sky-600" : "text-teal-600"}`} />
          Add employee
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Email is auto-generated, e.g.{" "}
          <code className="bg-slate-100 rounded px-1.5 py-0.5 text-[0.85em]">
            sachin.{orgCompact}@noloop.in
          </code>
        </p>
        <form onSubmit={addEmployee} className="flex gap-3 flex-wrap items-center">
          <input
            placeholder="Employee name (e.g. Sachin)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            required
            className={input}
          />
          <input
            type="password"
            placeholder="Temp password (8+)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            className={input}
          />
          <button
            disabled={creating}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.01] disabled:opacity-60 shadow-sm ${
              isHospital
                ? "bg-sky-600 hover:bg-sky-700 shadow-sky-200"
                : "bg-teal-600 hover:bg-teal-700 shadow-teal-200"
            }`}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
        {lastCreated && (
          <div className="mt-4 text-sm rounded-xl px-3.5 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-100">
            Created: <b>{lastCreated}</b>
          </div>
        )}
        {formError && (
          <div className="mt-4 text-sm rounded-xl px-3.5 py-2.5 bg-red-50 text-red-600 border border-red-100">
            {formError}
          </div>
        )}
      </div>

      {/* Members */}
      <h2 className="mt-8 mb-3 text-lg font-bold text-slate-900">
        Members ({employees.length})
      </h2>
      <div className="bg-white border border-sky-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                {["Name", "Email", "Role", "Joined"].map((h) => (
                  <th
                    key={h}
                    className="text-left font-semibold text-xs uppercase tracking-wider px-4 py-3 border-b border-slate-100"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 border-b border-slate-50">
                    {u.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-50">{u.email}</td>
                  <td className="px-4 py-3 border-b border-slate-50">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 border-b border-slate-50 text-slate-400">
                    {fmt(u.createdAt)}
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    No members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <div className="mt-6 text-sm rounded-xl px-3.5 py-2.5 bg-red-50 text-red-600 border border-red-100">
          {error}
        </div>
      )}
    </PortalShell>
  );
}
