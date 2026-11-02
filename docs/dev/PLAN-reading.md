# Plan: the best reading experience

Status: planned 2026-11-02; sections 1–3 built the same day on branch `reader-experience`, waiting for the owner's test. Section 4 (Pages) is left for a later plan. "As built" at the end says what differs. Desktop app only (the website has no reader). Every UI step follows `docs/dev/DESIGN.md`; this plan names the places where the owner has to approve something the design guide doesn't allow yet.

## What the owner asked for

"The whole point of Sourcefold is to read easily." Today the reader uses only the middle of the window: on a wide screen half the sheet is empty, and it can't fit more text. The owner wants it customisable (text size and more) and wants the best reading experience there is.

## What's wrong today

From the screenshot and `features/reader/ReaderView.tsx` + `reader.css`:

1. **Fixed width.** The column is `max-w-[66ch]`, or `max-w-4xl` with the **Full width** button. That button isn't remembered, and there's nothing between the two.
2. **Fixed size.** The body is 18px serif or 16px sans. You can't change the size, line spacing or paragraph spacing.
3. **Two fonts.** Serif (Newsreader) or Sans (Geist), and nothing else.
4. **Wasted margins.** On a 1600–2000px window, 600px or more on each side is empty. A Grokipedia article is often 50,000 words with dozens of sections, and there is no table of contents to use that space.
5. **Footnotes only at the end.** In Grokipedia and Wikipedia articles, a `[76]` reference sends you to the bottom and you lose your place.
6. **No sense of place.** There's no progress, no time left, and nothing remembers where you stopped in a long article.
7. **Chrome is always there.** The 52px toolbar and its 10 buttons stay on screen; nothing hides it for deep reading.

## What the research says

- **One font doesn't fit everyone.** Wallace et al. (ACM TOCHI 2022, Adobe and Brown, 16 fonts, hundreds of readers): the same reader read about 35% faster in their fastest font than their slowest, with the same comprehension. The fastest font differed from person to person, and people's favourite font often wasn't their fastest. So a real font choice matters more than picking one "best" font. ([paper](https://jeffhuang.com/papers/Readability_TOCHI22.pdf), [Adobe](https://research.adobe.com/publication/towards-individuated-reading-experiences-different-fonts-increase-reading-speed-for-different-individuals))
- **Line length: people prefer 45–75 characters but often read faster on longer lines.** Dyson and Haselgrove (2001) found 55 characters per line fastest. Shaikh and Chaparro (2005) found 95 fastest, with no difference in comprehension, and readers split between liking short and liking long lines. The evidence is mixed, so width should be the reader's choice, with a sensible default (about 70 characters). ([summary](https://www.blog.theteamw.com/2009/10/26/100-things-you-should-know-about-people-2-line-length/), [Shaikh and Chaparro](https://journals.sagepub.com/doi/10.1177/154193120304701112))
- **Width should be in characters, not pixels.** Then making the text bigger keeps the same number of words on a line instead of wrapping more. Readwise Reader has a line-width setting with `Shift+,` / `Shift+.` keys ([docs](https://docs.readwise.io/reader/docs/faqs/appearance)); Readest and Kobo offer line height (about 1.2–2.5, default 1.6), justification and hyphenation ([Readest](https://readest.com/docs/customization)).
- **The engines support good wrapping.** `text-wrap: pretty` (fewer one-word last lines) is in Chromium 117+ (WebView2 on Windows) and Safari 26 (WKWebView on macOS). `hyphens: auto` needs a `lang` attribute on the text. ([MDN hyphens](https://developer.mozilla.org/en/docs/Web/CSS/hyphens), [text-wrap](https://modern-css.com/reference/properties/text-wrap-style/))
- **Filling a wide screen with more text.** Long lines past ~100 characters get hard to follow, and newspaper-style columns don't work with vertical scrolling (you'd read down one column, then scroll back up). So there are two good ways to use the space: put useful things beside the text (contents on the left, footnotes on the right), and, for people who want more text at once, a **Pages** mode that lays the text out as side-by-side columns and turns pages sideways, like an open book. Pages mode is the riskiest part (below).

## The design

### 1. Reading settings ("Aa")

The **Serif / Sans** toggle in the toolbar becomes one **Aa** button (key `a`). It opens a popover beside it with a live preview: the article changes as you move the controls. Everything is remembered for every source.

| Setting      | Choices                                                                          | Default       |
| ------------ | -------------------------------------------------------------------------------- | ------------- |
| Font         | Newsreader, Literata, Geist, Atkinson Hyperlegible (see Questions)               | Newsreader    |
| Text size    | 14–28px in 1px steps, `Mod+=` / `Mod+-`, `Mod+0` resets                          | 19px          |
| Line spacing | Tight 1.45, Normal 1.65, Loose 1.85                                              | Normal        |
| Width        | Slider from 50 to 120 characters, plus **Fill the sheet**; `Shift+,` / `Shift+.` | 70 characters |
| Paragraphs   | Space between, or Indented (book style)                                          | Space between |
| Alignment    | Left, or Justified (turns on hyphenation)                                        | Left          |
| Page colour  | Match the app, Paper, Sepia, Dark, Black                                         | Match the app |

- **Presets** at the top of the popover: **Comfortable** (the defaults), **Dense** (16px, Tight, 100 characters: fits the most text) and **Book** (Literata 20px, Loose, 62 characters, indented, justified). Then **Reset**.
- The settings are CSS variables on the article (`--reader-size`, `--reader-leading`, `--reader-measure`, …). `reader.css` reads them; nothing re-renders the article, so highlights, find and Remove text are untouched.
- `text-wrap: pretty` on paragraphs always; `lang` on the article (from the source's metadata, or `en`) so hyphenation works.
- The current **Full width** button goes. Width is now in Aa, and the button's place is taken by **Focus** (section 3).
- Settings → **Reading** shows the same controls for people who look there first.

### 2. Use the empty space

When the sheet is wide enough (container queries on the reader, like the rest of the app):

```
│ Contents             │   Is AI the "new electricity"?                │                       │
│  Background      ◂── │   The AI-electricity analogy is quite …       │ [12] Kelly, K. (2016) │
│  Kevin Kelly         │   … his 2016 book The Inevitable.[12] Just as │ The Inevitable. Viking│
│  General purpose     │   almost everything was "electrified", …      │                       │
│  Criticism           │                                               │ [13] Ng, A. (2017) …  │
│  References          │                                               │                       │
│  ▔▔▔▔▔ 38%, 9 min left│                                              │                       │
```

- **Contents on the left** (sheet 1100px and wider). The article's headings, indented by level; the section you're in is marked with the highlighter's soft fill (the reader is one of the places the design guide allows it). Click to jump. It also shows how far you are and the time left. `\` hides and shows it (remembered). Narrower, it becomes a **Contents** button in the toolbar that opens the same list as a popover.
- **Footnotes beside the text** (sheet 1400px and wider, and the highlights panel closed). Each reference's note sits in the right margin at the height of its `[12]`, like a printed book's sidenote. Narrower, hovering or focusing a `[12]` shows the note in a small popover, and clicking still jumps to the list at the end.
- **Wide images and tables.** Pictures and tables can be wider than the text column (up to the space between the two margins) so a narrow text column doesn't squeeze them. Tables wider than that scroll sideways inside themselves.
- The highlights panel keeps its place on the right and wins over the footnotes when both would show.

### 3. Reading flow

- **Progress.** A thin line under the toolbar fills as you read, and the toolbar shows "9 min left" (from the words after where you are).
- **Pick up where you left off.** The reader remembers the last paragraph you were on in each source (by its place in the text, so it survives a window of a different width) and opens there. A small "Back to the start" button shows for a few seconds. Opening from search or a highlight still lands on that passage instead.
- **Focus** (`Shift+F`, the button where Full width was; plain `f` is kept for the planned **Find in other sources** on a highlight). Hides the toolbar, contents and footnote margin and makes the window full screen. Moving the mouse to the top edge shows the toolbar again; `Shift+F` or `Esc` leaves. It is a button, not something that happens on scroll, because the design guide says nothing moves on scroll.

### 4. Pages (later, after an experiment)

For "fit more on the screen": the article laid out as two or three columns side by side, each at the chosen width, filling the sheet's height. `Space`, the arrow keys and the mouse wheel turn a whole page sideways. This is how Kindle and Apple Books fill a wide screen without long lines.

It is the riskiest part, because find, highlights, `j`/`k` focus, search landings and pick-up-where-you-left all scroll the article vertically today (about 10 places in `features/reader`). So it comes last, behind a **Scroll / Pages** switch in Aa, and starts with a one-day experiment on a long Grokipedia article: CSS columns on the article with `column-width` from the width setting, horizontal scrolling, and checking that a highlight, a find match and a search landing each turn to the right page. If that experiment goes badly, the plan stops at section 3 and says why.

## Questions for the owner

1. **Fonts.** Adding fonts means two new packages (`@fontsource-variable/literata`, a serif made for long reading on screens, used by Google Play Books; and Atkinson Hyperlegible Next, made for low-vision readers, very clear). Both are bundled like Newsreader, so no network is needed; the agent checks their size before adding them. OK to add both? (Recommended: yes. The research says the font choice matters more than anything else here.)
2. **Page colours.** Sepia and Black are new colours that the design guide doesn't have. They'd be added to `DESIGN.md` as reader-only tokens (Sepia: paper `#F6EFE2`, ink `#3B2F23`; Black: `#000000` with `#D6D6D6` ink, for OLED screens), checked for 4.5:1 contrast with highlights and find marks on them. OK?
3. **Pages mode.** Build the experiment after sections 1–3, or leave it out?

## Owner's answers (2026-11-02)

1. Fonts: yes, add both.
2. Page colours: yes, whatever looks best.
3. Pages mode: not now; finish sections 1–3 first and plan it later.

## How it will be built

New files in `apps/desktop/src/features/reader/`, owned one area per agent (`AGENTS.md` rules):

- `reader-prefs.ts`: the settings type, defaults, presets, limits and load/save (localStorage `sourcefold:reader:prefs`, reading the old `sourcefold:reader:typography` once). Pure, with tests.
- `ReaderSettings.tsx`: the Aa popover; `features/settings/` gets the Reading section using the same component.
- `reader.css`: sizes, spacing and width from the CSS variables; `.reader-prose-sans` goes away (the font is a variable too); paragraph indent, justified text, wide figures, page colours.
- `use-reader-outline.ts` + `ReaderContents.tsx`: headings from the rendered body (they already carry `data-sf-src`; add an `id` per heading in the rendered DOM, not in the Markdown), the current section with an `IntersectionObserver`, progress and time left.
- `ReaderSidenotes.tsx`: footnote notes placed beside their references (measured after render and after highlights and Remove text change the body), and the popover on narrow sheets.
- `use-reading-position.ts`: save and restore the last paragraph per source.
- `ReaderView.tsx`: the toolbar changes (Aa, Contents, Focus, progress line, time left) and the three-column layout with container queries.
- `features/shortcuts/registry.ts`: `a`, `\`, `Shift+F`, `Mod+=`, `Mod+-`, `Mod+0`, `Shift+,`, `Shift+.` in `READER_COMMANDS` so `?` lists them. None of these are taken in the reader today (it uses `j k h H z [ ] q b n c e o t u 0–3`).
- `docs/dev/DESIGN.md`: a "Reader" section with the settings, the margins and (if approved) the page colours.

Order: 1 (settings) and 3 (progress, position, focus) can be built at the same time by two agents; 2 (contents and footnotes) after 1, because it depends on the width settings; 4 last.

## How the owner will test it

`npm run tauri dev -w @sourcefold/desktop`, open a long Grokipedia article on a wide window:

- Press `a`: change the font, size, spacing and width and watch the article change. Close and open another source: the settings stayed. Try each preset and **Reset**. `Mod+=` / `Mod+-` / `Mod+0` and `Shift+,` / `Shift+.` work without the popover.
- The contents list is on the left; scroll and the current section follows; click a section to jump; `\` hides it. Make the window narrow: it becomes a toolbar button.
- Footnote notes sit beside their `[12]` on a wide window; narrow the window and hover a `[12]` to see the note.
- Read halfway, close, reopen: it opens where you were. The progress line and "N min left" match.
- `Shift+F`: full screen with nothing but the text; mouse to the top shows the toolbar; `Esc` leaves.
- Highlights, find (`Mod+F`), Remove text (`e`) and search landings still work with every setting, including Justified and Dense.

## As built (2026-11-02)

Built by the agent itself (it is woven into the highlights, find and Remove text code), on branch `reader-experience`.

- `reader-prefs.ts`: settings, presets, limits, load and save, and a small shared store (`useReaderPrefs`, `setReaderPrefs`) so the Aa popover, Settings → Reading and the reader agree. Tests in `__tests__/reader-prefs.test.ts`.
- `ReaderSettings.tsx`: the panel (`ReaderSettingsPanel`, also in Settings → **Reading**) and the Aa popover. The page swatches use the page classes themselves, so no colours are written in the component.
- `use-reading-flow.ts`: the outline (h1–h4 of the rendered body), the current section, progress, minutes left (230 words a minute), and the place you stopped (localStorage `sourcefold:reader:positions`, the latest 400 sources, saved half a second after scrolling stops, by the `data-sf-src` start of the first block on screen). A source opened from a highlight or a search lands there instead; a source with no saved place now opens at the top (before, `[` / `]` could keep the previous source's scroll).
- `ReaderMargins.tsx`: the contents rail and popover list, footnotes in the margin (placed beside their first reference, pushed down when they would overlap; clicking a `[12]` lights its note instead of jumping), and the hover card for references whose note isn't beside them.
- `ReaderView.tsx` / `ReaderModal.tsx`: Aa, Contents and Focus in the toolbar (Full width is gone), the progress line, "N min left", "Back to the start", the three-column layout, the keys, and the page class on the reader sheet. Focus uses Tauri's `setFullscreen` (`core:window:allow-set-fullscreen` added to the capability).
- `index.css`: `theme-light`, `theme-sepia`, `theme-black`; the `dark:` variant skips anything inside `theme-light`, so Paper and Sepia stay light in a dark app.
- **Changed from the plan:** wide images were dropped. An image wider than the text would run under the contents or the footnotes in the margins, so images keep the text's width. Tables wider than the text scroll sideways instead.
- **Not checked by the agent** (the owner tests the app): how it looks in the running app, the sidenote placement on a real Grokipedia article, full screen on macOS, and the fonts' rendering.
