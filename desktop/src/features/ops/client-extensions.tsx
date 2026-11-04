/** Projects, Content and Websites tabs on the client workspace (Phase 5). */
import { Plus } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router";

import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { clientDetailExtensions } from "@/features/clients/client-detail-page";
import { PostDialog } from "@/features/content/post-dialog";
import { ProjectCard, ProjectDialog } from "@/features/projects/projects-pages";
import { WebsitesPage } from "@/features/websites/websites-pages";
import { formatDate } from "@/lib/format";
import type { ClientDetail } from "@/types/clients";
import { PLATFORM_LABELS } from "@/types/ops";

import { usePosts, useProjects } from "./api";

function ClientProjects({ client }: { client: ClientDetail }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const projects = useProjects({ client_id: client.id, status: "all" });
  const [creating, setCreating] = React.useState(false);
  return (
    <div className="flex flex-col gap-3">
      {can("projects.manage") && <Button size="sm" variant="secondary" className="self-end" onClick={() => setCreating(true)}><Plus /> New project</Button>}
      {projects.isError ? <Card><ErrorState error={projects.error} onRetry={() => void projects.refetch()} /></Card>
        : projects.isPending ? <Card className="p-6"><ListSkeleton rows={3} /></Card>
        : projects.data.length === 0 ? <Card><EmptyState title="No projects for this client" /></Card>
        : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{projects.data.map((p) => <ProjectCard key={p.id} project={p} onClick={() => navigate(`/projects/record/${p.id}`)} />)}</div>}
      <ProjectDialog open={creating} onOpenChange={setCreating} clientId={client.id} onSaved={(p) => navigate(`/projects/record/${p.id}`)} />
    </div>
  );
}

function ClientContent({ client }: { client: ClientDetail }) {
  const me = useMe();
  const { can } = useAuth();
  const posts = usePosts({ client_id: client.id });
  const [open, setOpen] = React.useState<string | null | undefined>(undefined);
  return (
    <Card className="overflow-hidden">
      <div className="flex justify-end border-b border-line p-3">
        {can("content.manage") && <Button size="sm" variant="secondary" onClick={() => setOpen(null)}><Plus /> New post</Button>}
      </div>
      {posts.isError ? <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
        : posts.isPending ? <div className="p-6"><ListSkeleton rows={3} /></div>
        : posts.data.length === 0 ? <EmptyState title="No content yet" />
        : (
          <ul className="divide-y divide-line/60">
            {posts.data.map((p) => (
              <li key={p.id}>
                <button onClick={() => setOpen(p.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-raised/40">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: p.stage_color }} />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                  <span className="text-xs text-subtle">{PLATFORM_LABELS[p.platform]}</span>
                  <span className="w-24 text-right text-xs text-subtle">{p.publish_at ? formatDate(p.publish_at, me.timezone) : "Unscheduled"}</span>
                  <span className="w-32 truncate text-right text-xs text-muted">{p.stage_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      <PostDialog open={open !== undefined} onOpenChange={(o) => !o && setOpen(undefined)} postId={open ?? null} defaults={{ client_id: client.id }} />
    </Card>
  );
}

function ClientWebsites({ client }: { client: ClientDetail }) {
  return <WebsitesPage clientId={client.id} embedded />;
}

let registered = false;

export function registerClientOpsExtensions() {
  if (registered) return;
  registered = true;
  clientDetailExtensions.tabs.push(
    { value: "projects", label: "Projects", count: (c) => c.counts.projects, component: ClientProjects },
    { value: "content", label: "Content", count: (c) => c.counts.content_posts, component: ClientContent },
    { value: "websites", label: "Websites", count: (c) => c.counts.websites, component: ClientWebsites },
  );
}
