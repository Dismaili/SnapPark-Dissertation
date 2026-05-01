"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import type { Case } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDate, formatPercent } from "@/lib/format";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Send,
  ShieldCheck,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

type AuditEntry = {
  id: string;
  event_type: string;
  payload: unknown;
  created_at: string;
};

export default function CaseDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();

  const { data: caseData, isLoading, error } = useQuery({
    queryKey: ["case", id],
    queryFn: () => apiFetch<Case>(`/violations/${id}`),
  });

  const { data: auditRaw } = useQuery({
    queryKey: ["case-audit", id],
    queryFn: () => apiFetch<{ events: AuditEntry[] } | AuditEntry[]>(`/violations/${id}/audit`),
  });
  const audit: AuditEntry[] = Array.isArray(auditRaw)
    ? auditRaw
    : (auditRaw as { events: AuditEntry[] })?.events ?? [];

  const reportMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/violations/${id}/report`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case", id] }),
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/violations/${id}/resolve`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case", id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/violations/${id}`, { method: "DELETE" }),
    onSuccess: () => router.replace("/dashboard"),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading case…
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error instanceof ApiError && error.status === 404
            ? "Case not found."
            : "Couldn't load case details."}
        </div>
      </div>
    );
  }

  const c = caseData;

  return (
    <>
      <PageHeader
        title={`Case ${c.id.slice(0, 8)}…`}
        description={`Submitted ${formatDate(c.created_at)}`}
        action={
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
        }
      />

      <div className="grid gap-6 p-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={c.status} />
              {c.violation_confirmed != null &&
                (c.violation_confirmed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
                    <AlertTriangle className="h-3 w-3" />
                    {c.violation_type || "Violation"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <CheckCircle2 className="h-3 w-3" /> No violation
                  </span>
                ))}
              {c.confidence != null && (
                <span className="text-xs text-slate-500">
                  Confidence {formatPercent(c.confidence)}
                </span>
              )}
            </div>

            <h2 className="mt-6 text-sm font-semibold text-slate-900">
              AI explanation
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
              {c.explanation || "No explanation provided."}
            </p>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Audit trail
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Every state change recorded for this case.
            </p>
            <ol className="mt-4 space-y-3">
              {(audit || []).length === 0 && (
                <li className="text-sm text-slate-500">No audit events.</li>
              )}
              {(audit || []).map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-3 rounded-md bg-slate-50 p-3 text-sm"
                >
                  <span className="mt-0.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  <div className="flex-1">
                    <div className="font-medium text-slate-900">
                      {e.event_type}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDate(e.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Details</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <DetailRow label="Case ID" value={<code className="font-mono text-xs">{c.id}</code>} />
              <DetailRow label="Images" value={String(c.image_count)} />
              <DetailRow label="Format" value={c.image_mime_type || "—"} />
              <DetailRow label="Submitted" value={formatDate(c.created_at)} />
              <DetailRow
                label="Analysed"
                value={formatDate(c.completed_at)}
              />
            </dl>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Actions</h2>

            {c.status === "completed" && c.violation_confirmed && (
              <button
                onClick={() => reportMutation.mutate()}
                disabled={reportMutation.isPending}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <Send className="h-4 w-4" />
                {reportMutation.isPending
                  ? "Reporting…"
                  : "Report to authority"}
              </button>
            )}

            {c.status === "reported_to_authority" && (
              <button
                onClick={() => resolveMutation.mutate()}
                disabled={resolveMutation.isPending}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                {resolveMutation.isPending
                  ? "Marking resolved…"
                  : "Mark as resolved"}
              </button>
            )}

            {c.status === "pending" && (
              <button
                onClick={() => {
                  if (
                    confirm("Cancel this case? This cannot be undone.")
                  )
                    cancelMutation.mutate();
                }}
                disabled={cancelMutation.isPending}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {cancelMutation.isPending ? "Cancelling…" : "Cancel case"}
              </button>
            )}

            {c.status === "resolved" && (
              <p className="mt-4 text-sm text-slate-500">
                This case has been resolved.
              </p>
            )}

            {(reportMutation.error || resolveMutation.error || cancelMutation.error) && (
              <p className="mt-3 text-xs text-red-600">
                Action failed. Please try again.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-900">{value}</dd>
    </div>
  );
}
