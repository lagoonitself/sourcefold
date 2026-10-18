# Handoff: desktop app redesign (2026-10-18)

The owner asked for a complete redesign of the desktop app (Windows and macOS): responsive, beautiful, animated, with the UX reconsidered, new colours allowed. The web app and the extension are **not** part of this; don't touch `apps/web` or `apps/extension`.

The new look is "ink and highlighter". **Read `docs/dev/DESIGN.md`, section "Desktop app: ink and highlighter", before you start.** It is the authority for tokens, type, layout, motion and components.

## Already built by the orchestrator (don't rewrite these; use them)

- `apps/desktop/src/index.css`: all tokens, `.marker`, `.marker-sweep`, `.skeleton`, `.desk-grain`, `shadow-raised` / `shadow-sheet` / `shadow-float`, keyframe utilities `animate-fade-in`, `animate-pop-in`, `animate-rise-in`, `animate-shimmer`, thin scrollbars, lucide stroke 1.75.
- Fonts bundled in `main.tsx` (Geist, Geist Mono, Newsreader); `MotionConfig reducedMotion="user"`; toasts styled.
- Primitives in `src/components/ui/`: `Button` (variants `default` ink, `outline`, `ghost`, `secondary`, `destructive`, `link`, `marker`; sizes `sm`, `default`, `lg`, `icon`, `icon-sm`), `Input`, `Kbd`, `Dialog*` (animated with `motion`), `DropdownMenu*` (animated), `EmptyState`, `Logo`.
- The shell: `src/App.tsx` layout, `src/features/shell/AppSidebar.tsx`, `TopBar.tsx`, `use-sidebar.ts`; `src/features/drive/DriveSyncStatus.tsx` (now the top bar's Drive button); `Mod+B` toggles the sidebar.
- The main sheet's content area is a container named `view` (`@container/view`); use `@[560px]/view:` style variants for responsive rows and headers. The top bar is `@container/topbar`.
- `requestNewGroup()` / `NEW_GROUP_EVENT` in `src/features/items/group-actions.ts`: empty states ask the tree to open its New group dialog.

## Rules for every agent

1. **Only edit the files your package lists.** Several agents work in this checkout at once. If you need a change elsewhere, finish what you can and report it.
2. **Keep every behaviour.** This is a visual and interaction redesign, not a refactor. Don't remove or rename exported functions, props, keyboard handlers, `aria-*`/`role` attributes, `data-*` attributes, event names, test ids, or comments that explain non-obvious logic. Don't delete tests. Don't "simplify" logic you weren't asked to change. Before finishing, diff your files against `HEAD` (`git diff -- <file>`, read-only) and check nothing functional disappeared.
3. Use tokens only: no hex values, no Tailwind palette colours (`amber-*`, `emerald-*`, `gray-*`, `black/40`, `white/5` for colours of meaning). `bg-black/5`-style hovers become `hover:bg-muted` (on the sheet) or `hover:bg-sidebar-accent` (on the desk).
4. Old classes to replace when you see them: `animate-in`, `fade-in`, `zoom-in-95`, `duration-150` paired with those (there's no animation plugin; use `motion` or `animate-pop-in`/`animate-rise-in`), `rounded-[4px]`/`rounded-[6px]` on buttons (use the primitives), `text-[9px]`/`text-[10px]` hand-made `<kbd>` (use `Kbd`), `uppercase tracking-wider` labels (sentence case), "·"-joined meta strings.
5. Motion: `import { motion, AnimatePresence } from "motion/react"`. Curves `[0.32, 0.72, 0, 1]` (moves) and `[0.16, 1, 0.3, 1]` (fades). Animate only transform and opacity (height for tree/accordion expansion is fine). Nothing loops except spinners. Nothing on scroll.
6. Copy follows DESIGN.md "Writing". Keep existing user-facing wording unless it breaks those rules (all-caps, vague errors, "Oops", exclamation marks, "items" where the UI says "sources").
7. No new dependencies (`motion` is already installed). No `@ts-ignore`, no disabled checks.
8. Don't run `git commit`, `push`, `reset`, `checkout`, `stash`.
9. Before reporting done, from the repo root run `npx prettier --write <your files>`, `npm run typecheck -w @sourcefold/desktop` and `npm test -w @sourcefold/desktop`. Errors in files you don't own may come from another agent working at the same time; mention them, don't fix them.
10. Final report: files changed, what you changed (per file, short), commands run and their results, anything left unfinished, questions.

## Packages

### A. Sidebar tree and project switcher

Files: `src/features/folders/FolderTree.tsx`, `src/features/projects/ProjectSwitcher.tsx`.

- Tree rows per DESIGN.md "Sidebar rows". The open group: a pill (`bg-sidebar-accent shadow-raised`) that slides between rows with `motion`'s `layoutId` (one `LayoutGroup`/`layoutId="sidebar-active-group"`), and the name wrapped in `.marker`. Keyboard-focused row (tree region focused): `bg-sidebar-accent` plus a 2px ink bar on the left, distinct from the open group.
- Chevron rotates (200ms spring curve); children expand/collapse by animating height + opacity with `AnimatePresence` (respect reduced motion through `MotionConfig`, already global).
- The "Groups" heading: sentence case "Groups", 12px/500 muted, with the + button (icon-sm ghost, `aria-label="New group"`). Drop the pulsing dot or replace it with a static 6px ink dot when the tree has keyboard focus.
- Drag-and-drop indicators (the insert lines and nest target) use ink (`bg-foreground`) and the nest target gets `bg-marker-soft`; keep the dnd-kit logic exactly as it is.
- Inline rename input: the `Input` look at 26px height.
- Row menu (three dots) appears on hover/focus; items use `DropdownMenuItem` with icon left and `Kbd` right.
- Bottom "New group" button: a full-width ghost row with `FolderPlus`, label and `Kbd` "n", on the desk.
- Empty tree: "No groups yet." plus a "New group" button.
- Listen for `NEW_GROUP_EVENT` (`window`) and open the New group dialog (same as pressing `n`).
- Dialogs inside (New group, delete confirm, …): primitives, Newsreader titles, footer actions right, main action last.
- ProjectSwitcher: the trigger is a 40px full-width button on the desk: a 24px ink tile with the project's first letter (Newsreader 13px, paper colour), the name (500), a muted line "N groups" if that count is easy to get from props (it is: `projects`/folders), `ChevronsUpDown` right. Hover `bg-sidebar-accent`, open state `bg-sidebar-accent shadow-raised`. The menu: 12px radius popover, a filter field at the top if there are more than 6 projects (only if it already exists; don't add new logic otherwise), project rows with tile and check on the current one, Archived section in muted, then New project / Rename / Archive / Delete with icons and their keys. Keep all dialogs, archive and delete behaviour.

### B. Group view

Files: `src/features/items/GroupHeader.tsx`, `src/features/items/ItemList.tsx`, `src/features/items/source-kinds.tsx`, `src/features/items/AddImageButton.tsx`.

- GroupHeader: the breadcrumb moved to the top bar, so remove it from the header (keep `ancestorsOf` only if still used; keep the `onSelectGroup` prop). Heading: Newsreader 40/44 (30/36 below 560px view width) weight 500, tracking -0.02em, inside a `<span className="marker marker-sweep" key={folderId}>` so the stroke sweeps in each time a group opens. Under it a row: counts in muted ("2 subgroups, 6 sources"; no "·") on the left, actions on the right: New subgroup, Add image, New note as `outline` `sm` buttons with `Kbd`; below 640px view width they collapse into one `ghost` icon button (`MoreHorizontal`, `aria-label="Group actions"`) opening a `DropdownMenu` with the same three actions and keys. AddImageButton must still own its file picker and `i` shortcut, so give it a way to render as a menu item or keep it outside the menu; your call, but `i` must keep working.
- Tabs (Sources N / Highlights N): 40px, 13.5px/500, count in a `bg-muted` 6px-radius chip; the active tab's 2px ink underline slides between tabs with `layoutId="group-tab-underline"`. Keep `role="tablist"` etc.
- SubgroupList: rows per DESIGN.md "Rows": a folder tile (`bg-muted` tile, `Folder` icon in ink), name in Newsreader 16px, "2 subgroups, 12 sources" muted on the right. A small "Subgroups" label (12px/500 muted) above.
- ItemList rows per DESIGN.md "Rows": source tile (add a helper to `source-kinds.tsx`, e.g. `SourceTile({ kind, className })`, that renders the tinted tile with the icon; keep `barClass` and `colorVar` exported for other files), title in Newsreader 16/22 weight 500, an optional second line in muted 12px only with real data from `item.meta` (look at what the extractors store: author, channel, site name, duration, published; show at most two pieces joined by ", "; if there's nothing, no second line), then source name, date, status icon, row menu. Focused row: `bg-accent` + 2px ink bar on the left (absolute, rounded). Ticked: `bg-marker-soft`. Hover: `bg-muted`. Note indicator stays.
- Rows rise in on mount with a 20ms stagger for the first 12 rows (`motion.div` `initial={{opacity:0,y:6}}`); rows after 12 appear without delay. ItemList is re-keyed per group in `App.tsx`, so this only plays when a group opens or a row is added.
- Responsive with `@container/view` variants: below 560px hide the source-name column, below 440px hide the date.
- The toolbar above rows (select mode, count, Copy links / Move / Delete, Copy all links): a 44px bar; in select mode it becomes a floating action bar pinned to the bottom centre of the list (`shadow-float`, radius 12px, `bg-popover`, rises in) with the count ("3 selected") and the actions; outside select mode keep Select and Copy all links as `ghost sm` buttons on the right of the tab row's line or the toolbar (your call, keep their keys).
- Empty group: `EmptyState` (icon `Inbox` or `FileStack`), title "Nothing here yet", description "Add Grokipedia, YouTube, Substack or any other links, or save a page with the Sourcefold extension.", action ink "Add links" with `Kbd` A. It can't open Add links itself (App owns that dialog), so dispatch the same thing the `a` key does: check how `useKeyboardShortcuts` handles `a`; if there's no event, render the hint text "Press A to add links." instead of a button and report it.
- Rename inline input, delete confirm dialog, move dialog trigger: keep all logic, restyle with primitives.
- StatusIcon: keep the API; use `text-success` for saved (a `CheckCircle2`-like quiet check in muted is fine too; your call), `text-warning`, `text-destructive`.

### C. Reader

Files: `src/features/reader/ReaderModal.tsx`, `ReaderView.tsx`, `reader.css`, `HighlightsPanel.tsx`, `HighlightMenu.tsx`, `NoteEditor.tsx`.

Highlights are anchored by text offsets in the rendered body (see HANDOFF "Highlights"), so **don't change the DOM structure or text content the body renders** (`render-markdown.ts`, `blocks.ts`, anchoring files are off limits; only styles and the chrome around the body).

- The reader opens as a full-window sheet over the app: the desk shows as an 8px frame (like the main sheet), and the sheet rises in (y 16px → 0, opacity, 320ms spring). Close reverses quickly (motion `AnimatePresence` in ReaderModal; the open/close API stays the same).
- Toolbar (52px, drag region on macOS: `data-tauri-drag-region`, and 78px left padding under `.platform-mac` since the traffic lights sit there): close (X, `Esc`), the source tile and source name, "3 of 24" with prev/next buttons (`[`/`]`), then right: find, highlighter toggle, typography (if it exists), panel toggle, Open original. Icon buttons `ghost icon` with `aria-label` and `title` with key.
- Body: Newsreader for text, measure 66ch, 18px/1.65 default (keep the existing typography settings if any), headings Newsreader 500 with tight tracking, links ink with a `--border-strong` underline that turns ink on hover, blockquotes with a 2px `--border-strong` left rule, code in Geist Mono on `bg-muted`, images radius 10px, footnotes small, tables with hairlines. Title block: source tile + source name + date in muted, then the title in Newsreader 40/46 weight 500.
- Highlights render as `--marker-soft` with a slightly stronger bottom edge (like a real highlighter; in dark mode `--marker-soft` with light text); the focused paragraph bar (j/k) is a 2px ink bar in the left margin; find matches use `--marker` and the current match `--marker-strong` with `--marker-strong-foreground` text.
- HighlightMenu: a small floating `bg-popover shadow-float` 12px-radius bar that pops in (`animate-pop-in`), buttons with icons + `Kbd` hints (c, n, …), "Cited:" chips as 6px-radius `bg-muted` chips.
- HighlightsPanel: a right side panel (320px, the desk colour, slides in from the right with motion), tabs "Highlights" / "Cited sources" with the sliding underline (`layoutId="reader-panel-tab"`), rows per DESIGN.md "Rows", `EmptyState compact` when empty. On a sheet narrower than 900px the panel overlays the body (absolute, `shadow-float`) instead of pushing it.
- Find bar: a floating pill under the toolbar, right-aligned: input, "3 of 17", up/down, close.
- Loading: `.skeleton` lines shaped like a title and paragraphs. Error: `EmptyState compact` with the error and a Retry button.

### D. Search and command palette

Files: `src/features/search/SearchDialog.tsx`, `src/features/command-palette/CommandPalette.tsx`.

- Both are "spotlight" dialogs: 640px wide (max `calc(100vw - 32px)`), placed at 14vh from the top (not centred), radius 16px, `shadow-float`, rise in. Use the `Dialog` primitive if it fits (pass a className for position; if it can't place the box at the top, wrap your own `motion` panel but reuse `registerModalLayer`/the Esc stack exactly as the files do now).
- Input row: 52px, `Search` icon, 16px text, no border, a hairline under it; the scope chip ("This project" / "All projects", Tab switches) as a `bg-muted` 7px-radius chip on the right with `Kbd` Tab.
- Results: grouped with small sentence-case labels (12px/500 muted): "Sources", "Passages", "Highlights and notes", "Groups", "Commands"… Rows 44–52px radius 10px: tile (source tile, or a muted tile with the command/folder icon), title (Newsreader 15px for sources, Geist 13.5px for commands), muted second line (group name, heading, project), right side `Kbd` for commands. Matched words in snippets are bold ink on `--marker-soft` (`<mark>` styled, keep the snippet logic). Active row `bg-accent` with the ink bar; the active highlight can slide with `layoutId` if cheap, otherwise plain.
- Footer: 36px, muted 12px, "↑↓ to move, Enter to open, Esc to close", plus the index status ("Searching 128 sources" / "Indexing 40 of 128 sources") on the right.
- Empty and no-results: `EmptyState compact` ("No titles match “turbo”." per DESIGN.md writing rules).

### E. First run and Add links

Files: `src/features/auth/WelcomeScreen.tsx`, `src/features/auth/AuthProvider.tsx` (only its UI parts), `src/features/grokipedia/AddLinksDialog.tsx`.

- WelcomeScreen is the first thing a new user sees; make it the most considered screen. The desk with grain fills the window (`h-dvh`, drag region at the top for macOS). Centre-left composition: the `Logo` at 40px, then a Newsreader headline (44/48, weight 500) such as "Collect sources for your next video" with the stroke (`.marker marker-sweep`) behind one whole line only if it reads naturally (don't highlight a single word), a one-sentence description, then two choices as large selectable cards on the sheet colour (radius 14px, `shadow-raised`, hover lifts the shadow only): "Use my Sourcefold account" (web address field, Sign in with browser; keep all existing logic and states) and "Keep everything on this computer" (offline). On the right (hidden below 900px window width) a small still composition of three fake source rows with tiles (YouTube, Grokipedia, Substack) stacked like cards, slightly rotated (-2deg, 1deg, 3deg), purely decorative (`aria-hidden`). One orchestrated entrance: headline, text, cards rise in with a 60ms stagger. Keep every state (waiting for browser, errors, retry) and every handler.
- AuthProvider's loading/error UI (if any): a centred `Logo` with a subtle shimmer bar, or an `EmptyState` for errors.
- AddLinksDialog: 640px. Header: Newsreader title "Add links", description with the target group, the group picker as a compact select-like button. The textarea: 160px min, Geist Mono is **not** used; Geist 13.5px, the `Input` look. Below it, a live count "12 links: 6 YouTube, 4 Grokipedia, 2 Substack" in muted with small tiles, if the parsing already exists (don't add new parsing). Rows of progress per link: tile, title or URL (truncate), status on the right with icon + text ("Waiting", "Saving", "Saved", "Already saved in Engines", "Paused 0:42", "Not saved: No captions on this video"); a thin ink progress bar at the top of the list showing done/total (animate width with transform `scaleX`). Keep every status, the YouTube pacing, Stop/Retry, Substack date filters and all logic exactly.

### F. Settings and small dialogs (labour package)

Files: `src/features/settings/SettingsDialog.tsx`, `src/features/search/SearchSettings.tsx`, `src/features/local-copy/LocalCopySettings.tsx`, `src/features/substack/SubstackCookieSettings.tsx`, `src/features/shortcuts/KeyboardShortcutsDialog.tsx`, `src/features/items/NoteDialog.tsx`, `src/features/items/MoveItemDialog.tsx`.

- SettingsDialog: 760px wide, 560px tall (max `calc(100dvh - 32px)`), padding 0. Two panes: a left nav (200px, `bg-desk`… use `bg-muted/60`, radius 16px on the left side) with the section names as 32px rows with icons (General, Account, Search, Substack, Appearance, or whatever sections exist now; keep their content), the active row `bg-background shadow-raised`; the right pane scrolls, with the section title in Newsreader 22px and each setting as a row: label (500) + muted description on the left, control on the right, rows separated by 20px space (no divider lines). Below 640px window width the nav becomes a horizontal row of chips on top. If the dialog currently uses tabs or one long page, turn it into this layout without changing what each setting does.
- Theme choice: three small cards (Light, Dark, System) each with a tiny preview (desk + sheet + ink line, drawn with divs using fixed light/dark token values via `.dark` wrapper for the dark one), the chosen one with an ink 2px ring.
- Switches (if there are checkboxes for on/off settings): a 34×20 track, `bg-border-strong` off, `bg-primary` on, thumb `bg-background`, the thumb slides (transform). Keep the native input for accessibility (visually hidden `peer`).
- SearchSettings / LocalCopySettings / SubstackCookieSettings: fit the row layout above; progress bars thin (4px) ink on `bg-muted`; status lines muted with an icon.
- KeyboardShortcutsDialog: 720px, a search field at the top only if it exists already; groups in two columns at ≥ 720px window width (one below), group titles 12px/500 muted, rows: description left, keys right as `Kbd`s (one `Kbd` per key, joined by a thin space).
- NoteDialog, MoveItemDialog: primitives, Newsreader titles, textarea with the `Input` look (min 140px), move list rows per "Rows" with folder tiles and indent, the current folder muted with "Current".
