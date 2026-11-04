import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Checkbox } from "./form-controls";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Server-side sort key; omit for unsortable columns. */
  sortKey?: string;
  className?: string;
  headerClassName?: string;
}

export interface SortState {
  sort?: string;
  dir?: "asc" | "desc";
}

/**
 * Table for server-paginated lists: sortable headers, optional row selection,
 * clickable rows, loading skeleton. Empty/error states are rendered by the caller.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  sort,
  onSort,
  selected,
  onSelectedChange,
  onRowClick,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
}) {
  const selectable = !!selected && !!onSelectedChange;
  const allOnPage = rows.length > 0 && rows.every((r) => selected?.has(r.id));
  const someOnPage = rows.some((r) => selected?.has(r.id));

  function toggleAll() {
    if (!selected || !onSelectedChange) return;
    const next = new Set(selected);
    for (const r of rows) {
      if (allOnPage) next.delete(r.id);
      else next.add(r.id);
    }
    onSelectedChange(next);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left">
            {selectable && (
              <th className="sticky top-0 w-12 border-b border-line bg-card py-3 pl-5 pr-2">
                <Checkbox checked={allOnPage} indeterminate={!allOnPage && someOnPage} onChange={toggleAll} label="Select all on this page" />
              </th>
            )}
            {columns.map((c) => {
              const active = sort?.sort === c.sortKey && !!c.sortKey;
              return (
                <th
                  key={c.key}
                  className={cn(
                    "sticky top-0 whitespace-nowrap border-b border-line bg-card px-4 py-3 text-xs font-medium text-subtle",
                    c.headerClassName,
                  )}
                  aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.sortKey && onSort ? (
                    <button
                      className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}
                      onClick={() =>
                        onSort({ sort: c.sortKey, dir: active && sort?.dir === "desc" ? "asc" : "desc" })
                      }
                    >
                      {c.header}
                      {active && (sort?.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0
            ? (
                <tr>
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-5 py-4 text-sm text-subtle">
                    Loading…
                  </td>
                </tr>
              )
            : rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "group transition-colors",
                    onRowClick && "cursor-pointer",
                    selected?.has(row.id) ? "bg-accent-soft/60" : "hover:bg-raised/40",
                    rowClassName?.(row),
                  )}
                >
                  {selectable && (
                    <td className="border-b border-line/60 py-3 pl-5 pr-2">
                      <Checkbox
                        checked={selected!.has(row.id)}
                        onChange={(on) => {
                          const next = new Set(selected);
                          if (on) next.add(row.id);
                          else next.delete(row.id);
                          onSelectedChange!(next);
                        }}
                        label="Select row"
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={cn("border-b border-line/60 px-4 py-3 align-middle", c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  perPage,
  total,
  onPage,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 text-[13px] text-subtle">
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="px-2 tabular-nums">
          Page {page} of {pages}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
