"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { tokenStore } from "@/lib/auth";
import type { Notification } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDate } from "@/lib/format";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import clsx from "clsx";

export default function NotificationsPage() {
  const user = tokenStore.getUser();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () =>
      apiFetch<{ notifications: Notification[] }>(
        `/notifications?limit=50`,
      ),
    enabled: !!user,
  });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      apiFetch(`/notifications/read-all/${user!.id}`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });

  if (!user) return null;

  const items = data?.notifications || [];
  const hasUnread = items.some((n) => !n.is_read);

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates on every case you've submitted."
        action={
          hasUnread && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </button>
          )
        }
      />

      <div className="p-4 sm:p-6 md:p-8">
        {isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
            <Bell className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-600">
              You&apos;re all caught up — no notifications yet.
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={clsx(
                "flex items-start gap-4 rounded-lg border p-4 shadow-sm transition",
                n.is_read
                  ? "border-slate-200 bg-white"
                  : "border-emerald-200 bg-emerald-50/50",
              )}
            >
              <div
                className={clsx(
                  "mt-1 h-2 w-2 shrink-0 rounded-full",
                  n.is_read ? "bg-slate-300" : "bg-emerald-500",
                )}
              />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {(n.notification_type ?? "notification").replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatDate(n.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-800">{n.message}</p>
                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href={`/cases/${n.case_id}`}
                    className="text-xs font-medium text-emerald-700 hover:underline"
                  >
                    View case →
                  </Link>
                  {!n.is_read && (
                    <button
                      onClick={() => markRead.mutate(n.id)}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Mark as read
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
