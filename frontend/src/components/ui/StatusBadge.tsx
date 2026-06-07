import clsx from "clsx";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-900",
  completed: "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-900",
  reported_to_authority: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-900",
  resolved: "bg-brand-subtle text-brand-fg ring-brand/40",
  cancelled: "bg-muted text-muted-fg ring-line",
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
        STATUS_STYLE[status] || "bg-muted text-fg-soft ring-line",
      )}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}
