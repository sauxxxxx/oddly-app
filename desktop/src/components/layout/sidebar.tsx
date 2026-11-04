import { ChevronDown, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import * as React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

import { LogoMark, Wordmark } from "@/components/brand/logo";
import { ThemeSwitch } from "@/components/theme-switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, Kbd, Tooltip } from "@/components/ui/misc";
import { NAV_SECTIONS, type NavModule } from "@/config/navigation";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";

import { shortcutLabel } from "./command-palette";

function isModuleActive(module: NavModule, pathname: string) {
  if (module.path === "/") return pathname === "/";
  return pathname === module.path || pathname.startsWith(module.path + "/");
}

export function Sidebar({
  collapsed,
  onToggle,
  onOpenSearch,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
}) {
  const { can } = useAuth();
  const { pathname } = useLocation();

  // Expanded groups: the active module opens automatically; others toggle by hand.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const isOpen = (m: NavModule) => open[m.id] ?? isModuleActive(m, pathname);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-line bg-sidebar transition-[width] duration-200 ease-out",
        collapsed ? "w-[64px]" : "w-[248px]",
      )}
    >
      {/* Workspace header */}
      <div className={cn("flex items-center gap-3 p-4", collapsed && "justify-center px-0")}>
        <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="ODDLY home">
          <LogoMark className="size-7 shrink-0" />
          {!collapsed && (
            <Wordmark className="block leading-5" />
          )}
        </Link>
      </div>

      {/* Search */}
      <div className={cn("px-4 pb-2", collapsed && "px-3")}>
        <Tooltip content={`Search (${shortcutLabel})`} disabled={!collapsed}>
          <button
            onClick={onOpenSearch}
            className={cn(
              "flex h-10 w-full items-center gap-2.5 rounded-control border border-line bg-raised/60 px-3 text-sm text-subtle transition-colors hover:border-line-strong hover:text-muted",
              collapsed && "justify-center px-0",
            )}
            aria-label="Search"
          >
            <Search className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Search</span>
                <Kbd>{shortcutLabel}</Kbd>
              </>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3" aria-label="Main">
        {NAV_SECTIONS.map((section) => {
          const modules = section.modules.filter((m) => can(m.permission));
          if (modules.length === 0) return null;
          return (
            <div key={section.label} className="mt-4 first:mt-2">
              {collapsed ? (
                <div className="mx-auto mb-2 h-px w-6 bg-line" />
              ) : (
                <p className="mb-1.5 px-3 text-xs text-subtle">
                  {section.label}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {modules.map((m) => (
                  <ModuleItem
                    key={m.id}
                    module={m}
                    collapsed={collapsed}
                    active={isModuleActive(m, pathname)}
                    expanded={isOpen(m)}
                    onToggle={() => setOpen((o) => ({ ...o, [m.id]: !isOpen(m) }))}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className={cn("border-t border-line p-3", collapsed && "flex flex-col items-center gap-2")}>
        <UserCard collapsed={collapsed} />
        <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
          <button
            onClick={onToggle}
            className={cn(
              "mt-1 flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] text-subtle transition-colors hover:bg-raised hover:text-fg",
              collapsed ? "w-10 justify-center px-0" : "w-full",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && "Collapse"}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

function ModuleItem({
  module,
  collapsed,
  active,
  expanded,
  onToggle,
}: {
  module: NavModule;
  collapsed: boolean;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const Icon = module.icon;
  const children = module.children?.filter((c) => can(c.permission)) ?? [];

  const rowClass = cn(
    "group flex h-9 w-full items-center gap-3 rounded-control px-3 text-sm transition-colors",
    active
      ? "bg-raised font-medium text-fg"
      : "text-muted hover:bg-raised/60 hover:text-fg",
    collapsed && "justify-center px-0",
  );
  const icon = collapsed && <Icon className={cn("size-[18px] shrink-0", active ? "text-accent" : "text-subtle group-hover:text-muted")} />;

  if (collapsed || children.length === 0) {
    const target = children[0]?.path ?? module.path;
    return (
      <li>
        <Tooltip content={module.label} disabled={!collapsed}>
          <NavLink to={target} end={target === "/"} className={rowClass} aria-current={active ? "page" : undefined}>
            {icon}
            {!collapsed && <span className="truncate">{module.label}</span>}
          </NavLink>
        </Tooltip>
      </li>
    );
  }

  return (
    <li>
      <button
        className={rowClass}
        aria-expanded={expanded}
        onClick={() => {
          if (!expanded && !active) navigate(children[0]!.path);
          onToggle();
        }}
      >
        {icon}
        <span className="flex-1 truncate text-left">{module.label}</span>
        <ChevronDown className={cn("size-4 text-subtle transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <ul className="my-0.5 ml-3 flex flex-col gap-0.5">
          {children.map((c) => (
            <li key={c.path}>
              <NavLink
                to={c.path}
                end
                className={({ isActive }) =>
                  cn(
                    "flex h-8 items-center rounded-md px-2.5 text-[13px] transition-colors",
                    isActive ? "font-medium text-accent-fg" : "text-subtle hover:text-fg",
                  )
                }
              >
                {c.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function UserCard({ collapsed }: { collapsed: boolean }) {
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-3 rounded-control p-2 text-left transition-colors hover:bg-raised",
            collapsed && "w-auto justify-center",
          )}
          aria-label="Account menu"
        >
          <Avatar name={me.full_name} />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{me.full_name}</p>
                <p className="truncate text-xs text-subtle">{me.email}</p>
              </div>
              <MoreHorizontal className="size-4 text-subtle" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel>Signed in as {me.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate("/settings/profile")}>My profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2.5 py-2">
          <p className="mb-2 text-xs text-subtle">Appearance</p>
          <ThemeSwitch compact className="w-full justify-between" />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void signOut()}>Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
