"use client";

import { useState } from "react";
import Link from "next/link";
import { DashboardNav, useAuthGuard } from "@/components/layout/DashboardNav";
import { apiFetch } from "@/lib/api";
import { MailWarning, X, Menu } from "lucide-react";

function VerificationBanner({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const resend = async () => {
    await apiFetch("/auth/resend-verification", { method: "POST" }).catch(() => {});
    setSent(true);
  };

  return (
    <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800">
      <MailWarning className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="flex-1">
        Please verify your email address. We sent a link to <strong>{email}</strong>.
        {!sent ? (
          <button onClick={resend} className="ml-2 underline hover:no-underline">
            Resend email
          </button>
        ) : (
          <span className="ml-2 font-medium text-amber-700">Email sent ✓</span>
        )}
      </span>
      <button onClick={() => setDismissed(true)} className="text-amber-500 hover:text-amber-700">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = useAuthGuard();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <DashboardNav user={user} className="hidden md:flex" />

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="relative h-full w-64 shadow-xl">
            <DashboardNav
              user={user}
              onNavigate={() => setDrawerOpen(false)}
              className="h-full"
            />
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute right-2 top-3 rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-auto">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-slate-700 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-slate-900">
            Snap<span className="text-emerald-600">Park</span>
          </Link>
          <span className="w-7" />
        </div>

        {user.emailVerified === false && (
          <VerificationBanner email={user.email} />
        )}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
