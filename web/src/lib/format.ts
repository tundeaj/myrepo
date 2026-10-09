// Number-safety helpers — see QUALITY STANDARD, "NUMBER SAFETY".
// Never let undefined/NaN/null/Infinity reach the screen.

export function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatNaira(value: unknown): string {
  const n = safeNumber(value, 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(n);
}

/** The USD counterpart to formatNaira, for Stripe-priced items. */
export function formatUsd(value: unknown): string {
  const n = safeNumber(value, 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Percentage from a 0–1 ratio. Renders "—" when the ratio is null (undefined denominator). */
export function formatPct(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatCount(value: unknown): string {
  const n = safeNumber(value, 0);
  return new Intl.NumberFormat("en-NG").format(n);
}

const LAGOS_TZ = "Africa/Lagos";

export function formatDateTimeLagos(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: LAGOS_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const abs = Math.abs(diffMin);

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffMin, "minute");
  if (abs < 60 * 24) return rtf.format(Math.round(diffMin / 60), "hour");
  return rtf.format(Math.round(diffMin / (60 * 24)), "day");
}
