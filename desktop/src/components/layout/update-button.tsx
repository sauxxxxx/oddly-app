import { isTauri } from "@tauri-apps/api/core";
import { Download } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

/**
 * Desktop app only: checks for a signed update on start and every 6 hours. Nothing is
 * downloaded or installed until the user chooses to.
 */
export function UpdateButton() {
  const [update, setUpdate] = React.useState<Update>(null);
  const [open, setOpen] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isTauri() || import.meta.env.DEV) return;
    let cancelled = false;
    const run = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (!cancelled) setUpdate(found);
      } catch {
        // Offline or the update server is unreachable — try again later.
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 6 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!update) return null;

  async function install() {
    if (!update) return;
    setError(null);
    setProgress(0);
    try {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          if (total) setProgress(Math.min(99, Math.round((done / total) * 100)));
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setProgress(null);
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="border-accent/40 text-accent-fg">
        <Download /> Update
      </Button>
      <Dialog open={open} onOpenChange={(o) => progress === null && setOpen(o)}>
        <DialogContent title={`ODDLY ${update.version} is available`} description={`You have ${update.currentVersion}. ODDLY restarts after installing.`}>
          {update.body && <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-sm text-muted">{update.body}</p>}
          {progress !== null && <p className="mt-3 text-sm text-muted">Downloading… {progress}%</p>}
          {error && <p className="mt-3 text-sm text-danger-fg">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={progress !== null}>
              Later
            </Button>
            <Button onClick={() => void install()} disabled={progress !== null}>
              <Download /> Install and restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
