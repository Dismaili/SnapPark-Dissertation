"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { tokenStore } from "@/lib/auth";
import type { CaseListResponse } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDate, formatPercent } from "@/lib/format";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

const PAGE_SIZE = 25;

/**
 * Admin-only view: every case from every user. The same /violations/cases
 * endpoint is reused — when the JWT carries `role=admin`, the gateway no
 * longer rewrites `userId` to the caller, so the result spans all users.
 *
 * Citizens hitting this URL are bounced to /dashboard.
 */
export default function AdminCasesPage() {
  const router = useRouter();
  const user = tokenStore.getUser();
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  if (statusFilter) params.set("status", statusFilter);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-cases", page, statusFilter],
    queryFn: () =>
      apiFetch<CaseListResponse>(`/violations/cases?${params.toString()}`),
    enabled: !!user && user.role === "admin",
  });

  if (!user || user.role !== "admin") return null;

  return (
    <>
      <PageHeader
        title="All cases"
        description="Admin view — every parking report submitted across the platform."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-subtle px-3 py-1.5 text-xs font-medium text-brand-fg ring-1 ring-inset ring-brand/40">
            <ShieldCheck className="h-3.5 w-3.5" />
            Admin
          </span>
        }
      />

      <div className="p-4 sm:p-6 md:p-8">
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-muted-fg">Filter:</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-line-strong bg-card px-3 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="completed">Analysed</option>
            <option value="reported_to_authority">Reported</option>
            <option value="resolved">Resolved</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-card p-8 text-sm text-muted-fg">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="h-4 w-4" />
            Couldn&apos;t load cases. Confirm your account still has admin role.
          </div>
        )}

        {data && data.cases.length === 0 && (
          <div className="rounded-lg border border-dashed border-line-strong bg-card p-10 text-center text-sm text-muted-fg">
            No cases match the current filter.
          </div>
        )}

        {data && data.cases.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line bg-card shadow-sm">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-app">
                <tr>
                  <Th>Case</Th>
                  <Th>Owner</Th>
                  <Th>Status</Th>
                  <Th>Verdict</Th>
                  <Th>Confidence</Th>
                  <Th>Submitted</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-card">
                {data.cases.map((c) => (
                  <tr key={c.id} className="hover:bg-app">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cases/${c.id}`}
                        className="font-mono text-xs text-brand-fg hover:underline"
                      >
                        {c.id.slice(0, 8)}…
                      </Link>
                      <div className="text-xs text-muted-fg">
                        {c.image_count} image{c.image_count === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-fg">
                      {c.user_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">
                      {c.violation_confirmed === null ? (
                        <span className="text-muted-fg">—</span>
                      ) : c.violation_confirmed ? (
                        <span className="font-medium text-red-700 dark:text-red-300">
                          {c.violation_type || "Violation"}
                        </span>
                      ) : (
                        <span className="text-muted-fg">No violation</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-soft">
                      {formatPercent(c.confidence)}
                    </td>
                    <td className="px-4 py-3 text-muted-fg">
                      {formatDate(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-line bg-app px-4 py-3 text-sm">
                <span className="text-muted-fg">
                  Page {page + 1} of {Math.ceil(data.total / PAGE_SIZE)} ·{" "}
                  {data.total} case{data.total === 1 ? "" : "s"} total
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="rounded-md border border-line-strong bg-card px-3 py-1 text-fg-soft disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= data.total}
                    className="rounded-md border border-line-strong bg-card px-3 py-1 text-fg-soft disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-fg">
      {children}
    </th>
  );
}
