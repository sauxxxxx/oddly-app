/** Display formatting. All dates render in the signed-in user's time zone. */

const numberFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(n: number) {
  return numberFmt.format(n);
}

export function formatCompact(n: number) {
  return compactFmt.format(n);
}

/** Amounts arrive from the API as decimal strings to avoid float rounding. */
export function formatMoney(amount: string | number, currency: string, opts: { compact?: boolean } = {}) {
  const value = typeof amount === "string" ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: opts.compact ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : 2,
    }).format(value);
  } catch {
    return `${currency} ${numberFmt.format(value)}`;
  }
}

export function formatPercent(part: number, whole: number) {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

/** Percentage change vs the previous period, or null when there's nothing to compare. */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export function formatDate(iso: string, timeZone?: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone, ...opts }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
}

/** "2026-10-30" (a calendar date from the API) without shifting through UTC. */
export function formatPlainDate(date: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(iso: string) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso, undefined, { year: abs > 86400 * 300 ? "numeric" : undefined });
}

export function humanize(key: string) {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

export function shiftDate(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}
