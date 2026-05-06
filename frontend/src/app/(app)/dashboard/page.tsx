"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { tokenStore } from "@/lib/auth";
import type { CaseListResponse, UserStats } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDate, formatPercent } from "@/lib/format";
import { Camera, Loader2, AlertTriangle } from "lucide-react";

const PAGE_SIZE = 10;

export default function CasesPage() {
  const user = tokenStore.getUser();
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: stats } = useQuery({
    queryKey: ["stats", user?.id],
    queryFn: () => apiFetch<UserStats>(`/violations/stats/${user!.id}`),
    enabled: !!user,
  });

  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  if (statusFilter) params.set("status", statusFilter);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cases", user?.id, page, statusFilter],
    queryFn: () =>
      apiFetch<CaseListResponse>(`/violations/cases?${params.toString()}`),
    enabled: !!user,
  });

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="My cases"
        description="Every parking report you've submitted, with status and AI verdict."
        action={
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Camera className="h-4 w-4" />
            New report
          </Link>
        }
      />

      <div className="p-4 sm:p-6 md:p-8">
        {stats && (
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Total" value={Number(stats.total_cases)} />
            <StatCard label="Analysed" value={Number(stats.status_completed)} />
            <StatCard label="Confirmed" value={Number(stats.violations_confirmed)} />
            <StatCard label="Reported" value={Number(stats.status_reported)} />
            <StatCard label="Resolved" value={Number(stats.status_resolved)} />
          </div>
        )}

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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading cases…
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" />
            Couldn&apos;t load your cases. Make sure the API gateway is running
            on {process.env.NEXT_PUBLIC_API_URL}.
          </div>
        )}

        {data && data.cases.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm text-slate-600">
              You haven&apos;t submitted any reports yet.
            </p>
            <Link
              href="/upload"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Camera className="h-4 w-4" />
              Submit your first report
            </Link>
          </div>
        )}

        {data && data.cases.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Case</Th>
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
                  Page {page + 1} of {Math.ceil(data.total / PAGE_SIZE)}
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}
