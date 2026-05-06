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
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            Admin
          </span>
        }
      />

      <div className="p-4 sm:p-6 md:p-8">
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-slate-600">Filter:</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" />
            Couldn&apos;t load cases. Confirm your account still has admin role.
          </div>
        )}

        {data && data.cases.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">
            No cases match the current filter.
          </div>
        )}

        {data && data.cases.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Case</Th>
                  <Th>Owner</Th>
                  <Th>Status</Th>
                  <Th>Verdict</Th>
                  <Th>Confidence</Th>
                  <Th>Submitted</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.cases.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/cases/${c.id}`}
                        className="font-mono text-xs text-emerald-700 hover:underline"
                      >
                        {c.id.slice(0, 8)}…
                      </Link>
                      <div className="text-xs text-slate-500">
                        {c.image_count} image{c.image_count === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {c.user_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">
                      {c.violation_confirmed === null ? (
                        <span className="text-slate-400">—</span>
                      ) : c.violation_confirmed ? (
                        <span className="font-medium text-red-700">
                          {c.violation_type || "Violation"}
                        </span>
                      ) : (
                        <span className="text-slate-600">No violation</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatPercent(c.confidence)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDate(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <span className="text-slate-600">
                  Page {page + 1} of {Math.ceil(data.total / PAGE_SIZE)} ·{" "}
                  {data.total} case{data.total === 1 ? "" : "s"} total
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= data.total}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
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
    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}
