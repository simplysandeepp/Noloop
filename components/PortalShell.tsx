"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken, getUser, clearAuth } from "../lib/api";

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
    <>
      <header className="nav">
        <div className="nav-inner">
          <span className="nav-brand">NoLoop</span>
          <nav className="nav-links">
            {email && <span className="muted">{email}</span>}
            <button
              className="nav-logout"
              onClick={() => {
                clearAuth();
                router.replace("/login");
              }}
            >
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
