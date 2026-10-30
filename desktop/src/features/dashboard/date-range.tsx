import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formatPlainDate, shiftDate, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PresetKey = "today" | "7d" | "30d" | "90d" | "mtd" | "ytd" | "12m" | "custom";

export interface DateRange {
  preset: PresetKey;
  from: string;
  to: string;
}

const PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "This month" },
  { key: "ytd", label: "This year" },
  { key: "12m", label: "Last 12 months" },
];

export function rangeForPreset(preset: Exclude<PresetKey, "custom">, timeZone: string): DateRange {
  const today = todayIn(timeZone);
  const from = {
    today: today,
    "7d": shiftDate(today, -6),
    "30d": shiftDate(today, -29),
    "90d": shiftDate(today, -89),
    mtd: today.slice(0, 8) + "01",
    ytd: today.slice(0, 5) + "01-01",
    "12m": shiftDate(today, -364),
  }[preset];
  return { preset, from, to: today };
}

export function rangeLabel(range: DateRange) {
  const preset = PRESETS.find((p) => p.key === range.preset);
  if (preset) return preset.label;
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${formatPlainDate(range.from, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" })} – ${formatPlainDate(range.to, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function DateRangePicker({
  value,
  onChange,
  timeZone,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  timeZone: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(value.from);
  const [to, setTo] = React.useState(value.to);
  const invalid = !from || !to || from > to;

  React.useEffect(() => {
    if (open) {
      setFrom(value.from);
      setTo(value.to);
    }
  }, [open, value]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="secondary" className="min-w-44 justify-between">
          <span className="flex items-center gap-2">
            <CalendarDays className="text-subtle" />
            {rangeLabel(value)}
          </span>
          <ChevronDown className="text-subtle" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 flex w-[440px] animate-pop-in overflow-hidden rounded-card border border-line bg-overlay shadow-pop focus:outline-none"
        >
          <ul className="w-44 border-r border-line p-1.5">
            {PRESETS.map((p) => (
              <li key={p.key}>
                <button
                  onClick={() => {
                    onChange(rangeForPreset(p.key, timeZone));
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-raised",
                    value.preset === p.key ? "text-fg" : "text-muted",
                  )}
                >
                  {p.label}
                  {value.preset === p.key && <Check className="size-4 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex flex-1 flex-col gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (invalid) return;
              onChange({ preset: "custom", from, to });
              setOpen(false);
            }}
          >
            <p className="text-sm font-medium">Custom range</p>
            <Field label="From" htmlFor="range-from">
              <Input id="range-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="range-to" error={from > to ? "End date must be after the start date." : undefined}>
              <Input id="range-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" disabled={invalid} className="mt-auto">
              Apply
            </Button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
