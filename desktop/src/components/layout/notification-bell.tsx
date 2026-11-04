import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";

import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationList } from "@/types/api";

const KEY = ["notifications"];

export function NotificationBell() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api<NotificationList>("/notifications"),
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const markAll = useMutation({
    mutationFn: () => api("/notifications/read-all", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  const unread = query.data?.unread_count ?? 0;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-magenta px-1 text-[10px] font-semibold text-white ring-2 ring-base">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          className="z-50 w-[380px] rounded-card border border-line bg-overlay shadow-pop focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={unread === 0}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              {!markAll.isPending && <CheckCheck />} Mark all read
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {query.isPending ? (
              <div className="p-3">
                <ListSkeleton rows={3} />
              </div>
            ) : query.isError ? (
              <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
            ) : query.data.items.length === 0 ? (
              <EmptyState title="You're all caught up" compact />
            ) : (
              <ul className="flex flex-col">
                {query.data.items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => !n.read_at && markRead.mutate(n.id)}
                      className="flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-raised"
                    >
                      <span
                        className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")}
                        aria-label={n.read_at ? undefined : "Unread"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm", n.read_at ? "text-muted" : "font-medium text-fg")}>{n.title}</span>
                        {n.body && <span className="mt-0.5 block text-[13px] text-subtle">{n.body}</span>}
                        <span className="mt-1 block text-xs text-subtle">{formatRelative(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
