import { api } from "./api";

export interface UploadTarget {
  bucket: "media" | "documents";
  entity_type: string;
  entity_id: string;
  category?: string;
}

/**
 * Uploads a file straight to private storage with progress:
 * 1) the API checks permission and returns a one-time signed URL,
 * 2) the file is PUT there (bytes never pass through the API),
 * 3) the API verifies the object exists and records it.
 */
export async function uploadFile<T>(file: File, target: UploadTarget, onProgress?: (pct: number) => void): Promise<T> {
  const contentType = file.type || guessType(file.name);
  const ticket = await api<{ upload_url: string; storage_path: string }>("/files/upload-url", {
    method: "POST",
    body: { ...target, file_name: file.name, content_type: contentType, size_bytes: file.size },
  });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.upload_url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });

  return api<T>("/files", {
    method: "POST",
    body: { bucket: target.bucket, storage_path: ticket.storage_path, entity_type: target.entity_type, entity_id: target.entity_id, original_name: file.name, category: target.category },
  });
}

function guessType(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (
    {
      ai: "application/postscript",
      eps: "application/postscript",
      psd: "image/vnd.adobe.photoshop",
      otf: "font/otf",
      ttf: "font/ttf",
      woff: "font/woff",
      woff2: "font/woff2",
      zip: "application/zip",
    }[ext] ?? "application/octet-stream"
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
