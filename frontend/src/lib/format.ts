export const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatPercent = (value: number | null | undefined) => {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
};
