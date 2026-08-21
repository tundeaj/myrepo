// Small date helpers. All "this week" math uses Monday-start weeks in the
// platform default timezone conceptually; for the numbers involved here (day-granularity
// admin stats) working in server-local time is an acceptable simplification — a session
// scheduled at 00:30 WAT will not flip week bucket vs UTC in a way that matters for a
// weekly count. Revisit if the platform ever needs to defend an exact boundary.

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

export function daysAgo(n: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Last `n` months as { key: 'YYYY-MM', start: Date, end: Date }, oldest first. */
export function lastNMonths(n: number, from: Date = new Date()) {
  const months: { key: string; start: Date; end: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(from.getFullYear(), from.getMonth() - i, 1);
    const end = new Date(from.getFullYear(), from.getMonth() - i + 1, 1);
    months.push({ key: monthKey(start), start, end });
  }
  return months;
}

/** Safe division — never NaN/Infinity. Returns null when the denominator is zero. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}
