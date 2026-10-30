import { Check, ExternalLink, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import * as React from "react";

import { ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TagInput, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { useLookups } from "@/features/leads/api";
import { useAssetMutations, useAssets, useDeletePost, usePost, useReviewPost, useSavePost } from "@/features/ops/api";
import { ApiError, errorMessage } from "@/lib/api";
import { fromLocalInput, toLocalInput } from "@/lib/dates";
import { openExternal } from "@/lib/external";
import { formatRelative, humanize } from "@/lib/format";
import { uploadFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import type { FileRow } from "@/types/clients";
import type { Platform, Post } from "@/types/ops";
import { CONTENT_TYPES, PLATFORM_LABELS } from "@/types/ops";

/** Create or edit a content post, review it, and attach media from the client's library. */
export function PostDialog({
  postId,
  open,
  onOpenChange,
  defaults,
}: {
  postId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaults?: { client_id?: string; publish_at?: string };
}) {
  const me = useMe();
  const { can } = useAuth();
  const lookups = useLookups();
  const post = usePost(open ? postId ?? null : null);
  const save = useSavePost(postId ?? undefined);
  const remove = useDeletePost();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [deleting, setDeleting] = React.useState(false);
  const init = (p?: Post) => ({
    client_id: p?.client_id ?? defaults?.client_id ?? "",
    title: p?.title ?? "",
    platform: p?.platform ?? ("facebook" as Platform),
    content_type: p?.content_type ?? "image",
    category: p?.category ?? "",
    campaign: p?.campaign ?? "",
    caption: p?.caption ?? "",
    hashtags: p?.hashtags ?? [],
    stage_id: p?.stage_id ?? "",
    designer_id: p?.designer_id ?? "",
    creator_id: p?.creator_id ?? me.id,
    due_at: toLocalInput(p?.due_at),
    publish_at: p ? toLocalInput(p.publish_at) : defaults?.publish_at ?? "",
    published_url: p?.published_url ?? "",
  });
  const [f, setF] = React.useState(() => init());
  React.useEffect(() => {
    if (open && !postId) setF(init());
    if (open) {
      setErrors({});
      save.reset();
    }
  }, [open, postId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened
  React.useEffect(() => {
    if (post.data) setF(init(post.data));
  }, [post.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per post

  const editable = can("content.manage");
  const stages = lookups.data?.content_stages ?? [];

  function submit() {
    const e: Record<string, string> = {};
    if (!f.client_id) e.client_id = "Choose the client.";
    if (!f.title.trim()) e.title = "Give the post a working title.";
    setErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(
      {
        client_id: f.client_id, title: f.title.trim(), platform: f.platform, content_type: f.content_type,
        category: f.category || null, campaign: f.campaign || null, caption: f.caption || null, hashtags: f.hashtags,
        stage_id: f.stage_id || null, designer_id: f.designer_id || null, creator_id: f.creator_id || null,
        due_at: fromLocalInput(f.due_at), publish_at: fromLocalInput(f.publish_at), published_url: f.published_url || null,
      },
      { onSuccess: () => !postId && onOpenChange(false), onError: (err) => err instanceof ApiError && setErrors(err.fields) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={postId ? (post.data?.title ?? "Post") : "New post"}
        description={post.data ? `${post.data.client_name} · ${PLATFORM_LABELS[post.data.platform]}` : undefined}
        className="max-h-[calc(100vh-4rem)] max-w-4xl overflow-y-auto"
      >
        {postId && post.isPending ? <ListSkeleton rows={5} /> : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && <FormAlert>{errorMessage(save.error)}</FormAlert>}
              {post.data?.last_feedback && post.data.stage_key === "revision_required" && (
                <div className="rounded-control border border-warning/30 bg-warning-soft p-3 text-sm text-[#fde047]">Changes requested: {post.data.last_feedback}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Client" htmlFor="ps-client" error={errors.client_id}>
                  <Select id="ps-client" disabled={!editable} value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
                    <option value="">Choose…</option>
                    {lookups.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Stage" htmlFor="ps-stage">
                  <Select id="ps-stage" disabled={!editable} value={f.stage_id} onChange={(e) => setF({ ...f, stage_id: e.target.value })}>
                    {!postId && <option value="">First stage</option>}
                    {stages.filter((s) => s.key !== "approved" || can("content.approve") || s.id === f.stage_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Working title" htmlFor="ps-title" error={errors.title} className="col-span-2">
                  <Input id="ps-title" autoFocus={!postId} disabled={!editable} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Weekend brunch promo" />
                </Field>
                <Field label="Platform" htmlFor="ps-platform">
                  <Select id="ps-platform" disabled={!editable} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as Platform })}>
                    {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
                  </Select>
                </Field>
                <Field label="Type" htmlFor="ps-type">
                  <Select id="ps-type" disabled={!editable} value={f.content_type} onChange={(e) => setF({ ...f, content_type: e.target.value as typeof f.content_type })}>
                    {CONTENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
                  </Select>
                </Field>
                <Field label="Category" htmlFor="ps-cat"><Input id="ps-cat" disabled={!editable} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Promo, tip, testimonial…" /></Field>
                <Field label="Campaign" htmlFor="ps-camp"><Input id="ps-camp" disabled={!editable} value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })} /></Field>
                <Field label={`Caption (${f.caption.length} characters)`} htmlFor="ps-caption" className="col-span-2">
                  <Textarea id="ps-caption" disabled={!editable} rows={5} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} />
                </Field>
                <Field label="Hashtags" htmlFor="ps-tags" className="col-span-2"><TagInput id="ps-tags" value={f.hashtags} onChange={(v) => editable && setF({ ...f, hashtags: v })} placeholder="#cebu, #brunch" /></Field>
                <Field label="Designer" htmlFor="ps-designer">
                  <Select id="ps-designer" disabled={!editable} value={f.designer_id} onChange={(e) => setF({ ...f, designer_id: e.target.value })}>
                    <option value="">None</option>{lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </Field>
                <Field label="Content creator" htmlFor="ps-creator">
                  <Select id="ps-creator" disabled={!editable} value={f.creator_id} onChange={(e) => setF({ ...f, creator_id: e.target.value })}>
                    <option value="">None</option>{lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </Field>
                <Field label="Design due" htmlFor="ps-due"><Input id="ps-due" type="datetime-local" disabled={!editable} value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} /></Field>
                <Field label="Publish on" htmlFor="ps-pub"><Input id="ps-pub" type="datetime-local" disabled={!editable} value={f.publish_at} onChange={(e) => setF({ ...f, publish_at: e.target.value })} /></Field>
                <Field label="Published link" htmlFor="ps-url" className="col-span-2"><Input id="ps-url" disabled={!editable} value={f.published_url} onChange={(e) => setF({ ...f, published_url: e.target.value })} placeholder="Paste the live post URL after publishing" /></Field>
              </div>
              {editable && (
                <div className="flex justify-end gap-2">
                  {postId && <Button type="button" variant="ghost" className="mr-auto text-[#fca5a5]" onClick={() => setDeleting(true)}><Trash2 /> Delete</Button>}
                  <Button type="submit" loading={save.isPending}>{postId ? "Save" : "Create post"}</Button>
                </div>
              )}
            </form>
            {post.data && (
              <div className="flex flex-col gap-5">
                <ReviewPanel postId={post.data.id} />
                <PostMedia postId={post.data.id} clientId={post.data.client_id} />
                {post.data.published_url && (
                  <Button variant="secondary" size="sm" onClick={() => openExternal(post.data!.published_url!)}><ExternalLink /> Open live post</Button>
                )}
              </div>
            )}
          </div>
        )}
        <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Delete this post?" description={post.data?.title ?? ""} onConfirm={() => remove.mutateAsync(postId!).then(() => onOpenChange(false))} />
      </DialogContent>
    </Dialog>
  );
}

function ReviewPanel({ postId }: { postId: string }) {
  const { can } = useAuth();
  const post = usePost(postId);
  const review = useReviewPost(postId);
  const [feedback, setFeedback] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const p = post.data!;
  const reviewable = ["internal_review", "client_approval"].includes(p.stage_key);

  function decide(decision: "approved" | "changes_requested") {
    setError(null);
    if (decision === "changes_requested" && !feedback.trim()) return setError("Say what needs to change.");
    review.mutate({ decision, feedback: feedback || null }, { onSuccess: () => setFeedback(""), onError: (e) => setError(errorMessage(e)) });
  }

  return (
    <section className="rounded-control border border-line p-4">
      <p className="mb-2 flex items-center justify-between text-sm font-medium">
        Review
        <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ color: p.stage_color, borderColor: `${p.stage_color}55` }}>{p.stage_name}</span>
      </p>
      {can("content.approve") && reviewable ? (
        <div className="flex flex-col gap-2">
          <Textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback (required for changes)" aria-label="Review feedback" />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" loading={review.isPending} onClick={() => decide("changes_requested")}><RotateCcw /> Request changes</Button>
            <Button size="sm" loading={review.isPending} onClick={() => decide("approved")}><Check /> Approve</Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-subtle">{reviewable ? "Waiting for an approver." : "Move the post to Internal Review when it's ready."}</p>
      )}
      {p.approvals.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          {p.approvals.map((a) => (
            <li key={a.id} className="text-xs">
              <Badge tone={a.decision === "approved" ? "success" : "warning"}>{a.decision === "approved" ? "Approved" : "Changes requested"}</Badge>
              <span className="ml-1.5 text-subtle">{a.reviewer_name} · {formatRelative(a.created_at)}</span>
              {a.feedback && <p className="mt-1 text-muted">{a.feedback}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PostMedia({ postId, clientId }: { postId: string; clientId: string }) {
  const { can } = useAuth();
  const assets = useAssets({ post_id: postId });
  const { add } = useAssetMutations();
  const input = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function upload(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      try {
        setProgress(0);
        const row = await uploadFile<FileRow>(file, { bucket: "media", entity_type: "client", entity_id: clientId, category: "content" }, setProgress);
        await add.mutateAsync({
          client_id: clientId, file_id: row.id, post_id: postId,
          asset_type: file.type.startsWith("video/") ? "video" : "graphic", title: file.name.replace(/\.[^.]+$/, ""), tags: [],
        });
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setProgress(null);
      }
    }
    void assets.refetch();
  }

  return (
    <section className="rounded-control border border-line p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Media</p>
        {can("content.manage") && (
          <>
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()} loading={progress !== null}><ImagePlus /> Add</Button>
            <input ref={input} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
          </>
        )}
      </div>
      {progress !== null && <p className="mb-2 text-xs text-subtle">Uploading… {progress}%</p>}
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      {assets.data?.length ? (
        <div className="grid grid-cols-2 gap-2">
          {assets.data.map((a) => (
            <div key={a.id} className={cn("aspect-square overflow-hidden rounded-lg border border-line bg-raised")}>
              {a.preview_url && a.content_type.startsWith("image/") ? (
                <img src={a.preview_url} alt={a.title ?? a.original_name} className="size-full object-cover" />
              ) : a.preview_url && a.content_type.startsWith("video/") ? (
                <video src={a.preview_url} className="size-full object-cover" muted />
              ) : (
                <p className="p-2 text-xs text-subtle">{a.original_name}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-subtle">No media attached yet.</p>
      )}
    </section>
  );
}
