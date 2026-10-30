import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** "facebook.com/x" -> "https://facebook.com/x"; leaves mailto:/tel: alone. */
export function normalizeUrl(url: string) {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  return `https://${u}`;
}

/** Opens a link in the user's normal browser (desktop app) or a new tab (web). */
export function openExternal(url: string) {
  const target = normalizeUrl(url);
  if (isTauri()) {
    void openUrl(target);
  } else {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}

/** Short label for a URL: "facebook.com/barilibakery". */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}
