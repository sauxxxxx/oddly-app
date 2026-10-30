import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CornerDownLeft, Search } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router";

import { Kbd } from "@/components/ui/misc";
import { ALL_MODULES } from "@/config/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const shortcutLabel = isMac ? "⌘K" : "Ctrl K";

interface Entry {
  label: string;
  group: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Ctrl/⌘+K: jump to any page you have access to. Record search arrives with Phase 2. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);

  const entries = React.useMemo<Entry[]>(
    () =>
      ALL_MODULES.filter((m) => can(m.permission)).flatMap((m) => {
        const children = (m.children ?? []).filter((c) => can(c.permission));
        if (children.length === 0) return [{ label: m.label, group: "Go to", path: m.path, icon: m.icon }];
        return children.map((c) => ({ label: c.label, group: m.label, path: c.path, icon: m.icon }));
      }),
    [can],
  );

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => `${e.label} ${e.group}`.toLowerCase().includes(q));
  }, [entries, query]);

  React.useEffect(() => {
    setIndex(0);
  }, [query, open]);
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  function go(entry: Entry | undefined) {
    if (!entry) return;
    onOpenChange(false);
    navigate(entry.path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[index]);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/55" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-[560px] -translate-x-1/2 animate-pop-in overflow-hidden rounded-card border border-line bg-overlay shadow-pop focus:outline-none"
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">Search ODDLY</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Type to find a page, then press Enter.</DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 text-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pages…"
              className="h-13 flex-1 bg-transparent text-[15px] text-fg placeholder:text-subtle focus:outline-none"
              aria-label="Search pages"
              role="combobox"
              aria-expanded
              aria-controls="command-results"
              aria-activedescendant={results[index] ? `cmd-${index}` : undefined}
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul id="command-results" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {results.length === 0 && (
              <li className="px-3 py-8 text-center text-sm text-subtle">No pages match “{query}”.</li>
            )}
            {results.map((entry, i) => {
              const Icon = entry.icon;
              return (
                <li
                  key={entry.path}
                  id={`cmd-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => go(entry)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                    i === index ? "bg-raised text-fg" : "text-muted",
                  )}
                >
                  <Icon className={cn("size-4", i === index ? "text-accent" : "text-subtle")} />
                  <span className="flex-1">{entry.label}</span>
                  <span className="text-xs text-subtle">{entry.group}</span>
                  {i === index && <CornerDownLeft className="size-3.5 text-subtle" />}
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
