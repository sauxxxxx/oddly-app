import { Bot, MessageSquarePlus, Pencil, Send, Sparkles, Trash2, Wrench } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/form-controls";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/features/auth/auth-context";
import { errorMessage } from "@/lib/api";
import { formatRelative, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  useAiStatus,
  useConversation,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
  useSendMessage,
  type AiMessage,
} from "./api";
import { CopyButton, DraftWriter } from "./draft-writer";

const SUGGESTIONS = [
  "Which of my leads haven't been contacted in two weeks?",
  "Summarize my follow-ups and meetings for this week",
  "How did sales go this month compared with last month?",
  "Which clients need attention right now?",
];

/** Shown instead of AI features when the server has no key or the role lacks ai.use. */
export function AiUnavailable({ configured }: { configured: boolean }) {
  return (
    <EmptyState
      icon={Sparkles}
      title={configured ? "Your role doesn't include the AI assistant" : "The AI assistant isn't set up yet"}
      description={
        configured
          ? "Ask an administrator to add the “Use AI assistant” permission to your role."
          : "An administrator needs to add an OpenAI API key (OPENAI_API_KEY) to the server's settings. The key stays on the server — it's never stored in the app."
      }
    />
  );
}

/** Light formatting for assistant replies: paragraphs, bullet and numbered lists, **bold**. */
function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-fg">{part.slice(2, -2)}</strong> : part,
    );
  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]!);
          const Tag = ordered ? "ol" : "ul";
          return (
            <Tag key={i} className={cn("flex flex-col gap-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>)}
            </Tag>
          );
        }
        if (/^#{1,4}\s/.test(block)) return <p key={i} className="font-semibold text-fg">{inline(block.replace(/^#+\s/, ""))}</p>;
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function MessageBubble({ m }: { m: AiMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent/90 px-4 py-2.5 text-sm text-white">{m.content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-magenta text-white">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md border border-line bg-card px-4 py-3 text-sm leading-relaxed text-muted">
          <RichText text={m.content} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
          <span>{formatRelative(m.created_at)}</span>
          {m.tools.length > 0 && (
            <span className="flex items-center gap-1" title="Data the assistant looked up (with your permissions)">
              <Wrench className="size-3" /> {m.tools.map((t) => humanize(t)).join(", ")}
            </span>
          )}
          <CopyButton text={m.content} className="h-6 px-1.5 text-xs" />
        </div>
      </div>
    </div>
  );
}

function Chat({ id }: { id: string }) {
  const conversation = useConversation(id);
  const send = useSendMessage(id);
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);
  const count = conversation.data?.messages.length ?? 0;

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count, send.isPending]);

  function submit(text = draft) {
    const content = text.trim();
    if (!content || send.isPending) return;
    send.mutate(content, { onSuccess: () => setDraft("") });
  }

  if (conversation.isError) return <ErrorState error={conversation.error} onRetry={() => void conversation.refetch()} />;
  if (!conversation.data) return <div className="p-6"><ListSkeleton rows={4} /></div>;
  const c = conversation.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {c.context_type && c.context_id && (
          <p className="mb-4 text-xs text-subtle">
            About {c.context_type}:{" "}
            <Link className="text-accent-fg hover:underline" to={`/${c.context_type === "lead" ? "leads" : "clients"}/record/${c.context_id}`}>
              {c.context_label ?? "record"}
            </Link>
          </p>
        )}
        {c.messages.length === 0 && !send.isPending ? (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-magenta text-white">
              <Sparkles className="size-5" />
            </span>
            <div>
              <p className="text-lg font-medium">What can I help with?</p>
              <p className="mt-1 text-sm text-muted">I can look up leads, sales, clients, tasks and reports you're allowed to see, and write drafts. I can't send, change or publish anything.</p>
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} className="rounded-xl border border-line bg-raised/50 p-3 text-left text-sm text-muted transition-colors hover:border-line-strong hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {c.messages.map((m) => <MessageBubble key={m.id} m={m} />)}
            {send.isPending && (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent/60 px-4 py-2.5 text-sm text-white">{send.variables}</div>
                </div>
                <div className="flex items-center gap-3 text-sm text-subtle">
                  <Skeleton className="size-8 rounded-full" /> Looking things up…
                </div>
              </>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="border-t border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {send.isError && <p className="mb-2 text-sm text-danger-fg">{errorMessage(send.error)}</p>}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            aria-label="Message"
            rows={2}
            maxLength={8000}
            value={draft}
            placeholder="Ask about your leads, pipeline, clients or tasks…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="min-h-[52px] resize-none"
          />
          <Button type="submit" disabled={!draft.trim() || send.isPending} aria-label="Send">
            <Send />
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-[11px] text-subtle">AI answers can be wrong — check important facts in the records. Enter to send, Shift+Enter for a new line.</p>
      </form>
    </div>
  );
}

export function AssistantPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const status = useAiStatus();
  const ready = !!status.data?.configured && can("ai.use");
  const conversations = useConversations(ready);
  const create = useCreateConversation();
  const rename = useRenameConversation();
  const remove = useDeleteConversation();
  const [editing, setEditing] = React.useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const startNew = () => create.mutate({}, { onSuccess: (c) => navigate(`/ai/chat/${c.id}`) });

  if (status.isPending) return <ListSkeleton rows={4} />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="AI Assistant"
        description={ready ? `Answers from the data you can see · model ${status.data.model}` : undefined}
        actions={ready && <Button onClick={startNew} disabled={create.isPending}><MessageSquarePlus /> New chat</Button>}
      />
      {!ready ? (
        <AiUnavailable configured={status.data.configured} />
      ) : (
        <Card className="grid h-[calc(100vh-220px)] min-h-[520px] grid-cols-1 overflow-hidden md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col border-r border-line md:flex">
            <p className="px-4 pb-2 pt-4 text-xs font-medium uppercase tracking-[0.06em] text-subtle">Conversations</p>
            <ul className="flex-1 overflow-y-auto px-2 pb-2">
              {conversations.isPending ? (
                <li className="p-2"><ListSkeleton rows={3} /></li>
              ) : conversations.isError ? (
                <li className="p-2 text-sm text-danger-fg">{errorMessage(conversations.error)}</li>
              ) : conversations.data.length === 0 ? (
                <li className="px-2 py-3 text-sm text-subtle">No conversations yet.</li>
              ) : (
                conversations.data.map((c) => (
                  <li key={c.id} className="group relative">
                    {editing?.id === c.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (editing.title.trim()) rename.mutate({ id: c.id, title: editing.title.trim() }, { onSuccess: () => setEditing(null) });
                        }}
                      >
                        <Input autoFocus value={editing.title} maxLength={120} onBlur={() => setEditing(null)} onChange={(e) => setEditing({ id: c.id, title: e.target.value })} className="h-9" />
                      </form>
                    ) : (
                      <Link
                        to={`/ai/chat/${c.id}`}
                        className={cn("block rounded-lg px-2.5 py-2 pr-14 text-sm transition-colors hover:bg-raised", id === c.id ? "bg-raised text-fg" : "text-muted")}
                      >
                        <span className="block truncate">{c.title ?? "New conversation"}</span>
                        <span className="block truncate text-xs text-subtle">
                          {c.context_label ? `${c.context_label} · ` : ""}
                          {formatRelative(c.updated_at)}
                        </span>
                      </Link>
                    )}
                    {editing?.id !== c.id && (
                      <span className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 gap-0.5 group-hover:flex">
                        <button aria-label="Rename" className="rounded-md p-1 text-subtle hover:bg-card hover:text-fg" onClick={() => setEditing({ id: c.id, title: c.title ?? "" })}>
                          <Pencil className="size-3.5" />
                        </button>
                        <button aria-label="Delete" className="rounded-md p-1 text-subtle hover:bg-card hover:text-danger-fg" onClick={() => setDeleting(c.id)}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    )}
                  </li>
                ))
              )}
            </ul>
          </aside>
          <section className="min-h-0">
            {id ? (
              <Chat key={id} id={id} />
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <EmptyState
                  icon={Bot}
                  title="Start a conversation"
                  description="Ask about your leads, pipeline, clients, tasks or reports. The assistant only sees what you're allowed to see."
                  action={<Button onClick={startNew} disabled={create.isPending}><MessageSquarePlus /> New chat</Button>}
                />
              </div>
            )}
          </section>
        </Card>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this conversation?"
        description="It will be removed from your conversation list."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const target = deleting!;
          remove.mutate(target, {
            onSuccess: () => {
              setDeleting(null);
              if (id === target) navigate("/ai");
            },
          });
        }}
      />
    </div>
  );
}

export function DraftWriterPage() {
  const { can } = useAuth();
  const status = useAiStatus();
  const ready = !!status.data?.configured && can("ai.use");
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Draft Writer" description="Outreach, follow-ups, proposal text, captions and summaries — drafts for you to review, edit and copy." />
      {status.isPending ? (
        <ListSkeleton rows={4} />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : !ready ? (
        <AiUnavailable configured={status.data.configured} />
      ) : (
        <Card className="p-5">
          <DraftWriter />
        </Card>
      )}
    </div>
  );
}
