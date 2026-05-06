"use client";

import { useState } from "react";
import Link from "next/link";
import { DashboardNav, useAuthGuard } from "@/components/layout/DashboardNav";
import { X, Menu } from "lucide-react";

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

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
