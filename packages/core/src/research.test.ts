import { describe, expect, it } from "vitest";
import {
  buildBrollList,
  buildReferenceList,
  buildScript,
  cardProblem,
  effectiveAuthorType,
  findDuplicateSets,
  guessAuthorType,
  normalizeTags,
  orderBrollClips,
  parseClipTime,
  positionBetween,
  scriptSourceFromItem,
  sourceAuthor,
  titleKey,
  type Card,
  type CardInput,
  type OutlineSection,
  type SourceDirectory,
} from "./research";

const T = "2026-10-19T10:00:00.000Z";

function card(over: Partial<Card>): Card {
  return {
    id: "c1",
    project_id: "p",
    kind: "quote",
    item_id: "yt",
    highlight_id: null,
    quote: "The exhaust spins a turbine.",
    seconds: null,
    end_seconds: null,
    url: null,
    note: null,
    script_line: null,
    section_id: null,
    position: 1,
    created_at: T,
    updated_at: T,
    ...over,
  };
}

function section(id: string, title: string, position: number): OutlineSection {
  return { id, project_id: "p", title, position, created_at: T, updated_at: T };
}

const sources: SourceDirectory = {
  yt: scriptSourceFromItem({
    id: "yt",
    kind: "youtube",
    title: "How turbos work",
    source_url: "https://www.youtube.com/watch?v=abcDEF12345",
    meta: { channel: "Engineering Explained" },
  }),
  web: scriptSourceFromItem({
    id: "web",
    kind: "web",
    title: "Turbo lag explained",
    source_url: "https://www.example.com/turbo",
    meta: { site: "Example" },
  }),
};

describe("tags", () => {
  it("trims, collapses and drops repeats ignoring case", () => {
    expect(normalizeTags(["  Intro ", "intro", "Compute   costs", "", "Ending"])).toEqual([
      "Intro",
      "Compute costs",
      "Ending",
    ]);
  });
});

describe("authors", () => {
  it("uses the author set by the user first, then the captured byline", () => {
    expect(sourceAuthor({ kind: "web", title: "x", author: "METR", meta: { author: "A" } })).toBe(
      "METR",
    );
    expect(sourceAuthor({ kind: "youtube", title: "x", meta: { channel: "Dwarkesh" } })).toBe(
      "Dwarkesh",
    );
    expect(sourceAuthor({ kind: "reddit", title: "x", meta: { subreddit: "singularity" } })).toBe(
      "r/singularity",
    );
    expect(sourceAuthor({ kind: "web", title: "x", meta: {} })).toBeNull();
  });

  it("guesses the type from the kind and the address", () => {
    const g = (kind: string, url: string, meta = {}) =>
      guessAuthorType({ kind, title: "t", source_url: url, meta });
    expect(g("wikipedia", "https://en.wikipedia.org/wiki/X")).toBe("encyclopedia");
    expect(g("reddit", "https://www.reddit.com/r/a/comments/1")).toBe("forum");
    expect(g("web", "https://knowyourmeme.com/memes/x")).toBe("forum");
    expect(g("web", "https://deepmind.google/discover/blog/x")).toBe("lab");
    expect(g("pdf", "https://epoch.ai/files/report.pdf")).toBe("lab");
    expect(g("web", "https://www.axios.com/2026/01/01/x")).toBe("journalist");
    expect(g("web", "https://www.nist.gov/x")).toBe("government");
    expect(g("web", "https://cs.stanford.edu/x")).toBe("researcher");
    expect(g("pdf", "https://arxiv.org/pdf/2401.01234", { arxiv: "2401.01234" })).toBe(
      "researcher",
    );
    expect(g("web", "https://some-blog.example/x")).toBeNull();
    expect(g("x", "https://x.com/a/status/1")).toBeNull();
  });

  it("marks a guess as a guess", () => {
    expect(effectiveAuthorType({ kind: "wikipedia", title: "t" })).toEqual({
      type: "encyclopedia",
      guessed: true,
    });
    expect(effectiveAuthorType({ kind: "wikipedia", title: "t", author_type: "other" })).toEqual({
      type: "other",
      guessed: false,
    });
  });

  it("puts an author set by the user into the byline", () => {
    const s = scriptSourceFromItem({
      id: "a",
      kind: "web",
      title: "Report",
      source_url: "https://example.com/r",
      author: "Epoch AI",
      meta: { author: "Staff", site: "Example" },
    });
    expect(s.byline).toEqual(["Epoch AI", "Example"]);
    const g = scriptSourceFromItem({
      id: "g",
      kind: "grokipedia",
      title: "AI",
      author: "xAI",
    });
    expect(g.byline).toEqual(["xAI", "Grokipedia"]);
  });
});

describe("cards", () => {
  const base: CardInput = {
    id: "c",
    project_id: "p",
    kind: "quote",
    item_id: "i",
    highlight_id: null,
    quote: "Q",
    seconds: null,
    end_seconds: null,
    url: null,
    note: null,
    script_line: null,
    section_id: null,
    position: 0,
  };

  it("accepts good cards and names the problem with bad ones", () => {
    expect(cardProblem(base)).toBeNull();
    expect(cardProblem({ ...base, item_id: null })).toBe("A quote card needs its source.");
    expect(
      cardProblem({ ...base, kind: "broll", item_id: null, url: "https://youtu.be/x" }),
    ).toBeNull();
    expect(cardProblem({ ...base, kind: "broll", item_id: null })).toBe(
      "A b-roll clip needs a saved video or a link.",
    );
    expect(
      cardProblem({ ...base, kind: "line", item_id: null, quote: "", script_line: "Hello" }),
    ).toBeNull();
    expect(cardProblem({ ...base, seconds: 10, end_seconds: 5, kind: "broll" })).toBe(
      "A clip ends after it starts.",
    );
    expect(cardProblem({ ...base, seconds: 1.5 })).toBe("Times are whole seconds.");
  });

  it("reads clip times", () => {
    expect(parseClipTime("1:05")).toBe(65);
    expect(parseClipTime("1:02:05")).toBe(3725);
    expect(parseClipTime("65")).toBe(65);
    expect(parseClipTime("1m5s")).toBe(65);
    expect(parseClipTime("1:75")).toBeNull();
    expect(parseClipTime("soon")).toBeNull();
  });

  it("picks positions between neighbours", () => {
    expect(positionBetween(null, null)).toBe(1);
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(null, 1)).toBe(0);
    expect(positionBetween(3, null)).toBe(4);
  });
});

describe("script", () => {
  it("lays out sections, citations and references", () => {
    const sections = [section("s2", "Ending", 2), section("s1", "Intro", 1)];
    const cards = [
      card({ id: "a", section_id: "s1", position: 1, seconds: 192 }),
      card({ id: "b", section_id: "s1", position: 2, item_id: "web", script_line: "Lag hurt." }),
      card({
        id: "c",
        section_id: "s1",
        position: 3,
        kind: "line",
        item_id: null,
        quote: "",
        script_line: "So what changed?",
      }),
      card({
        id: "d",
        section_id: "s2",
        position: 1,
        kind: "broll",
        quote: "Turbo spooling up",
        seconds: 65,
        end_seconds: 80,
      }),
      card({ id: "e", section_id: null, script_line: "Not placed" }),
    ];
    const built = buildScript({ projectTitle: "Cars", sections, cards, sources });
    expect(built.markdown).toBe(
      [
        "# Cars script",
        "",
        "## Intro",
        "",
        "“The exhaust spins a turbine.” [1, 3:12]",
        "",
        "Lag hurt. [2]",
        "",
        "So what changed?",
        "",
        "## Ending",
        "",
        "*B-roll: Turbo spooling up* [1, 1:05–1:20]",
        "",
        "## References",
        "",
        "1. How turbos work, Engineering Explained, YouTube. https://www.youtube.com/watch?v=abcDEF12345",
        "2. Turbo lag explained, Example. https://www.example.com/turbo",
        "",
      ].join("\n"),
    );
    expect(built.sections.map((s) => s.lines.map((l) => l.card.id))).toEqual([
      ["a", "b", "c"],
      ["d"],
    ]);
  });

  it("builds a plain reference list", () => {
    expect(buildReferenceList([sources.web!])).toBe(
      "1. Turbo lag explained, Example. https://www.example.com/turbo\n",
    );
    expect(buildReferenceList([])).toBe("");
  });
});

describe("b-roll", () => {
  it("lists clips with timestamp links", () => {
    const sections = [section("s1", "Intro", 1)];
    const clips = orderBrollClips(
      [
        card({ id: "z", kind: "broll", quote: "Game mashup", url: "https://youtu.be/QQQ?t=3" }),
        card({
          id: "y",
          kind: "broll",
          quote: "Turbo spooling up",
          seconds: 65,
          end_seconds: 80,
          note: "Muted",
          section_id: "s1",
        }),
        card({ id: "x", kind: "quote" }),
      ].map((c) => (c.id === "z" ? { ...c, item_id: null, seconds: 30 } : c)),
      sections,
    );
    expect(clips.map((c) => c.id)).toEqual(["y", "z"]);
    expect(buildBrollList("Cars", clips, sources)).toBe(
      [
        "# B-roll: Cars",
        "",
        "1. Turbo spooling up. How turbos work, Engineering Explained, YouTube, [1:05–1:20](https://youtu.be/abcDEF12345?t=65). Note: Muted",
        "2. Game mashup. youtu.be, [0:30](https://youtu.be/QQQ?t=30).",
        "",
      ].join("\n"),
    );
  });
});

describe("duplicates", () => {
  const item = (id: string, over: Record<string, unknown>) => ({
    id,
    kind: "web",
    title: `Title ${id} long enough here`,
    source_url: null as string | null,
    canonical_url: null as string | null,
    meta: {},
    created_at: `2026-10-0${id.length}T00:00:00Z`,
    ...over,
  });

  it("joins the same link, video, paper and title, and leaves notes alone", () => {
    const sets = findDuplicateSets([
      item("a", { source_url: "https://www.metr.org/chart/" }),
      item("bb", { source_url: "https://metr.org/chart" }),
      item("c", { kind: "youtube", source_url: "https://youtu.be/abcDEF12345" }),
      item("dd", {
        kind: "youtube",
        source_url: "https://www.youtube.com/watch?v=abcDEF12345&t=5",
      }),
      item("e", { kind: "pdf", source_url: "https://arxiv.org/pdf/2401.01234v2" }),
      item("ff", {
        kind: "pdf",
        source_url: "https://example.com/x.pdf",
        meta: { arxiv: "2401.01234" },
      }),
      item("g", { title: "Epoch AI: Can AI scaling continue through 2030?" }),
      item("hh", { kind: "pdf", title: "Can AI Scaling Continue Through 2030 - Epoch AI" }),
      item("n1", { kind: "note", title: "Epoch AI: Can AI scaling continue through 2030?" }),
      item("x1", { kind: "x", title: "Thread by Jack Dorsey (@jack)" }),
      item("x22", { kind: "x", title: "Thread by Jack Dorsey (@jack)" }),
    ]);
    const byReason = Object.fromEntries(sets.map((s) => [s.reason, s.item_ids]));
    expect(byReason.same_link).toEqual(["a", "bb"]);
    expect(byReason.same_video).toEqual(["c", "dd"]);
    expect(byReason.same_paper).toEqual(["e", "ff"]);
    expect(sets).toHaveLength(3);
    // The Epoch titles differ in word order, so they aren't joined; same words in order are.
    expect(titleKey("Epoch AI: Can AI scaling continue?")).toBe(
      titleKey("epoch ai  can ai scaling continue"),
    );
  });
});
