import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "2026-11" month key helpers, in the user's time zone. */
export function monthKey(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(d);
}

export function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** UTC range covering a month (with a day of slack each side for time zones). */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y!, m! - 1, 0)).toISOString(), to: new Date(Date.UTC(y!, m!, 2)).toISOString() };
}

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Month grid (Mon–Sun). `items` are grouped by their YYYY-MM-DD day key. */
export function MonthCalendar<T>({
  month,
  onMonth,
  today,
  items,
  renderItem,
  onDayClick,
  maxPerDay = 4,
}: {
  month: string;
  onMonth: (m: string) => void;
  today: string;
  items: Map<string, T[]>;
  renderItem: (item: T) => React.ReactNode;
  onDayClick?: (day: string) => void;
  maxPerDay?: number;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => {
    const d = new Date(Date.UTC(y!, m! - 1, 1 - offset + i));
    return { key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m! - 1 };
  });
  const label = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-medium">{label}</h2>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => onMonth(today.slice(0, 7))}>Today</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-card border border-line">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="border-b border-line bg-card px-2 py-2 text-xs font-medium uppercase tracking-[0.06em] text-subtle">{d}</div>
        ))}
        {cells.map((c, i) => {
          const list = items.get(c.key) ?? [];
          return (
            <div
              key={c.key}
              onClick={onDayClick ? () => onDayClick(c.key) : undefined}
              className={cn(
                "min-h-28 border-line p-1.5",
                i % 7 !== 6 && "border-r",
                i < cells.length - 7 && "border-b",
                c.inMonth ? "bg-base" : "bg-canvas/60",
                onDayClick && "cursor-pointer hover:bg-raised/30",
              )}
            >
              <span
                className={cn(
                  "mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                  c.key === today ? "bg-accent font-semibold text-white" : c.inMonth ? "text-muted" : "text-subtle/60",
                )}
              >
                {c.day}
              </span>
              <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                {list.slice(0, maxPerDay).map((item, n) => <React.Fragment key={n}>{renderItem(item)}</React.Fragment>)}
                {list.length > maxPerDay && <span className="px-1 text-[11px] text-subtle">+{list.length - maxPerDay} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
