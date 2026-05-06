"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tokenStore, type AuthUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { Camera, ListChecks, Bell, Settings, LogOut, ShieldCheck } from "lucide-react";
import clsx from "clsx";

const CITIZEN_NAV = [
  { href: "/dashboard", label: "My cases", icon: ListChecks },
  { href: "/upload", label: "New report", icon: Camera },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

const ADMIN_NAV_EXTRA = [
  { href: "/admin", label: "All cases (admin)", icon: ShieldCheck },
];

export function DashboardNav({
  user,
  onNavigate,
  className,
}: {
  user: AuthUser;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [logging, setLogging] = useState(false);

  const NAV = user.role === "admin" ? [...CITIZEN_NAV, ...ADMIN_NAV_EXTRA] : CITIZEN_NAV;

  const { data: unread } = useQuery({
    queryKey: ["unread-count", user.id],
    queryFn: () =>
      apiFetch<{ unreadCount: number }>(
        `/notifications/unread-count/${user.id}`,
      ),
    refetchInterval: 30_000,
  });

  const onLogout = async () => {
    setLogging(true);
    try {
      const refresh = tokenStore.getRefreshToken();
      if (refresh) {
        await apiFetch("/auth/logout", {
          method: "POST",
          body: { refreshToken: refresh },
        }).catch(() => {});
      }
    } finally {
      // Wipe in-memory caches so the next user can't briefly see the previous
      // user's data (every list/stat query is keyed off user.id, but clearing
      // is the strongest guarantee).
      tokenStore.clear();
      qc.clear();
      router.replace("/login");
    }
  };

  return (
    <aside
      className={clsx(
        "flex w-60 flex-col border-r border-slate-200 bg-white",
        className,
      )}
    >
      <Link
        href="/dashboard"
        className="border-b border-slate-200 px-5 py-5 text-xl font-semibold tracking-tight text-slate-900"
      >
        Snap<span className="text-emerald-600">Park</span>
      </Link>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          const showBadge =
            item.href === "/notifications" &&
            unread &&
            unread.unreadCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                active
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {unread.unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="px-3 py-2 text-xs">
          <div className="font-semibold text-slate-700">
            {user.firstName ? `Hi, ${user.firstName}` : "Signed in"}
          </div>
          <div className="truncate text-slate-500">{user.email}</div>
        </div>
        <button
          onClick={onLogout}
          disabled={logging}
          className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" />
          {logging ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}

export function useAuthGuard(): AuthUser | null {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const u = tokenStore.getUser();
    const t = tokenStore.getToken();
    if (!u || !t) {
      // Clear any stale storage then send the visitor back to the landing page.
      // The landing page has "Log in" and "Get started" links so there is no
      // need to drop users directly onto /login.
      tokenStore.clear();
      router.replace("/");
      return;
    }
    setUser(u);
  }, [router]);

  return user;
}
