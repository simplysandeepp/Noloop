"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJSON, storeAuth, homeForRole, type AuthResponse } from "../../lib/api";
import Logo from "../../components/ui/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await postJSON<AuthResponse>("/auth/login", { email, password });
      storeAuth(data);
      router.push(homeForRole(data.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-sky-50 to-white">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <Logo size={40} />
        </div>
        <form
          onSubmit={onSubmit}
          className="bg-white border border-sky-100 rounded-3xl p-8 shadow-xl shadow-sky-100/50"
        >
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Welcome back
          </h1>
          <p className="text-sm text-slate-500 mt-1 mb-6">
            Log in to your NoLoop account.
          </p>

          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="acme.hospital@noloop.in"
            required
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm mb-4 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
          />

          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm mb-5 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 transition"
          />

          <button
            disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 transition-all hover:scale-[1.01] disabled:opacity-60 shadow-sm shadow-sky-200"
          >
            {loading ? "Logging in…" : "Log in"}
          </button>

          {error && (
            <div className="mt-4 text-sm rounded-xl px-3.5 py-2.5 bg-red-50 text-red-600 border border-red-100">
              {error}
            </div>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            New here?{" "}
            <Link href="/signup" className="font-semibold text-sky-600 hover:text-sky-700">
              Create an account
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
