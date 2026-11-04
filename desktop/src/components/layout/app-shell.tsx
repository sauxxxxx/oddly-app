import { ChevronRight, Moon, Search, Sun } from "lucide-react";
import * as React from "react";
import { Link, Outlet, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import { ALL_MODULES } from "@/config/navigation";
import { useTheme } from "@/lib/theme";
import { safeStorage } from "@/lib/utils";

import { CommandPalette, shortcutLabel } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { Sidebar } from "./sidebar";
import { UpdateButton } from "./update-button";

const COLLAPSE_KEY = "oddly.sidebar.collapsed";

export function AppShell() {
  const [collapsed, setCollapsed] = React.useState(() => safeStorage.get(COLLAPSE_KEY) === "1");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const { pathname } = useLocation();
  const mainRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // New page, start at the top.
  // Braces matter: newer browsers return a Promise from scrollTo, which React would treat as a cleanup.
  React.useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  function toggle() {
    setCollapsed((c) => {
      safeStorage.set(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  return (
    <div className="flex h-full bg-base">
      <Sidebar collapsed={collapsed} onToggle={toggle} onOpenSearch={() => setPaletteOpen(true)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-6">
          <Breadcrumbs pathname={pathname} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden h-10 w-64 items-center gap-2.5 rounded-control border border-line bg-raised/60 px-3 text-sm text-subtle transition-colors hover:border-line-strong xl:flex"
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">Jump to…</span>
              <Kbd>{shortcutLabel}</Kbd>
            </button>
            <UpdateButton />
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>

        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] px-6 py-5">
            <React.Suspense fallback={<PageLoading />}>
              <Outlet />
            </React.Suspense>
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function PageLoading() {
  return <p className="text-sm text-subtle">Loading…</p>;
}

/** One-click dark/light switch (System is in the account menu and My Profile). */
function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const isLight = document.documentElement.dataset.theme === "light";
  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Dark mode" : "Light mode"}
      onClick={() => setPreference(isLight ? "dark" : "light")}
      data-preference={preference}
    >
      {isLight ? <Moon /> : <Sun />}
    </Button>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const module = ALL_MODULES.find((m) =>
    m.path === "/" ? pathname === "/" : pathname === m.path || pathname.startsWith(m.path + "/"),
  );
  const child = module?.children?.find((c) => c.path === pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link to="/" className="text-subtle transition-colors hover:text-fg">
        ODDLY
      </Link>
      {module && (
        <>
          <ChevronRight className="size-3.5 text-subtle" />
          <span className={child ? "text-subtle" : "text-fg"}>{module.label}</span>
        </>
      )}
      {child && child.label !== module?.label && (
        <>
          <ChevronRight className="size-3.5 text-subtle" />
          <span className="truncate text-fg">{child.label}</span>
        </>
      )}
    </nav>
  );
}

/** Page title row used at the top of every page. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
