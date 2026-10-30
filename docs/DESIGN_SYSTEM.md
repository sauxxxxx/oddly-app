# ODDLY — Design system

Dark-first, premium, calm. Derived from the reference dashboard: charcoal surfaces, a fixed
rounded sidebar panel, rounded cards with hairline borders, purple/magenta accents, and
**diagonal hatching** for secondary data. Tokens live in `desktop/src/styles/globals.css`.

## Tokens

| Token (Tailwind) | Value | Use |
|---|---|---|
| `bg-canvas` | `#0B0B0C` | Window background behind panels |
| `bg-base` | `#111111` | Main content area |
| `bg-sidebar` | `#191919` | Sidebar panel |
| `bg-card` | `#1D1D1F` | Cards and panels |
| `bg-raised` | `#252528` | Inputs, chips, hovered rows |
| `bg-overlay` | `#202023` | Menus, dialogs, tooltips |
| `border-line` / `border-line-strong` | `#2A2A2E` / `#3A3A3F` | Hairlines / hover borders |
| `text-fg` / `text-muted` / `text-subtle` | `#F5F5F5` / `#A1A1AA` / `#71717A` | Primary / secondary / tertiary text |
| `accent` / `magenta` | `#A855F7` / `#D946EF` | Brand, primary actions, active state, charts |
| `success` `warning` `danger` `info` | green / yellow / red / blue | Status only, with `*-soft` backgrounds |

Radii: cards `rounded-card` (20px), controls `rounded-control` (12px). Font: Plus Jakarta Sans.

## Rules

- No raw hex in components — use tokens. Recharts needs literals; those live in
  `features/dashboard/chart-kit.tsx` (`CHART`) and mirror the tokens.
- Accent is for the **one** primary action and the active state. Everything else is neutral.
- Gradients only on the logo, progress fills and chart fills. No gradient backgrounds on cards.
- Every data view has four states: loading (skeleton), empty (`EmptyState` with what will
  appear and how), error (`ErrorState` with retry), and success.
- Never show placeholder business data. Unbuilt modules show their roadmap page.
- Money is shown per currency; never add different currencies together.
- Dates render in the user's time zone (`profiles.timezone`).

## Components (`desktop/src/components`)

- `ui/` — `Button` (primary, secondary, ghost, outline, danger, link), `Input`, `Select`,
  `Field`, `Card` / `CardHeader` / `CardBody`, `Badge` / `PriorityBadge`, `Dialog`,
  `DropdownMenu`, `Tooltip`, `Avatar`, `Skeleton`, `Progress`, `Kbd`.
- `states.tsx` — `EmptyState`, `ErrorState`, `ListSkeleton`, `FullScreenLoader`.
- `layout/` — `AppShell` (+ `PageHeader`), `Sidebar`, `CommandPalette`, `NotificationBell`.

Adding a shadcn component: `npx shadcn@latest add <name>` (configured by `components.json`),
then restyle it with the tokens above.

## Navigation

`desktop/src/config/navigation.ts` drives the sidebar, the Ctrl+K palette and the
breadcrumbs. Each module declares its permission, so people only see what their role allows.
