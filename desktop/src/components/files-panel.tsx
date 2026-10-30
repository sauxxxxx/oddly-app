import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, File as FileIcon, FileImage, FileText, FileVideo, Paperclip, Trash2, Upload } from "lucide-react";
import * as React from "react";

import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Progress } from "@/components/ui/misc";
import { useFiles } from "@/features/clients/api";
import { api, errorMessage } from "@/lib/api";
import { openExternal } from "@/lib/external";
import { formatRelative } from "@/lib/format";
import { formatBytes, uploadFile, type UploadTarget } from "@/lib/upload";
import type { FileRow } from "@/types/clients";

export function fileIcon(type: string) {
  if (type.startsWith("image/")) return FileImage;
  if (type.startsWith("video/")) return FileVideo;
  if (type === "application/pdf" || type.startsWith("text/")) return FileText;
  return FileIcon;
}

/** Opens a short-lived signed link: inline preview, or a download. */
export async function openFile(id: string, attachment = false) {
  const { url } = await api<{ url: string }>(`/files/${id}/download`, { query: { attachment } });
  openExternal(url);
}

/** Attached files for any record, with drag-and-drop upload and progress. */
export function FilesPanel({ target, canEdit, title = "Files" }: { target: UploadTarget; canEdit: boolean; title?: string }) {
  const files = useFiles(target.entity_type, target.entity_id);
  const qc = useQueryClient();
  const input = React.useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = React.useState<{ name: string; pct: number; error?: string }[]>([]);
  const [over, setOver] = React.useState(false);
  const [deleting, setDeleting] = React.useState<FileRow | null>(null);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/files/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files", target.entity_type, target.entity_id] }),
  });

  async function upload(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      setUploads((u) => [...u, { name: file.name, pct: 0 }]);
      try {
        await uploadFile(file, target, (pct) => setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, pct } : x))));
        setUploads((u) => u.filter((x) => x.name !== file.name));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, error: errorMessage(e) } : x)));
      }
    }
    void qc.invalidateQueries({ queryKey: ["files", target.entity_type, target.entity_id] });
  }

  async function open(f: FileRow, attachment: boolean) {
    setOpenError(null);
    try {
      await openFile(f.id, attachment);
    } catch (e) {
      setOpenError(errorMessage(e));
    }
  }

  return (
    <div
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(false);
        void upload(e.dataTransfer.files);
      }}
      className={over ? "rounded-card ring-2 ring-accent/60" : undefined}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        {canEdit && (
          <>
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()}><Upload /> Upload</Button>
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
          </>
        )}
      </div>
      {uploads.map((u) => (
        <div key={u.name} className="mb-2 rounded-control border border-line p-3">
          <p className="mb-2 truncate text-sm">{u.name}</p>
          {u.error ? <p className="text-xs text-danger">{u.error}</p> : <Progress value={u.pct} />}
        </div>
      ))}
      {openError && <p className="mb-2 text-xs text-danger">{openError}</p>}
      {files.isPending ? (
        <ListSkeleton rows={2} />
      ) : files.isError ? (
        <ErrorState error={files.error} onRetry={() => void files.refetch()} compact />
      ) : files.data.length === 0 && uploads.length === 0 ? (
        <EmptyState icon={Paperclip} title="No files yet" description={canEdit ? "Drop files here or use Upload. Files are private to your team." : undefined} compact />
      ) : (
        <ul className="flex flex-col">
          {files.data.map((f) => {
            const Icon = fileIcon(f.content_type);
            return (
              <li key={f.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-raised/50">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-subtle"><Icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{f.original_name}</p>
                  <p className="truncate text-xs text-subtle">{formatBytes(f.size_bytes)} · {f.uploaded_by_name ?? "—"} · {formatRelative(f.created_at)}</p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Preview ${f.original_name}`} onClick={() => void open(f, false)}><Eye /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Download ${f.original_name}`} onClick={() => void open(f, true)}><Download /></Button>
                {canEdit && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.original_name}`} onClick={() => setDeleting(f)}><Trash2 /></Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this file?"
        description={deleting?.original_name ?? ""}
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </div>
  );
}
