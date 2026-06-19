"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { getToken, getUser, clearAuth } from "../lib/api";
import Logo from "./ui/Logo";

/** Auth-guards org portals and renders the top nav. */
export default function PortalShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setEmail(getUser()?.email ?? null);
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-[#FBF8F3]">
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-sky-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo size={34} />
          <div className="flex items-center gap-3">
            {email && (
              <span className="hidden sm:inline text-sm text-slate-500">
                {email}
              </span>
            )}
            <button
              onClick={() => {
                clearAuth();
                router.replace("/login");
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:text-red-600 hover:border-red-200 transition-all"
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
