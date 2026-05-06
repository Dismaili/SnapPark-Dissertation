import clsx from "clsx";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-sky-50 text-sky-700 ring-sky-200",
  reported_to_authority: "bg-violet-50 text-violet-700 ring-violet-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  completed: "Analysed",
  reported_to_authority: "Reported",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_STYLE[status] || "bg-slate-100 text-slate-700 ring-slate-200",
      )}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}
