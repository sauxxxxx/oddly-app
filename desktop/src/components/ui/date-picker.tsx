import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import { formatPlainDate, shiftDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { controlClass } from "./control";
import { Select } from "./select";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_TIME = "09:00";

type View = "days" | "months" | "years";

const pad = (n: number) => String(n).padStart(2, "0");

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localNowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseMonth(date: string) {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1 };
}

/** 42 cells (Mon–Sun), so the popup doesn't change height between months. */
function monthGrid(year: number, month: number) {
  const first = `${year}-${pad(month + 1)}-01`;
  const weekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => shiftDate(first, i - weekday));
}

function timeLabel(time: string) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

function TimeFields({ time, onChange }: { time: string; onChange: (t: string) => void }) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const hour12 = h % 12 || 12;
  const pm = h >= 12;
  const set = (hour: number, minute: number, isPm: boolean) => onChange(`${pad((hour % 12) + (isPm ? 12 : 0))}:${pad(minute)}`);
  // Every 5 minutes, keeping an existing value that falls between them.
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort((a, b) => a - b);
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-t border-line pt-3">
      <Select aria-label="Hour" value={hour12} onChange={(e) => set(Number(e.target.value), m, pm)}>
        {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
      </Select>
      <Select aria-label="Minute" value={m} onChange={(e) => set(hour12, Number(e.target.value), pm)}>
        {minutes.map((v) => <option key={v} value={v}>{pad(v)}</option>)}
      </Select>
      <Select aria-label="AM or PM" value={pm ? "pm" : "am"} onChange={(e) => set(hour12, m, e.target.value === "pm")}>
        <option value="am">AM</option>
        <option value="pm">PM</option>
      </Select>
    </div>
  );
}

function NavHeader({ title, onTitle, onPrev, onNext, prevLabel, nextLabel }: {
  title: string;
  onTitle?: () => void;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
}) {
  const arrow = "flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg";
  return (
    <div className="mb-2 flex items-center justify-between gap-1">
      <button type="button" aria-label={prevLabel} onClick={onPrev} className={arrow}><ChevronLeft className="size-4" /></button>
      <button
        type="button"
        onClick={onTitle}
        disabled={!onTitle}
        className="rounded-lg px-2.5 py-1 text-sm font-medium text-fg transition-colors enabled:hover:bg-raised"
      >
        {title}
      </button>
      <button type="button" aria-label={nextLabel} onClick={onNext} className={arrow}><ChevronRight className="size-4" /></button>
    </div>
  );
}

function Tile({ label, active, current, disabled, onClick }: { label: string; active: boolean; current: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-10 rounded-lg text-sm transition-colors disabled:opacity-30",
        active ? "bg-accent font-medium text-white" : "text-fg enabled:hover:bg-raised",
        !active && current && "text-accent-fg",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Custom replacement for <input type="date"> and <input type="datetime-local">, using the same
 * value formats ("2026-11-04", "2026-11-04T14:30"). Dates are plain calendar days.
 */
export function DatePicker({
  type,
  id,
  value = "",
  onChange,
  min,
  max,
  disabled,
  className,
  placeholder,
  ...trigger
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "value" | "onChange"> & {
  type: "date" | "datetime-local";
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  min?: string;
  max?: string;
  placeholder?: string;
}) {
  const withTime = type === "datetime-local";
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  const today = localToday();
  const minDay = min?.slice(0, 10);
  const maxDay = max?.slice(0, 10);

  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<View>("days");
  const [cursor, setCursor] = React.useState(() => parseMonth(date || today));
  const [focusDay, setFocusDay] = React.useState(date || today);
  const grid = React.useRef<HTMLDivElement>(null);
  const moveFocus = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    setView("days");
    setCursor(parseMonth(date || today));
    setFocusDay(date || today);
    // Reopen on the selected month; later changes while open shouldn't jump the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [focusDay]);

  const emit = (next: string) =>
    onChange?.({ target: { value: next }, currentTarget: { value: next } } as React.ChangeEvent<HTMLInputElement>);
  const blocked = (day: string) => (!!minDay && day < minDay) || (!!maxDay && day > maxDay);

  function pick(day: string) {
    if (blocked(day)) return;
    if (withTime) {
      emit(`${day}T${time || DEFAULT_TIME}`);
    } else {
      emit(day);
      setOpen(false);
    }
  }

  function shiftCursor(by: number) {
    const d = new Date(Date.UTC(cursor.year, cursor.month + by, 1));
    setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  }

  function onGridKey(e: React.KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      shiftCursor(e.key === "PageUp" ? -1 : 1);
      return;
    }
    if (!step) return;
    e.preventDefault();
    const next = shiftDate(focusDay, step);
    moveFocus.current = true;
    setFocusDay(next);
    setCursor(parseMonth(next));
  }

  const label = date
    ? `${formatPlainDate(date, { month: "short", day: "numeric", year: "numeric" })}${withTime && time ? `, ${timeLabel(time)}` : ""}`
    : (placeholder ?? (withTime ? "Pick a date and time" : "Pick a date"));
  // Keeps the shown year near the middle of the 12-year page.
  const startYear = cursor.year - 4;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="dialog"
          className={cn(controlClass, "flex items-center gap-2 text-left", !date && "text-subtle", className)}
          {...trigger}
        >
          <CalendarDays className="size-4 shrink-0 text-subtle" />
          <span className="truncate">{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onClick={(e) => e.stopPropagation()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus());
          }}
          className="z-[60] w-[19.5rem] animate-pop-in rounded-card border border-line bg-overlay p-3 shadow-pop focus:outline-none"
        >
          {view === "days" && (
            <>
              <NavHeader
                title={`${MONTHS[cursor.month]} ${cursor.year}`}
                onTitle={() => setView("months")}
                onPrev={() => shiftCursor(-1)}
                onNext={() => shiftCursor(1)}
                prevLabel="Previous month"
                nextLabel="Next month"
              />
              <div className="mb-1 grid grid-cols-7">
                {WEEKDAYS.map((d) => <span key={d} className="py-1 text-center text-xs text-subtle">{d}</span>)}
              </div>
              <div ref={grid} role="grid" aria-label="Calendar" onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5">
                {monthGrid(cursor.year, cursor.month).map((day) => {
                  const inMonth = parseMonth(day).month === cursor.month;
                  const active = day === date;
                  return (
                    <button
                      key={day}
                      type="button"
                      tabIndex={day === focusDay ? 0 : -1}
                      disabled={blocked(day)}
                      aria-label={formatPlainDate(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      aria-pressed={active}
                      onClick={() => pick(day)}
                      onFocus={() => setFocusDay(day)}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-lg text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30",
                        active ? "bg-accent font-medium text-white" : "enabled:hover:bg-raised",
                        !active && (inMonth ? "text-fg" : "text-subtle/70"),
                        !active && day === today && "font-medium text-accent-fg ring-1 ring-inset ring-accent/50",
                      )}
                    >
                      {Number(day.slice(8))}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === "months" && (
            <>
              <NavHeader
                title={String(cursor.year)}
                onTitle={() => setView("years")}
                onPrev={() => setCursor({ ...cursor, year: cursor.year - 1 })}
                onNext={() => setCursor({ ...cursor, year: cursor.year + 1 })}
                prevLabel="Previous year"
                nextLabel="Next year"
              />
              <div className="grid grid-cols-3 gap-1">
                {MONTHS.map((name, i) => (
                  <Tile
                    key={name}
                    label={name}
                    active={!!date && parseMonth(date).year === cursor.year && parseMonth(date).month === i}
                    current={parseMonth(today).year === cursor.year && parseMonth(today).month === i}
                    onClick={() => {
                      setCursor({ ...cursor, month: i });
                      setView("days");
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {view === "years" && (
            <>
              <NavHeader
                title={`${startYear} – ${startYear + 11}`}
                onPrev={() => setCursor({ ...cursor, year: cursor.year - 12 })}
                onNext={() => setCursor({ ...cursor, year: cursor.year + 12 })}
                prevLabel="Earlier years"
                nextLabel="Later years"
              />
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, i) => startYear + i).map((year) => (
                  <Tile
                    key={year}
                    label={String(year)}
                    active={!!date && parseMonth(date).year === year}
                    current={parseMonth(today).year === year}
                    onClick={() => {
                      setCursor({ ...cursor, year });
                      setView("months");
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {withTime && view === "days" && date && (
            <div className="mt-3">
              <TimeFields time={time || DEFAULT_TIME} onChange={(t) => emit(`${date}T${t}`)} />
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={blocked(today)}
                onClick={() => {
                  setCursor(parseMonth(today));
                  setFocusDay(today);
                  setView("days");
                  if (withTime) emit(`${today}T${time || localNowTime()}`);
                  else pick(today);
                }}
              >
                {withTime ? "Now" : "Today"}
              </Button>
              {value && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    emit("");
                    setOpen(false);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            {withTime && (
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
