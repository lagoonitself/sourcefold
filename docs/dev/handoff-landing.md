# Landing page: build contract

The owner asked on 2026-10-22 for a landing page for Sourcefold: **animated, fluid and interactive, mentioning every feature**. It lives in `apps/site` (Astro 7, static output, package `@sourcefold/site`). The skeleton is committed; four agents each build their own section components in parallel.

Every agent reads this file, `AGENTS.md`, `README.md` (the user-facing feature list, the source of truth for what the product does) and its own brief.

## Look

The page uses the desktop app's **ink and highlighter** look (`docs/dev/DESIGN.md`, first half): a cool grey **desk** with paper grain (the page background), white **sheets** of paper lying on it (`.sheet`, the frame of every product mock), **ink** text, and one yellow **highlighter** (`.marker`). Source types keep their own colours (tiles). The owner rejected a navy/tangerine "card catalogue" restyle; don't invent another palette.

- **Tokens and classes are in `apps/site/src/styles/global.css`.** Use only its CSS variables (`--desk`, `--background`, `--card`, `--foreground`, `--muted`, `--muted-foreground`, `--accent`, `--border`, `--border-strong`, `--marker`, `--marker-soft`, `--marker-strong`, `--success`, `--warning`, `--destructive`, `--source-*`, shadows, `--ease-spring`, `--ease-out`, fonts). No raw hex, rgb or named colours in components. `color-mix(in oklab, var(--x) N%, transparent)` is fine for tints.
- **Classes to reuse:** `.container`, `.section`, `.sheet`, `.card`, `.label`, `.display`, `.h2`, `.h3`, `.lede`, `.muted`, `.serif`, `.mono`, `.nums`, `.marker`, `.marker-sweep`, `.btn` + `.btn-ink` / `.btn-outline` / `.btn-ghost` / `.btn-sm`, `.kbd`, `.chip`, `.sr-only`.
- **Fonts:** Newsreader (`var(--font-serif)`) for headings, source titles and reading text; Geist (`var(--font-sans)`) for UI; Geist Mono only for keys, file names and Markdown/code. Already loaded.
- **Highlighter discipline:** the stroke means "this is what matters / what you marked". Use it on one or two words of each section heading (via `SectionHeader`'s `marked` prop), on highlights inside reader mocks, and on the current item in a demo. Not on buttons, not on every heading word.
- **Copy rules (DESIGN.md "Writing"):** sentence case, no all-caps, no letter-spaced eyebrows, no "→" on buttons, no "·"-joined meta strings, no exclamation marks, no marketing filler ("revolutionary", "supercharge", "seamless", "unlock", "effortless", "game-changer"). Plain, specific, second person, like the README. Name things the way the product does ("Save to Drive", "Add links", "Keep / Maybe / Cut", "Remove text").
- Light and dark themes both have to look right (`html.dark` swaps the tokens; the nav has a toggle).

## Motion and interaction

The owner wants it **animated, fluid and interactive**. Every section has at least one thing you can play with (type, click, drag, hover, toggle), and the mocks show the real product behaving, not decoration.

- Library: `motion` (vanilla, `import { animate, inView, stagger, scroll } from "motion"`), plus CSS transitions. No other animation or UI libraries; no React, no GSAP, no canvas/WebGL.
- Shared helpers in `apps/site/src/lib/reveal.ts` (already called once by the layout; don't call `initReveals` again):
  - `data-reveal` on an element: it rises in on scroll. `data-reveal="stagger"` on a parent: its direct children rise in one after another.
  - `.marker-sweep` with `.marker`: the stroke draws in from the left when scrolled into view.
  - `whileVisible(el, start)`: run a looping demo only while it's on screen; `start` may return a stop function. Use it for every auto-playing loop.
  - `sleep(ms)`, `prefersReducedMotion()`.
- Curves: `var(--ease-spring)` for things that move, `var(--ease-out)` for fades (in JS: `[0.16, 1, 0.3, 1]` and `[0.32, 0.72, 0, 1]`). Never `linear` (except progress bars/caret blink) or plain `ease-in-out`.
- Animate `transform`, `opacity`, `clip-path`, `background-size`, and `height` only for small expanding panels. No layout-thrashing loops, no animating `filter: blur` on large areas, no scroll-jacking, no pinned sections that trap scroll.
- `prefers-reduced-motion: reduce`: loops stop on their final state, things appear without travel. global.css already shortens CSS transitions; in JS check `prefersReducedMotion()`.
- Auto-playing demos stop or pause the moment the user interacts with them, and never fight the user's input.

## Files and ownership

```
apps/site/
  src/styles/global.css          orchestrator (read only for agents)
  src/lib/reveal.ts, site.ts, sources.ts   orchestrator (read only)
  src/layouts/Base.astro          orchestrator
  src/components/Nav.astro, Logo.astro, SourceTile.astro, SectionHeader.astro, GithubIcon.astro   orchestrator (read only)
  src/pages/index.astro           orchestrator (section order)
  src/components/sections/*.astro one owner each (below)
  src/components/<owner-prefix>/  helper components a section owner needs, in its own folder
```

| Agent | Owns                                                                                                                           | Helper folder              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| A     | `sections/Hero.astro`, `sections/Sources.astro`                                                                                | `src/components/hero/`     |
| B     | `sections/Capture.astro`, `sections/Reader.astro`                                                                              | `src/components/reader/`   |
| C     | `sections/Search.astro`, `sections/Organize.astro`, `sections/Research.astro`                                                  | `src/components/research/` |
| D     | `sections/Claude.astro`, `sections/Files.astro`, `sections/Apps.astro`, `sections/OpenSource.astro`, `sections/Download.astro` | `src/components/finish/`   |

- Each section is `<section id="<id>" class="section">` with the id already in its placeholder (Hero's is `top`, with less top padding since the nav sits above it). Keep the ids: the nav links to them.
- Open each section with `SectionHeader` (Hero excepted).
- Source icons: `SourceTile` (`kind` from `src/lib/sources.ts`), always with the source's name in text nearby. Other icons: `@lucide/astro` (named imports like `import { Search } from "@lucide/astro"`, `stroke-width={1.75}`). Lucide has no brand logos; use `GithubIcon` for GitHub and words for the rest.
- Data: use `SOURCES`, `sourceByKind` and `links` instead of retyping them.
- Scripts: a `<script>` in the `.astro` file (Astro bundles it as a module). Query only inside your own section root (`document.querySelector("#read")`), so sections never touch each other. Styles: `<style>` in the component (scoped). No `is:global` except for `:global(html.dark)` selectors.
- Responsive: looks right from 360px to 1600px wide. Mocks scale down or simplify on phones; nothing scrolls sideways (`overflow-x` hidden on wide mocks, or stack them). Touch works for every interaction (pointer events, not mouse-only).
- Accessibility: real buttons and inputs, visible focus, `aria-label` on icon-only buttons, decorative animated mocks get `aria-hidden="true"` with the same facts in visible text nearby, contrast at least 4.5:1.
- No images from the network and no new files in `public/` unless your brief says so. Mocks are built in HTML/CSS.

## Checks

From `apps/site`: `npx astro check` (0 errors, 0 warnings) and `npm run build`. From the repo root: `npx prettier --check apps/site` (run `npx prettier --write` on your own files). Don't run the root `npm test`; it doesn't cover this package.
