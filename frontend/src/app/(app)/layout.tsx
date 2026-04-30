"use client";

import { DashboardNav, useAuthGuard } from "@/components/layout/DashboardNav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = useAuthGuard();
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <DashboardNav user={user} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
