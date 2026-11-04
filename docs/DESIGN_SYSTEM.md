# ODDLY — Design system

Dark-first, flat and quiet: charcoal surfaces, hairline borders, one purple accent, small corners and no decoration. Tokens live in `desktop/src/styles/globals.css`.

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

| `text-*-fg` (`danger`, `success`, `warning`, `accent`, `info`, `magenta`) | theme-dependent | Readable text on the matching `*-soft` background (badges, alerts, overdue dates) |

Radii: cards `rounded-card` (8px), controls `rounded-control` (6px). Font: Plus Jakarta Sans.

## Themes

Dark is the default. Light mode redefines the same tokens under `:root[data-theme="light"]`
in `globals.css`, so components never branch on the theme. `lib/theme.ts` stores the choice
(Dark / Light / System) per device and sets `data-theme` before the first render; the
`color-scheme` property follows it so native controls (dropdown menus, date pickers,
scrollbars) match. Chart colors in `chart-kit.tsx` use neutral greys that read on both.

## Rules

- No raw hex in components — use tokens. Recharts needs literals; those live in
  `features/dashboard/chart-kit.tsx` (`CHART`) and mirror the tokens.
- Accent is for the **one** primary action and the active state. Everything else is neutral.
- No gradients, glow, blur, hatching or decorative animation. The logo is the only exception.
- No icons on menu items or card titles. Keep a subtitle only if it says something you cannot already see.
- No em dashes or middle dots in on-screen text. Use plain words, not technical terms.
- Every data view has four states: loading (plain text), empty (`EmptyState`, one short line), error (`ErrorState` with retry), and success.
- Never show placeholder business data.
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
