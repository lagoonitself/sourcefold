# Lively mode

The owner asked (2026-11-05) for a modern, animated, "beautiful" UI with little pets, the same look and motion in the desktop app and the Chrome extension, and a choice: today's quiet look for everyday use, and a highly animated mode for people who want it.

The owner turned down a full replacement look on 2026-10-22 (navy and tangerine "card catalogue") and said the ink-and-highlighter look is better. So Lively **keeps the ink-and-highlighter tokens, fonts and layout** and changes how things move and react. Nothing about Calm (today's default) changes.

**Gate:** a clickable mockup (desktop window + extension popup, Calm/Lively, light/dark, pets) goes to the owner first. Agents start the build only after an explicit yes.

## The switch

Settings → Appearance → **Motion**: **Calm** (default) or **Lively**, plus **Pet**: Fold, Nib, Dot or None (Lively only). Stored per device (`localStorage` on the desktop, `browser.storage.local` in the extension, synced between them through the existing account settings later). It sets `data-motion="calm|lively"` and `data-pet="…"` on `<html>`. Calm is exactly today's app. `prefers-reduced-motion` always wins: Lively falls back to Calm's motion and the pet sits still.

## What Lively adds

All of it is keyed off `[data-motion="lively"]` in CSS, or `useMotionMode() === "lively"` in React, so Calm code paths stay untouched.

1. **Springs with a little overshoot** for dialogs, menus, the sidebar, toasts (`motion` springs, stiffness ~380, damping ~26) instead of Calm's eased curves.
2. **Highlighter everywhere it means "here":** the active tab's underline is a marker stroke that sweeps between tabs; hovering a row draws a thin marker underline under its title from the left; the focused row's ink bar grows from the middle.
3. **Ink press:** clicking a button or row sends a soft `marker-soft` ripple out from the pointer (transform/opacity only).
4. **Open-source morph:** a source row's tile and title fly into the reader's header (shared `layoutId`) and the article fades up behind it; closing reverses it.
5. **Group change:** the heading's stroke sweeps (as today), the old rows slide out left 8px while new ones rise in with a springy 25ms stagger.
6. **Counting numbers:** counts ("24 links", unsaved count) roll to their new value.
7. **Save celebration:** when a save finishes, a few paper scraps in the source's colour pop from the button and the pet cheers. Once per save, never on load.
8. **Empty states come alive:** the stacked cards fan out on hover and settle back.
9. **Shelf:** a newly shelved link drops into the list from the top with a bounce; pinning swings the pin in.
10. **Reader:** the progress line is a marker stroke; finishing a source gives a small marker check.

Still never: anything tied to scroll position, motion that hides content, looping decoration other than the pet's idle, animating layout properties.

## Pets

A small companion (40px) that sits at the bottom of the sidebar, beside the account row, and in the extension popup's footer. Pure SVG + CSS/`motion`, no images, inked in `--foreground` with a `--marker` accent so it matches both themes.

- **Fold**, a folded-paper bird with a highlighter beak (default).
- **Nib**, an ink drop with a pen-nib hat.
- **Dot**, a highlighter cap with eyes.

What they do: blink every few seconds; eyes follow the pointer when it's near; doze (eyes closed, small "z") after two minutes idle and wake on activity; hop and cheer when a save or shelve succeeds; look worried on an error toast; in the reader, they sit in the margin and turn a page when you reach the end. Clicking the pet makes it do a little trick (and says nothing). Users can hide it (Pet: None).

## Same look in the extension

The extension popup and options page move to the desktop's ink-and-highlighter tokens and fonts (Geist, Newsreader) in both modes, so the two feel like one product; Lively adds the same springs, ripple, save celebration and pet. The shared pieces live in a new package so they can't drift:

- `packages/ui-motion/` (new): `tokens.css` (the desktop tokens, used by both apps), `lively.css` (the Lively keyframes and rules), `pets/` (React SVG components + their state machine), `use-motion-mode.ts`, `ripple.ts`, `celebrate.ts`, `CountUp.tsx`.

## Work split (after the owner's yes)

| Agent (Haiku 5.5) | Owns |
| --- | --- |
| 1. Shared motion package | `packages/ui-motion/**` (tokens, lively.css, hooks, ripple, celebrate, CountUp) |
| 2. Pets | `packages/ui-motion/src/pets/**` |
| 3. Desktop wiring | `apps/desktop/src/features/settings/` (Motion + Pet settings), `components/ui/*` Lively variants, `App.tsx`/`main.tsx` attributes, shell placement of the pet |
| 4. Desktop views | group view, rows, tabs, reader morph, empty states, shelf view Lively touches |
| 5. Extension | `apps/extension/**` restyle to shared tokens + Lively + pet |

Each brief makes reading `docs/dev/DESIGN.md`, this file, `design-taste-frontend`, `high-end-visual-design`, `emil-design-eng` and `web-design-guidelines` the required first step, with "keep our tokens; Calm must not change" as the hard limit. The orchestrator reviews `git diff --stat` per agent for work outside its files.
