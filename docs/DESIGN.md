# Sourcefold design guide

Every UI task follows this file. If a brief and this file disagree, the brief wins for that task. Do not invent new colors, fonts, radii or shadows; use the tokens below.

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

| Kind       | Token                 | Light     | Dark      | lucide icon         |
| ---------- | --------------------- | --------- | --------- | ------------------- |
| Grokipedia | `--source-grokipedia` | `#4B4FA8` | `#9FA3F0` | `BookOpen`          |
| Substack   | `--source-substack`   | `#C2610C` | `#F2A65A` | `Newspaper`         |
| X          | `--source-x`          | `#1C2533` | `#E6EAF0` | `MessageSquareText` |
| Note       | `--source-note`       | `#7A3E73` | `#D9A0D2` | `StickyNote`        |
| Image      | `--source-image`      | `#0E7490` | `#67C6DE` | `Image`             |

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
| Sourcefold             | [ Search titles              ]        [Add links] [Save to Drive  3] |
|                        +------------------------------------------------------------+
| v AI Research       16 |  AI Research / Risks                                        |
|   > Risks           12 |  Risks                                    12 sources        |
|   > Economics        4 |  ---------------------------------------------------------  |
| > Space              7 |  | Impact of Artificial Intelligence on the Future   Grokipedia   Oct 13 |
|                        |  | Thread by Jane Doe (@jane)                        X            Oct 12 |
| + New folder           |  | The case for slower AI                            Substack     Oct 10 |
|                        |                                                             |
|------------------------|                                                             |
| (avatar) Settings      |                                                             |
+------------------------+------------------------------------------------------------+
```

- Sidebar: fixed 280px wide, `--sidebar` background, right border `--border`. App name "Sourcefold" at top in sans 15px/600. Folder tree indents 16px per level. Each folder row is 32px tall: chevron (16px, rotates when open), folder name (truncate with ellipsis), item count right-aligned in metadata style. Selected folder: `--accent` background and `--accent-foreground` text.
- Top bar: 56px tall, bottom border. Search input left (max 360px). Buttons right: "Add links" (outline), "Save to Drive" (primary, shows the unsaved count as a small number inside the button when > 0).
- Main: padding 32px horizontal, 24px top. Breadcrumb, then folder heading, then the item count on the same baseline at the right in metadata style, then a 1px rule, then rows.
- Item rows: full width, 48px min height, no cards, no shadows. Columns: 3px source bar, title (serif, truncate to one line), source name, saved date ("Oct 13"), status icon. Separator: 1px `--border` between rows. Hover: `--muted` background. Whole row is clickable and opens the source URL in a new tab; the row menu button (three dots) appears on hover and on keyboard focus.
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

- Name things by what the user does: "Add links", "Save to Drive", "New folder", "Rename", "Move to...", "Delete".
- An action keeps its name in its result: button "Save to Drive" gives the toast "Saved to Drive".
- Errors say what happened and what to do: "Couldn't reach Grokipedia. Check the link and try again." Never apologize, never be vague.
- Empty states invite action:
  - No folders: "Create your first folder to start collecting sources." with a "New folder" button.
  - Empty folder: "Nothing here yet. Add Grokipedia links, or save a page with the Sourcefold extension."
  - No search results: "No titles match "<query>"."
- Statuses: "Saved", "Saving", "Failed", "Paid post, not saved", "Already saved in <folder>".
