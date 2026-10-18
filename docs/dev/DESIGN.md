# Sourcefold design guide

Every UI task follows this file. If a brief and this file disagree, the brief wins for that task. Do not invent new colors, fonts, radii or shadows; use the tokens below.

There are two looks:

- **Desktop app** (`apps/desktop`): "Ink and highlighter", redesigned 2026-10-18. Its section comes first.
- **Web app and extension** (`apps/web`, `apps/extension`): the original archive look, under "Web app and extension" below. Don't change them to the desktop look until the owner asks.

# Desktop app: ink and highlighter

## Idea

A researcher's desk. The window is the **desk** (cool grey with a faint paper grain); the content is a **sheet** of paper lying on it (rounded, slightly raised). Everything is written in **ink** (near-black in light mode, near-white in dark). There is one colour of its own: the **highlighter**, a yellow marker stroke that means "this is where you are" or "this is what you marked". Source types keep their own colours (below); they are the only other colours on screen.

The one memorable element is the **highlighted heading**: the open group's name, set large in Newsreader, with a highlighter stroke swept in behind it from the left when the group opens. The open group in the sidebar gets the same stroke, smaller. Don't put the stroke anywhere else except highlights in the reader and the unsaved count; that would cheapen it.

## Tokens

All tokens live in `apps/desktop/src/index.css` and are Tailwind colours (`bg-desk`, `text-muted-foreground`, `bg-marker-soft`, …). Never write raw hex values in components; never use Tailwind's palette colours (`amber-500`, `emerald-600`, `gray-*`, `black/40`).

| Token                                       | Light                             | Dark                              | Use                                                 |
| ------------------------------------------- | --------------------------------- | --------------------------------- | --------------------------------------------------- |
| `--desk`                                    | `#E8EAEE`                         | `#0E0F13`                         | Window background and sidebar                       |
| `--background`                              | `#FCFCFB`                         | `#17191E`                         | The sheet (main content)                            |
| `--card` / `--popover`                      | `#FFFFFF`                         | `#1C1E24`                         | Dialogs, menus, raised panels                       |
| `--foreground`                              | `#15181E`                         | `#ECEDEF`                         | Ink: text                                           |
| `--primary` / `--primary-foreground`        | ink / paper                       | ink / paper                       | The one main action in a view ("Add links", "Save") |
| `--muted`                                   | `#F1F2F5`                         | `#22252C`                         | Hover fills, search field, count chips              |
| `--accent`                                  | `#EAECF0`                         | `#272A32`                         | Keyboard-focused or selected row                    |
| `--muted-foreground`                        | `#5E6573`                         | `#979EAA`                         | Secondary text, metadata                            |
| `--border` / `--border-strong`              | `#E1E4EA` / `#CDD2DA`             | `#2A2E36` / `#3A3F49`             | Hairlines / outline buttons, strong dividers        |
| `--input`                                   | `#D9DDE4`                         | `#343842`                         | Input borders                                       |
| `--marker`                                  | `#F7E35A`                         | `#B9A332`                         | The highlighter stroke (`.marker` class only)       |
| `--marker-soft`                             | `#FBF1B0`                         | `#3A361D`                         | Text selection, ticked rows, highlight backgrounds  |
| `--marker-strong` (+ `-foreground`)         | `#F5DC3C`                         | `#EAD34B`                         | Solid marker chips (unsaved count), the logo's fold |
| `--destructive` / `--warning` / `--success` | `#C2362B` / `#B25E09` / `#2F8A57` | `#F0857A` / `#F2A65A` / `#6CC794` | Delete and errors / warnings / saved                |
| `--ring`                                    | ink                               | ink                               | Focus outline                                       |
| `--sidebar-accent`                          | white 72%                         | white 6%                          | Hover and selected rows on the desk (sidebar)       |
| `--overlay`                                 | ink 32%                           | black 56%                         | Behind dialogs and the sliding sidebar              |

Source-type colours are the same values as the web app's (table under "Web app and extension"), plus `--source-wikipedia` (`#3F4A5A` / `#C3CAD4`). A source type is shown as a **tile**: a 28–32px rounded square (radius 8px) filled with the source colour at 12% (`color-mix(in oklab, <colour> 12%, transparent)`), its lucide icon in the source colour, always next to the source name in text somewhere on the row. `getSourceKind()` in `features/items/source-kinds.tsx` gives the colour.

## Type

Fonts are bundled (no network): `@fontsource-variable/geist`, `geist-mono`, `newsreader` (imported in `main.tsx`).

- **Geist** (`font-sans`): all interface text. Weights 400, 500, 600.
- **Newsreader** (`font-serif`): headings, dialog titles, source titles in rows, the reader's body. Weights 400–600; it has optical sizes, so large sizes look right automatically.
- **Geist Mono** (`font-mono`): key hints (`Kbd`) and real code only.

| Role                     | Font       | Size / line height              | Weight | Tracking     |
| ------------------------ | ---------- | ------------------------------- | ------ | ------------ |
| Group heading            | Newsreader | 40px / 44px (30/36 when narrow) | 500    | -0.02em      |
| Empty-state title        | Newsreader | 24px / 30px                     | 500    | -0.012em     |
| Dialog title             | Newsreader | 22px / 28px                     | 500    | -0.012em     |
| Source title in a row    | Newsreader | 16px / 22px                     | 500    | -0.005em     |
| Body / UI default        | Geist      | 13.5–14px / 20px                | 400    |              |
| Buttons, tabs, menu rows | Geist      | 13–13.5px                       | 500    |              |
| Metadata, counts         | Geist      | 12.5–13px / 18px, muted         | 400    | tabular-nums |
| Small labels             | Geist      | 12px / 16px, muted              | 500    |              |

Sentence case everywhere; no all-caps labels, no letter-spaced eyebrows, no "·"-joined meta strings (use commas or separate columns), no "→" on buttons. Numbers that line up (counts, dates, times) use `tabular-nums`.

## Layout

```
desk ────────────────────────────────────────────────────────────────────────
│ [logo] Sourcefold   ⌘K [⇤] │ ┌ sheet (radius 14, shadow-sheet) ───────────────┐ │
│ [ Cars             ⌄ ]     │ │ Cars / Engines / Turbocharging   [⌕ Search /] (●Saved) [+ Add links A] │
│ Groups               +     │ ├────────────────────────────────────────────────┤ │
│ › Engines           14     │ │  Turbocharging              ← Newsreader 40, marker │
│ ⌄ ▔Turbocharging▔    6     │ │  2 subgroups, 6 sources        [New subgroup] [Add image] [New note] │
│     Lag and boost    3     │ │  Sources 6   Highlights 14                       │ │
│                            │ │  [tile] Title in Newsreader            YouTube  Oct 17 ✓ │
│ (AK) anil  Synced    ⌨  ⚙ │ └────────────────────────────────────────────────┘ │
```

- **Window:** on macOS the title bar is transparent and the traffic lights sit over the sidebar's top strip (`.platform-mac` on `<html>`; the strip is 52px tall with 84px left padding). The top bar and sidebar header carry `data-tauri-drag-region`. Windows keeps its native title bar. Minimum window 720×520.
- **Sidebar** (`features/shell/AppSidebar.tsx`): 264px on the desk, no border. At 1024px and wider it sits beside the sheet and `Mod+B` hides it (remembered). Narrower, it's hidden and slides over the content as a floating panel (`shadow-float`, radius 16px) with a scrim; picking a group or Esc closes it.
- **Sheet:** inset 8px from the window edges, radius 14px, `bg-background shadow-sheet`. It is a container (`@container/view`); rows and headers adapt to its width with container queries (`@[560px]/view:…`), not window media queries.
- **Top bar** (`features/shell/TopBar.tsx`, 52px, `@container/topbar`): sidebar button when hidden, breadcrumb (project / ancestors / group in ink), search field, Drive status (`DriveSyncStatus`), **Add links** (ink). Labels drop to icons as it narrows.
- **Group view:** padding 36px (20px when narrow). Heading, counts and actions, tabs, then rows. Content is left-aligned; numbers right-aligned in their column.
- **Rows** (sources, subgroups, highlights, search results): no divider lines and no cards. Each row is a 52–56px rounded (10px) band that bleeds 10px past the text column (`-mx-2.5 px-2.5`); hover `bg-muted`, keyboard focus `bg-accent` plus a 2px ink bar on the left edge, ticked `bg-marker-soft`. Row actions (three dots) appear on hover and focus. Columns, narrowest last to go: tile, title (+ one muted line under it when there's real data: author, site, channel, duration), source name, date, status. Below 560px sheet width hide source name; below 440px hide the date.
- **Sidebar rows:** 30px, radius 8px, indent 14px per level, chevron 14px. Hover `bg-sidebar-accent`; open group `bg-sidebar-accent shadow-raised` with the group name in `.marker`; count right-aligned, muted, tabular.

## Shape and depth

- Radius: key hints 5px; small buttons, inputs, sidebar rows 8–9px; list rows and menus' items 8–10px; menus and popovers 12px; the sheet 14px; dialogs and the sliding sidebar 16px. Inner radius = outer radius minus padding.
- Shadows (all tinted with ink, defined once): `shadow-raised` (hairline + 1px: buttons, chips, tiles), `shadow-sheet` (the sheet), `shadow-float` (dialogs, menus, toasts, sliding sidebar). Nothing else has a shadow. Outline buttons draw their border with an inset shadow (`--border-strong`).
- Borders are 1px `--border`, used for the top bar, tabs and section rules only.

## Motion

The app uses `motion` (`motion/react`) and CSS keyframes from `index.css`. `MotionConfig reducedMotion="user"` wraps the app and a CSS rule shortens everything under `prefers-reduced-motion`.

- Curves: `--ease-spring` `cubic-bezier(0.32, 0.72, 0, 1)` for things that move (dialogs, drawers, menus), `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` for fades. Never `linear` (except spinners and shimmer) or plain `ease-in-out`.
- Durations: 100–160ms for hovers and presses, 180–260ms for menus and dialogs, 300–340ms for the sidebar and the reader, 640ms for the heading's highlighter sweep.
- What moves: dialogs rise 10px and scale from 97% (exit faster); menus scale from their corner; the sidebar slides; buttons press to 97% (`motion-safe:active:scale-[0.97]`); chevrons rotate; tree branches expand by height; the active tab's underline and the open sidebar row's pill slide between items (`layoutId`); rows of a newly opened group rise in with a 20ms stagger (first 12 rows only); the heading's stroke sweeps (`.marker.marker-sweep`, re-keyed per group); the "Saved to Drive" dot pings twice.
- What never moves: anything on scroll, hover lifts, looping decoration, blur on scrolling content. Animate only `transform` and `opacity` (the marker sweep animates `background-size` on one element, which is fine).

## Components

Use the primitives in `apps/desktop/src/components/ui/`; don't restyle them per use.

- `Button`: `default` (ink, the main action), `outline`, `ghost`, `secondary`, `destructive`, `link`, `marker` (rare). Sizes `sm` (32px), `default` (36px), `lg` (40px), `icon` (32px), `icon-sm` (28px). Put a `Kbd` inside for the shortcut.
- `Input`: 36px, radius 9px. Textareas copy its classes.
- `Kbd`: key hints. Inside an ink button it turns translucent by itself.
- `Dialog*`: animated, Esc stack and focus trap built in. Title in Newsreader. Footer has no rule; the main action is last (rightmost) and uses `default` or `destructive`.
- `DropdownMenu*`: animated. Items are 32px with an icon on the left (muted) and an optional `Kbd` on the right.
- `EmptyState`: icon in a little stack of cards, serif title, one sentence, the next action. Use it for every empty or "nothing found" view; `compact` inside panels.
- `Logo`: the ink tile with the folded S and its highlighted middle fold.
- Loading: `.skeleton` blocks shaped like the rows they replace, not spinners, for lists. Spinners (`Loader2`, `motion-safe:animate-spin`) only inside buttons and status chips.
- Icons: lucide, stroke 1.75 (set globally), `size-4` in buttons and rows, `size-3.5` in dense menus.

## Accessibility floor

- Visible keyboard focus everywhere: 2px ink outline, 2px offset (rows use the focused-row style instead).
- Every icon-only button has an `aria-label` and a `title` with its shortcut.
- The tree keeps `role="tree"`/`treeitem` with `aria-expanded`; tabs keep `role="tablist"`/`tab`.
- Colour is never the only signal: source tiles sit next to the source name; statuses pair an icon with a tooltip.
- Text contrast at least 4.5:1 (muted text on the desk included).

## Writing

The same rules as the web app (below): name things by what the user does, actions keep their name in the result ("Save to Drive" gives "Saved to Drive"), errors say what happened and what to do, empty states invite action, sentence case.

# Web app and extension

## Idea

Sourcefold is an archive of research sources. The look borrows from archive boxes and library catalogues: cool paper, blue-black ink, one bookbinding green for actions. It is a dense desktop tool, not a marketing page.

The one memorable element is the **folder heading**: the open folder's name set large in a serif, like the label on an archive box. Everything else is quiet and disciplined.

## Color tokens

Light theme (default):

| Token                  | Hex       | Use                                                            |
| ---------------------- | --------- | -------------------------------------------------------------- |
| `--background`         | `#FBFCFD` | Main content surface ("sheet")                                 |
| `--foreground`         | `#1C2533` | Primary text ("ink")                                           |
| `--sidebar`            | `#EEF1F4` | Sidebar background ("archive board")                           |
| `--muted`              | `#EEF1F4` | Subtle fills (hovered rows, input backgrounds)                 |
| `--muted-foreground`   | `#5B6676` | Secondary text, metadata                                       |
| `--border` / `--input` | `#D5DBE3` | Rules, input borders                                           |
| `--primary`            | `#1F5E4E` | Primary buttons, selected folder text, links ("binding green") |
| `--primary-foreground` | `#FFFFFF` | Text on primary                                                |
| `--accent`             | `#E3EFEA` | Selected folder row background, selected item background       |
| `--accent-foreground`  | `#1F5E4E` | Text on accent                                                 |
| `--ring`               | `#1F5E4E` | Focus ring                                                     |
| `--destructive`        | `#B42318` | Delete actions, error text                                     |
| `--warning`            | `#B54708` | Warnings ("paid post, not saved")                              |

Dark theme (`.dark`):

| Token                  | Hex       |
| ---------------------- | --------- |
| `--background`         | `#12161C` |
| `--foreground`         | `#E6EAF0` |
| `--sidebar`            | `#0E1217` |
| `--muted`              | `#1A2029` |
| `--muted-foreground`   | `#9AA4B2` |
| `--border` / `--input` | `#2A323D` |
| `--primary`            | `#5FB39C` |
| `--primary-foreground` | `#0E1217` |
| `--accent`             | `#173129` |
| `--accent-foreground`  | `#8FD3BF` |
| `--ring`               | `#5FB39C` |
| `--destructive`        | `#F0857A` |
| `--warning`            | `#F2A65A` |

shadcn's other tokens map onto these: `--card` and `--popover` = `--background`; `--card-foreground`, `--popover-foreground` = `--foreground`; `--secondary` = `--muted`, `--secondary-foreground` = `--foreground`; `--sidebar-foreground` = `--foreground`; `--sidebar-primary` = `--primary`; `--sidebar-primary-foreground` = `--primary-foreground`; `--sidebar-accent` = `--accent`; `--sidebar-accent-foreground` = `--accent-foreground`; `--sidebar-border` = `--border`; `--sidebar-ring` = `--ring`.

### Source-type marks

Each item row shows its source type with a 3px bar on its left edge and a small icon. These colors only ever mean "source type".

| Kind        | Token                 | Light     | Dark      | lucide icon         |
| ----------- | --------------------- | --------- | --------- | ------------------- |
| Grokipedia  | `--source-grokipedia` | `#4B4FA8` | `#9FA3F0` | `BookOpen`          |
| Substack    | `--source-substack`   | `#C2610C` | `#F2A65A` | `Newspaper`         |
| X           | `--source-x`          | `#1C2533` | `#E6EAF0` | `MessageSquareText` |
| Note        | `--source-note`       | `#7A3E73` | `#D9A0D2` | `StickyNote`        |
| Image       | `--source-image`      | `#0E7490` | `#67C6DE` | `Image`             |
| YouTube     | `--source-youtube`    | `#B4235A` | `#F08AB0` | `MonitorPlay`       |
| Web page    | `--source-web`        | `#4D5B6B` | `#B4BFCC` | `Globe`             |
| Reddit      | `--source-reddit`     | `#A33B12` | `#F59E7A` | `MessagesSquare`    |
| PDF         | `--source-pdf`        | `#7A4B2A` | `#D8A887` | `FileText`          |
| Hacker News | `--source-hackernews` | `#5F6B0E` | `#C5D16A` | `ChevronsUp`        |
| Bluesky     | `--source-bluesky`    | `#1D5FD1` | `#8DB4F7` | `Cloud`             |

## Typography

Two families, loaded with `next/font/google`:

- **Schibsted Grotesk** (`--font-sans`): all interface text. Weights 400, 500, 600.
- **Source Serif 4** (`--font-serif`): source titles in item rows, the folder heading, note titles. Weights 500, 600.

Scale (desktop, rem based on 16px root):

| Role                     | Font  | Size / line height                | Weight |
| ------------------------ | ----- | --------------------------------- | ------ |
| Folder heading           | serif | 28px / 34px                       | 600    |
| Breadcrumb above heading | sans  | 13px / 18px, `--muted-foreground` | 400    |
| Dialog title             | sans  | 18px / 24px                       | 600    |
| Item title               | serif | 15px / 22px                       | 500    |
| Body / UI default        | sans  | 14px / 20px                       | 400    |
| Metadata, counts         | sans  | 13px / 18px, `--muted-foreground` | 400    |
| Small labels             | sans  | 12px / 16px                       | 500    |

Rules:

- Sentence case everywhere. Never all-caps labels, never letter-spaced eyebrows.
- Never highlight one word of a heading in a different color, weight or style.
- No monospace except for real code or tokens (the extension access token).
- Keep text lines under 80 characters (dialogs max width 560px).

## Layout

```
+------------------------+------------------------------------------------------------+
| Sourcefold             | [ Search this project        ]        [Add links] [Save to Drive  3] |
| [ AI Research       ⇅ ]|------------------------------------------------------------+
| Groups                 |  AI Research                                                |
| v Risks             12 |  Risks                                    12 sources        |
|   > Job loss         3 |  ---------------------------------------------------------  |
| > Economics          4 |  | Impact of Artificial Intelligence on the Future   Grokipedia   Oct 13 |
|                        |  | Thread by Jane Doe (@jane)                        X            Oct 12 |
| + New group            |  | The case for slower AI                            Substack     Oct 10 |
|                        |                                                             |
|------------------------|                                                             |
| (avatar) Settings      |                                                             |
+------------------------+------------------------------------------------------------+
```

- Sidebar: fixed 280px wide, `--sidebar` background, right border `--border`. App name "Sourcefold" at top in sans 15px/600. Below it, the project switcher: a full-width 36px button with the project name and a `ChevronsUpDown` icon; its menu lists projects (check on the current one), then New project, Rename project, Delete project. Then a "Groups" small label and the open project's group tree. Group tree indents 16px per level. Each folder row is 32px tall: chevron (16px, rotates when open), folder name (truncate with ellipsis), item count right-aligned in metadata style. Selected folder: `--accent` background and `--accent-foreground` text.
- Top bar: 56px tall, bottom border. Search input left (max 360px). Buttons right: "Add links" (outline), "Save to Drive" (primary, shows the unsaved count as a small number inside the button when > 0).
- Main: padding 32px horizontal, 24px top. Breadcrumb ("Project" on a project page, otherwise linked ancestor names), then folder heading, then the item count on the same baseline at the right in metadata style, then a 1px rule, then rows.
- Item rows: full width, 48px min height, no cards, no shadows. Columns: 3px source bar, title (serif, truncate to one line), source name, saved date ("Oct 13"), status icon. Separator: 1px `--border` between rows. Hover: `--muted` background. Whole row is clickable and opens the source URL in a new tab; the row menu button (three dots) appears on hover and on keyboard focus.
- Group rows (on project and group pages, above sources): same 48px row, `Folder` icon, name in the item-title style, "2 subgroups · 12 sources" in metadata style. Clicking opens the group.
- Everything is left-aligned. Numbers (counts, dates) right-aligned in their column.

## Shape and depth

- Radius: inputs and buttons 6px; dialogs, popovers and menus 10px; badges 4px; rows 0.
- Shadows only on floating layers (dialogs, popovers, menus, toasts): `0 8px 24px rgba(28, 37, 51, 0.12)`. Nothing else has a shadow.
- Borders are 1px `--border`.

## Motion

- Only motion that answers an action: dialogs fade and scale from 98% over 120ms; tree chevrons rotate over 120ms; toasts slide in from the bottom right.
- No entrance animations, no hover animations beyond background color changes.
- Wrap all motion in `motion-safe:` (respect reduced motion).

## Accessibility floor

- Visible keyboard focus on everything: 2px `--ring` outline with 2px offset.
- Every icon-only button has an `aria-label`.
- The folder tree uses `role="tree"` / `role="treeitem"` with `aria-expanded` and arrow-key navigation.
- Color is never the only signal: source marks always pair with the source name text; statuses pair with an icon and a tooltip.

## Writing

- Name things by what the user does: "Add links", "Save to Drive", "New project", "New group", "New subgroup", "Rename", "Move to...", "Delete".
- An action keeps its name in its result: button "Save to Drive" gives the toast "Saved to Drive".
- Errors say what happened and what to do: "Couldn't reach Grokipedia. Check the link and try again." Never apologize, never be vague.
- Empty states invite action:
  - No projects: "Create your first project to start collecting sources." with a "New project" button.
  - Project without groups: "This project has no groups yet. Create a group, for example “Engines”, then add links to it."
  - Empty folder: "Nothing here yet. Add Grokipedia links, or save a page with the Sourcefold extension."
  - No search results: "No titles match "<query>"."
- Statuses: "Saved", "Saving", "Failed", "Paid post, not saved", "Already saved in <group>".
