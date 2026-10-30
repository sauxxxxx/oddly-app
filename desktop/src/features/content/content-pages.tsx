import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, FileImage, Images, Plus, Search, Settings2, Trash2, Upload } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { dayKey, monthKey, monthRange, MonthCalendar } from "@/components/month-calendar";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/misc";
import { openFile } from "@/components/files-panel";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { useLookups } from "@/features/leads/api";
import { useAssetMutations, useAssets, useContentStageMutations, useMovePost, usePosts, type PostQuery } from "@/features/ops/api";
import { errorMessage } from "@/lib/api";
import { openExternal } from "@/lib/external";
import { formatDate, formatRelative, formatTime, humanize, todayIn } from "@/lib/format";
import { formatBytes, uploadFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import type { FileRow } from "@/types/clients";
import type { Asset, Post } from "@/types/ops";
import { PLATFORM_LABELS } from "@/types/ops";

import { PostDialog } from "./post-dialog";

function usePostDialog() {
  const [state, setState] = React.useState<{ id: string | null; defaults?: { client_id?: string; publish_at?: string } } | null>(null);
  return {
    open: (id: string | null, defaults?: { client_id?: string; publish_at?: string }) => setState({ id, defaults }),
    node: <PostDialog open={!!state} onOpenChange={(o) => !o && setState(null)} postId={state?.id} defaults={state?.defaults} />,
  };
}

/** Client + platform + search filters shared by content pages. */
function useContentFilters() {
  const [client, setClient] = React.useState("");
  const [platform, setPlatform] = React.useState("");
  const [search, setSearch] = React.useState("");
  const lookups = useLookups();
  const bar = (
    <div className="mb-4 flex flex-wrap gap-2">
      <Select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} className="w-auto min-w-48">
        <option value="">All clients</option>
        {lookups.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-auto min-w-40">
        <option value="">All platforms</option>
        {Object.entries(PLATFORM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search posts…" className="pl-9" aria-label="Search posts" />
      </div>
    </div>
  );
  return { q: { client_id: client || undefined, platform: platform || undefined, search: search || undefined } as PostQuery, bar, client };
}

function StagePill({ post }: { post: Post }) {
  return (
    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ color: post.stage_color, borderColor: `${post.stage_color}55`, background: `${post.stage_color}1a` }}>
      {post.stage_name}
    </span>
  );
}

function PostRow({ post: p, onOpen, extra }: { post: Post; onOpen: () => void; extra?: React.ReactNode }) {
  const me = useMe();
  const when = p.publish_at ?? p.due_at;
  return (
    <li className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-raised/40">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-subtle"><FileImage className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{p.title}</p>
          <p className="truncate text-xs text-subtle">{p.client_name} · {PLATFORM_LABELS[p.platform]} · {humanize(p.content_type)}{p.designer_name && ` · ${p.designer_name}`}</p>
        </div>
        <span className="whitespace-nowrap text-xs text-subtle">{when ? `${formatDate(when, me.timezone)} ${formatTime(when, me.timezone)}` : "Unscheduled"}</span>
        <StagePill post={p} />
      </button>
      {extra}
    </li>
  );
}

// ---------------------------------------------------------------------------

export function ContentCalendarPage() {
  const me = useMe();
  const { can } = useAuth();
  const today = todayIn(me.timezone);
  const [month, setMonth] = React.useState(() => monthKey(new Date(), me.timezone));
  const { q, bar, client } = useContentFilters();
  const range = monthRange(month);
  const posts = usePosts({ ...q, from: range.from, to: range.to });
  const dialog = usePostDialog();
  const byDay = new Map<string, Post[]>();
  for (const p of posts.data ?? []) {
    const when = p.publish_at ?? p.due_at;
    if (!when) continue;
    const k = dayKey(when, me.timezone);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  return (
    <>
      <PageHeader title="Content calendar" description="What's publishing when, for every client." actions={can("content.manage") && <Button onClick={() => dialog.open(null, { client_id: client || undefined })}><Plus /> New post</Button>} />
      {bar}
      <Card className="p-5">
        {posts.isError ? <ErrorState error={posts.error} onRetry={() => void posts.refetch()} /> : (
          <MonthCalendar
            month={month}
            onMonth={setMonth}
            today={today}
            items={byDay}
            onDayClick={can("content.manage") ? (day) => dialog.open(null, { client_id: client || undefined, publish_at: `${day}T10:00` }) : undefined}
            renderItem={(p: Post) => (
              <button onClick={() => dialog.open(p.id)} className="flex w-full items-center gap-1 truncate rounded-md bg-raised px-1.5 py-1 text-left text-[11px] hover:bg-raised/70" title={`${p.client_name}: ${p.title} (${p.stage_name})`}>
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: p.stage_color }} />
                <span className="truncate">{p.title}</span>
              </button>
            )}
          />
        )}
      </Card>
      {dialog.node}
    </>
  );
}

export function ContentPlannerPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const { q, bar, client } = useContentFilters();
  const posts = usePosts(q);
  const move = useMovePost();
  const dialog = usePostDialog();
  const [dragging, setDragging] = React.useState<Post | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState(false);
  const stages = lookups.data?.content_stages ?? [];

  return (
    <>
      <PageHeader
        title="Content planner"
        description="Every post through the workflow, from idea to published. Drag to move."
        actions={
          <>
            {can("settings.manage") && <Button variant="secondary" onClick={() => setSettings(true)}><Settings2 /> Workflow</Button>}
            {can("content.manage") && <Button onClick={() => dialog.open(null, { client_id: client || undefined })}><Plus /> New post</Button>}
          </>
        }
      />
      {bar}
      {move.isError && <p className="mb-2 text-sm text-danger">{errorMessage(move.error)}</p>}
      {posts.isError ? <Card><ErrorState error={posts.error} onRetry={() => void posts.refetch()} /></Card> : (
        <div className="-mx-7 overflow-x-auto px-7 pb-4">
          <div className="flex min-h-[55vh] gap-3">
            {stages.map((s) => {
              const cards = (posts.data ?? []).filter((p) => p.stage_id === s.id);
              return (
                <section
                  key={s.id}
                  aria-label={s.name}
                  onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(s.id); } }}
                  onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging && dragging.stage_id !== s.id) move.mutate({ id: dragging.id, stage_id: s.id });
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn("flex w-[250px] shrink-0 flex-col rounded-card border bg-card/60", over === s.id ? "border-accent/60 bg-accent-soft/30" : "border-line")}
                >
                  <header className="flex items-center justify-between border-b border-line px-4 py-3">
                    <h3 className="flex items-center gap-2 text-sm font-medium"><span className="size-2.5 rounded-full" style={{ background: s.color }} />{s.name}</h3>
                    <span className="rounded-md bg-raised px-1.5 text-xs tabular-nums text-muted">{cards.length}</span>
                  </header>
                  <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 320px)" }}>
                    {cards.map((p) => (
                      <article
                        key={p.id}
                        draggable={can("content.manage")}
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragging(p); }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}
                        onClick={() => dialog.open(p.id)}
                        className="cursor-pointer rounded-xl border border-line bg-raised/70 p-3 transition-colors hover:border-line-strong"
                      >
                        <p className="text-sm font-medium leading-snug">{p.title}</p>
                        <p className="mt-0.5 truncate text-xs text-subtle">{p.client_name} · {PLATFORM_LABELS[p.platform]}</p>
                        {p.publish_at && <p className="mt-1.5 text-xs text-muted">Publishes {formatRelative(p.publish_at)}</p>}
                        {p.last_feedback && s.key === "revision_required" && <p className="mt-1.5 line-clamp-2 text-xs text-[#fde047]">{p.last_feedback}</p>}
                      </article>
                    ))}
                    {cards.length === 0 && <p className="px-2 py-6 text-center text-xs text-subtle">Empty</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
      {dialog.node}
      {settings && <WorkflowSettings onClose={() => setSettings(false)} />}
    </>
  );
}

function WorkflowSettings({ onClose }: { onClose: () => void }) {
  const lookups = useLookups();
  const m = useContentStageMutations();
  const [stages, setStages] = React.useState(lookups.data?.content_stages ?? []);
  const [name, setName] = React.useState("");
  const [removing, setRemoving] = React.useState<string | null>(null);
  React.useEffect(() => setStages(lookups.data?.content_stages ?? []), [lookups.data]);
  const error = m.create.error ?? m.update.error ?? m.reorder.error ?? m.remove.error;
  function shift(i: number, by: number) {
    const next = [...stages];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    setStages(next);
    m.reorder.mutate(next.map((x) => x.id));
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Content workflow" description="Rename, recolor and reorder stages, or add your own. Built-in stages drive approvals and publishing, so they can't be removed." className="max-w-xl">
        {error && <p className="mb-3 text-sm text-danger">{errorMessage(error)}</p>}
        <ul className="flex flex-col gap-2">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <input type="color" aria-label={`Color for ${s.name}`} value={s.color} className="size-9 cursor-pointer rounded-lg border border-line bg-raised p-1"
                onChange={(e) => setStages(stages.map((x) => (x.id === s.id ? { ...x, color: e.target.value } : x)))}
                onBlur={() => m.update.mutate({ id: s.id, name: s.name, color: s.color.toUpperCase() })} />
              <Input aria-label="Stage name" value={s.name} onChange={(e) => setStages(stages.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                onBlur={() => s.name.trim() && m.update.mutate({ id: s.id, name: s.name })} />
              <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => shift(i, -1)}><ArrowUp /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => shift(i, 1)}><ArrowDown /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${s.name}`} disabled={!s.key.startsWith("custom_")} onClick={() => setRemoving(s.id)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.create.mutate({ name: name.trim() }, { onSuccess: () => setName("") }); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New stage, e.g. Copywriting" aria-label="New stage" />
          <Button type="submit" variant="secondary" loading={m.create.isPending}><Plus /> Add</Button>
        </form>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
        <ConfirmDialog
          open={!!removing}
          onOpenChange={(o) => !o && setRemoving(null)}
          title="Remove this stage?"
          description="Its posts move to the first stage."
          onConfirm={() => m.remove.mutateAsync({ id: removing!, move_to: stages.find((s) => s.id !== removing)!.id })}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalsPage() {
  const { q, bar } = useContentFilters();
  const posts = usePosts({ ...q, stage_keys: "internal_review,client_approval" });
  const dialog = usePostDialog();
  return (
    <>
      <PageHeader title="Post approvals" description="Content waiting for internal review or client approval. Open a post to approve it or request changes." />
      {bar}
      <Card className="overflow-hidden">
        {posts.isError ? <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
          : posts.isPending ? <div className="p-6"><ListSkeleton rows={4} /></div>
          : posts.data.length === 0 ? <EmptyState icon={Check} title="Nothing waiting for review" description="Posts appear here when they're moved to Internal Review or Client Approval." />
          : <ul className="divide-y divide-line/60">{posts.data.map((p) => <PostRow key={p.id} post={p} onOpen={() => dialog.open(p.id)} />)}</ul>}
      </Card>
      {dialog.node}
    </>
  );
}

export function CaptionsPage() {
  const { q, bar } = useContentFilters();
  const posts = usePosts({ ...q, with_caption: true });
  const dialog = usePostDialog();
  const [copied, setCopied] = React.useState<string | null>(null);
  return (
    <>
      <PageHeader title="Captions" description="Every caption and its hashtags, ready to copy into the platform." />
      {bar}
      {posts.isError ? <Card><ErrorState error={posts.error} onRetry={() => void posts.refetch()} /></Card>
        : posts.isPending ? <Card className="p-6"><ListSkeleton rows={4} /></Card>
        : posts.data.length === 0 ? <Card><EmptyState icon={Copy} title="No captions yet" description="Captions written on posts collect here." /></Card>
        : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {posts.data.map((p) => {
              const text = [p.caption, p.hashtags.join(" ")].filter(Boolean).join("\n\n");
              return (
                <Card key={p.id} className="gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <button className="min-w-0 text-left" onClick={() => dialog.open(p.id)}>
                      <p className="truncate text-sm font-medium hover:underline">{p.title}</p>
                      <p className="truncate text-xs text-subtle">{p.client_name} · {PLATFORM_LABELS[p.platform]}</p>
                    </button>
                    <StagePill post={p} />
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted">{p.caption}</p>
                  {p.hashtags.length > 0 && <p className="text-sm text-accent">{p.hashtags.join(" ")}</p>}
                  <Button variant="secondary" size="sm" className="self-start"
                    onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(p.id); setTimeout(() => setCopied(null), 1500); }).catch(() => setCopied(null))}>
                    {copied === p.id ? <Check /> : <Copy />} {copied === p.id ? "Copied" : "Copy caption"}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      {dialog.node}
    </>
  );
}

export function PublishedPage() {
  const me = useMe();
  const { q, bar } = useContentFilters();
  const posts = usePosts({ ...q, stage_keys: "published" });
  const dialog = usePostDialog();
  const items = [...(posts.data ?? [])].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  return (
    <>
      <PageHeader title="Published content" description="What went live, when, and where." />
      {bar}
      <Card className="overflow-hidden">
        {posts.isError ? <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
          : posts.isPending ? <div className="p-6"><ListSkeleton rows={4} /></div>
          : items.length === 0 ? <EmptyState icon={ExternalLink} title="Nothing published yet" description="Moving a post to Published records the date; add the live link to keep it here." />
          : (
            <ul className="divide-y divide-line/60">
              {items.map((p) => (
                <PostRow key={p.id} post={p} onOpen={() => dialog.open(p.id)} extra={
                  <span className="flex items-center gap-2 text-xs text-subtle">
                    {p.published_at && formatDate(p.published_at, me.timezone, { year: "numeric" })}
                    {p.published_url ? <Button variant="ghost" size="icon-sm" aria-label="Open live post" onClick={() => openExternal(p.published_url!)}><ExternalLink /></Button> : <Badge tone="warning">No link</Badge>}
                  </span>
                } />
              ))}
            </ul>
          )}
      </Card>
      {dialog.node}
    </>
  );
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

const ASSET_TYPES = ["graphic", "video", "logo", "brand_guideline", "font", "image", "marketing_material", "other"];

export function MediaLibraryPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const [client, setClient] = React.useState("");
  const [type, setType] = React.useState("");
  const [search, setSearch] = React.useState("");
  const assets = useAssets({ client_id: client || undefined, asset_type: type || undefined, search: search || undefined });
  const { add, remove } = useAssetMutations();
  const input = React.useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = React.useState<{ name: string; pct: number; error?: string }[]>([]);
  const [deleting, setDeleting] = React.useState<Asset | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);

  function guessType(f: File) {
    const n = f.name.toLowerCase();
    if (f.type.startsWith("video/")) return "video";
    if (/logo/.test(n)) return "logo";
    if (/guideline|brand/.test(n) && f.type === "application/pdf") return "brand_guideline";
    if (/\.(ttf|otf|woff2?)$/.test(n)) return "font";
    if (f.type.startsWith("image/")) return "graphic";
    return "marketing_material";
  }

  async function upload(files: FileList) {
    if (!client) return;
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, pct: 0 }]);
      try {
        const row = await uploadFile<FileRow>(file, { bucket: "media", entity_type: "client", entity_id: client, category: "media" }, (pct) =>
          setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, pct } : x))),
        );
        await add.mutateAsync({ client_id: client, file_id: row.id, asset_type: type || guessType(file), title: file.name.replace(/\.[^.]+$/, ""), tags: [] });
        setUploads((u) => u.filter((x) => x.name !== file.name));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, error: errorMessage(e) } : x)));
      }
    }
  }

  return (
    <>
      <PageHeader
        title="Graphics & media"
        description="Each client's logos, brand guidelines, graphics, videos and fonts — private to the team."
        actions={can("content.manage") && (
          <>
            <Button onClick={() => input.current?.click()} disabled={!client} title={client ? undefined : "Choose a client first"}><Upload /> Upload</Button>
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
          </>
        )}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} className="w-auto min-w-52">
          <option value="">All clients</option>
          {lookups.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-auto min-w-44">
          <option value="">All types</option>
          {ASSET_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
        </Select>
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or tag…" className="pl-9" aria-label="Search media" />
        </div>
        {!client && can("content.manage") && <span className="self-center text-xs text-subtle">Choose a client to upload.</span>}
      </div>
      {uploads.map((u) => (
        <Card key={u.name} className="mb-2 p-3">
          <p className="mb-2 truncate text-sm">{u.name}</p>
          {u.error ? <p className="text-xs text-danger">{u.error}</p> : <Progress value={u.pct} />}
        </Card>
      ))}
      {assets.isError ? <Card><ErrorState error={assets.error} onRetry={() => void assets.refetch()} /></Card>
        : assets.isPending ? <Card className="p-6"><ListSkeleton rows={3} /></Card>
        : assets.data.length === 0 ? <Card><EmptyState icon={Images} title="No media yet" description="Choose a client and upload their logo, brand guide and graphics." /></Card>
        : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {assets.data.map((a) => (
              <Card key={a.id} className="group overflow-hidden">
                <button className="aspect-[4/3] w-full overflow-hidden bg-raised" onClick={async () => { setOpening(a.id); try { await openFile(a.file_id); } finally { setOpening(null); } }} aria-label={`Open ${a.original_name}`}>
                  {a.preview_url && a.content_type.startsWith("image/") ? (
                    <img src={a.preview_url} alt={a.title ?? a.original_name} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
                  ) : a.preview_url && a.content_type.startsWith("video/") ? (
                    <video src={a.preview_url} muted className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-xs text-subtle">{a.original_name.split(".").pop()?.toUpperCase()}</span>
                  )}
                </button>
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.title ?? a.original_name}</p>
                    <p className="truncate text-xs text-subtle">{a.client_name} · {humanize(a.asset_type)} · {formatBytes(a.size_bytes)}</p>
                  </div>
                  {opening === a.id && <span className="text-xs text-subtle">…</span>}
                  {can("content.manage") && (
                    <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${a.original_name}`} onClick={() => setDeleting(a)}><Trash2 /></Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this file?" description={deleting?.original_name ?? ""} onConfirm={() => remove.mutateAsync(deleting!.id)} />
    </>
  );
}
