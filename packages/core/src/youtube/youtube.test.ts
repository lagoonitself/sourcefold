import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SourceError, type SourceFetch, type SourceFetchRequest } from "../source-fetch";
import { extractJsonAfter, fetchYouTubeCapture, YOUTUBE_NO_CAPTIONS_REASON } from "./fetch";
import { formatTimestamp, transcriptParagraphs, youTubeBodyMarkdown } from "./markdown";
import { cleanCaptionText, parseTimedText, type CaptionSegment } from "./timedtext";
import { chooseCaptionTrack, timedTextUrl, type CaptionTrack } from "./tracks";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf-8");

describe("parseTimedText", () => {
  it("reads the default form and decodes doubly escaped entities", () => {
    const segments = parseTimedText(fixture("timedtext-manual.xml"));
    expect(segments).toHaveLength(40);
    expect(segments[0]).toEqual({ start: 4.22, duration: 1.18, text: "This is a 3." });
    expect(segments[1]!.text).toBe(
      "It's sloppily written and rendered at an extremely low resolution of 28x28 pixels,",
    );
  });

  it("reads srv3 with word spans and skips empty paragraphs", () => {
    const segments = parseTimedText(fixture("timedtext-asr-srv3.xml"));
    expect(segments[0]).toEqual({ start: 0, duration: 2.51, text: "[Music]" });
    expect(segments[1]).toEqual({
      start: 4.4,
      duration: 4.159,
      text: "This is a three. It's sloppily written",
    });
    expect(segments.every((segment) => segment.text.length > 0)).toBe(true);
  });

  it("strips tags and collapses whitespace", () => {
    expect(cleanCaptionText('<font color="#fff">Hello\n  there</font> &amp;amp; you')).toBe(
      "Hello there & you",
    );
    expect(cleanCaptionText("caf&#xe9; &quot;ok&quot;")).toBe('café "ok"');
  });
});

describe("chooseCaptionTrack", () => {
  const track = (languageCode: string, kind?: string): CaptionTrack => ({
    baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}${kind ? "&kind=asr" : ""}`,
    languageCode,
    ...(kind ? { kind } : {}),
  });

  it("prefers written captions in the spoken language", () => {
    const tracks = [track("fr"), track("en-GB"), track("en", "asr")];
    expect(chooseCaptionTrack(tracks)?.languageCode).toBe("en-GB");
    const exact = [track("fr"), track("en-GB"), track("en"), track("en", "asr")];
    expect(chooseCaptionTrack(exact)).toBe(exact[2]);
  });

  it("falls back to the auto-generated track", () => {
    expect(chooseCaptionTrack([track("de"), track("ko", "asr")])?.kind).toBe("asr");
  });

  it("without auto captions takes YouTube's default, then English, then the first", () => {
    const tracks = [track("ja"), track("es"), track("en")];
    expect(chooseCaptionTrack(tracks, 1)?.languageCode).toBe("es");
    expect(chooseCaptionTrack(tracks)?.languageCode).toBe("en");
    expect(chooseCaptionTrack([track("ja"), track("es")])?.languageCode).toBe("ja");
    expect(chooseCaptionTrack([])).toBeNull();
  });

  it("asks for the default XML form", () => {
    expect(
      timedTextUrl({ baseUrl: "https://x/api/timedtext?v=1&fmt=srv3&lang=en", languageCode: "en" }),
    ).toBe("https://x/api/timedtext?v=1&lang=en");
    expect(
      timedTextUrl({ baseUrl: "https://x/api/timedtext?fmt=srv3&v=1", languageCode: "en" }),
    ).toBe("https://x/api/timedtext?v=1");
  });
});

describe("transcript Markdown", () => {
  it("formats timestamps", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(62.9)).toBe("1:02");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("breaks paragraphs after a sentence past 45 s, and always by 90 s", () => {
    const sentences: CaptionSegment[] = [0, 20, 40, 50, 60].map((start) => ({
      start,
      duration: 10,
      text: `Sentence at ${start}.`,
    }));
    expect(transcriptParagraphs(sentences).map((p) => p.start)).toEqual([0, 50]);

    const unpunctuated: CaptionSegment[] = Array.from({ length: 20 }, (_, i) => ({
      start: i * 10,
      duration: 10,
      text: "and so on",
    }));
    expect(transcriptParagraphs(unpunctuated).map((p) => p.start)).toEqual([0, 90, 180]);
  });

  it("breaks at a pause after 45 s even without punctuation", () => {
    const segments: CaptionSegment[] = [
      { start: 0, duration: 30, text: "one" },
      { start: 30, duration: 20, text: "two" },
      { start: 55, duration: 5, text: "three" },
    ];
    expect(transcriptParagraphs(segments).map((p) => p.text)).toEqual(["one two", "three"]);
  });

  it("builds the transcript and description sections", () => {
    const body = youTubeBodyMarkdown(
      "abcDEF12345",
      [
        { start: 0, duration: 4, text: "Hello *world* <b>." },
        { start: 3725, duration: 4, text: "Bye." },
      ],
      "First line.\nSecond line.\n\n0:00 Intro\n1:02:05 - End\n# Not a heading\n- not a list\n2. not a list",
    );
    expect(body).toBe(
      [
        "## Transcript",
        "[0:00](https://youtu.be/abcDEF12345?t=0) Hello \\*world\\* \\<b>.",
        "[1:02:05](https://youtu.be/abcDEF12345?t=3725) Bye.",
        "## Description",
        "First line.",
        "Second line.",
        "[0:00](https://youtu.be/abcDEF12345?t=0) Intro",
        "[1:02:05](https://youtu.be/abcDEF12345?t=3725) - End",
        "\\# Not a heading",
        "\\- not a list",
        "2\\. not a list",
      ].join("\n\n"),
    );
    expect(youTubeBodyMarkdown("abcDEF12345", [{ start: 1, duration: 1, text: "Hi." }], "")).toBe(
      "## Transcript\n\n[0:01](https://youtu.be/abcDEF12345?t=1) Hi.",
    );
  });
});

describe("extractJsonAfter", () => {
  it("matches braces outside strings", () => {
    const value = extractJsonAfter(fixture("watch.html"), "var ytInitialPlayerResponse = ") as {
      microformat: { playerMicroformatRenderer: { description: { simpleText: string } } };
    };
    expect(value.microformat.playerMicroformatRenderer.description.simpleText).toBe(
      'Has a } brace and a " quote',
    );
    expect(extractJsonAfter("no json here", "var x = ")).toBeNull();
  });
});

type Route = (request: SourceFetchRequest) => { status: number; text: string } | undefined;

function fakeFetch(route: Route): { fetch: SourceFetch; requests: SourceFetchRequest[] } {
  const requests: SourceFetchRequest[] = [];
  const fetch: SourceFetch = async (request) => {
    requests.push(request);
    const response = route(request);
    if (!response) throw new Error(`unexpected request ${request.url}`);
    return { ...response, url: request.url, headers: {} };
  };
  return { fetch, requests };
}

function youTubeRoutes(
  overrides: { player?: unknown; captions?: string; watch?: string } = {},
): Route {
  return (request) => {
    if (request.url.startsWith("https://www.youtube.com/watch?v=")) {
      return { status: 200, text: overrides.watch ?? fixture("watch.html") };
    }
    if (request.url.startsWith("https://www.youtube.com/youtubei/v1/player")) {
      const player = overrides.player ?? JSON.parse(fixture("player-ok.json"));
      return { status: 200, text: JSON.stringify(player) };
    }
    if (request.url.startsWith("https://www.youtube.com/api/timedtext")) {
      return { status: 200, text: overrides.captions ?? fixture("timedtext-manual.xml") };
    }
    return undefined;
  };
}

describe("fetchYouTubeCapture", () => {
  it("saves the transcript with the video's details", async () => {
    const { fetch, requests } = fakeFetch(youTubeRoutes());
    const result = await fetchYouTubeCapture("https://youtu.be/aircAruvnKk?t=42", { fetch });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.kind).toBe("youtube");
    expect(result.capture.url).toBe("https://www.youtube.com/watch?v=aircAruvnKk");
    expect(result.capture.title).toBe("But what is a neural network? | Deep learning chapter 1");
    expect(result.capture.meta).toEqual({
      channel: "3Blue1Brown",
      channel_url: "https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw",
      published: "2017-10-05",
      duration: "18:40",
      language: "en",
      captions: "manual",
    });
    const body = result.capture.markdown;
    expect(
      body.startsWith(
        "## Transcript\n\n[0:04](https://youtu.be/aircAruvnKk?t=4) This is a 3. It's sloppily",
      ),
    ).toBe(true);
    expect(body).toContain("\n\n## Description\n\nWhat are the neurons");
    expect(body).toContain("[0:00](https://youtu.be/aircAruvnKk?t=0) - Introduction example");
    expect(body).toContain("\\# not a heading");
    expect(body).not.toMatch(/\n{3,}/);

    const player = requests.find((r) => r.url.includes("/youtubei/v1/player"))!;
    expect(player.url).toBe("https://www.youtube.com/youtubei/v1/player?key=AIzaTESTKEY_123");
    expect(player.method).toBe("POST");
    expect(JSON.parse(player.body!)).toEqual({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId: "aircAruvnKk",
    });
    const captions = requests.find((r) => r.url.includes("/api/timedtext"))!;
    expect(captions.url).not.toContain("fmt=srv3");
    expect(captions.url).not.toContain("kind=asr");
  });

  it("marks auto-generated captions", async () => {
    const player = JSON.parse(fixture("player-ok.json"));
    const tracks = player.captions.playerCaptionsTracklistRenderer.captionTracks as CaptionTrack[];
    player.captions.playerCaptionsTracklistRenderer.captionTracks = tracks.filter(
      (t) => t.kind === "asr",
    );
    const { fetch } = fakeFetch(
      youTubeRoutes({ player, captions: fixture("timedtext-asr-srv3.xml") }),
    );
    const result = await fetchYouTubeCapture("https://www.youtube.com/watch?v=aircAruvnKk", {
      fetch,
    });
    expect(result.status === "ok" && result.capture.meta.captions).toBe("auto-generated");
    expect(result.status === "ok" && result.capture.markdown).toContain("[Music] This is a three.");
  });

  it("returns unavailable when the video has no captions", async () => {
    const player = JSON.parse(fixture("player-ok.json"));
    delete player.captions;
    const { fetch } = fakeFetch(youTubeRoutes({ player }));
    await expect(fetchYouTubeCapture("https://youtu.be/aircAruvnKk", { fetch })).resolves.toEqual({
      status: "unavailable",
      kind: "youtube",
      url: "https://www.youtube.com/watch?v=aircAruvnKk",
      title: "But what is a neural network? | Deep learning chapter 1",
      reason: YOUTUBE_NO_CAPTIONS_REASON,
    });
  });

  it("accepts the consent page with a cookie", async () => {
    const consent =
      '<form action="https://consent.youtube.com/s"><input type="hidden" name="v" value="cb.20261016-00-p0"></form>';
    const { fetch, requests } = fakeFetch((request) => {
      if (request.url.startsWith("https://www.youtube.com/watch") && !request.headers?.Cookie) {
        return { status: 200, text: consent };
      }
      return youTubeRoutes()(request);
    });
    const result = await fetchYouTubeCapture("https://youtu.be/aircAruvnKk", { fetch });
    expect(result.status).toBe("ok");
    expect(requests[1]!.headers?.Cookie).toBe("CONSENT=YES+cb.20261016-00-p0");
    expect(requests.find((r) => r.method === "POST")!.headers?.Cookie).toBe(
      "CONSENT=YES+cb.20261016-00-p0",
    );
  });

  it.each([
    [{ status: "ERROR", reason: "This video is unavailable" }, "not_found"],
    [{ status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" }, "blocked"],
    [{ status: "LOGIN_REQUIRED", reason: "Sign in to confirm your age" }, "blocked"],
    [{ status: "UNPLAYABLE", reason: "Video unavailable in your country" }, "not_found"],
  ])("explains a video that won't play (%o)", async (playabilityStatus, code) => {
    const { fetch } = fakeFetch(youTubeRoutes({ player: { playabilityStatus } }));
    const error = await fetchYouTubeCapture("https://youtu.be/aircAruvnKk", { fetch }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe(code);
  });

  it("explains rate limits, bot checks and empty captions", async () => {
    const limited = fakeFetch(() => ({ status: 429, text: "" }));
    await expect(
      fetchYouTubeCapture("https://youtu.be/aircAruvnKk", { fetch: limited.fetch }),
    ).rejects.toMatchObject({ code: "blocked" });

    const captcha = fakeFetch(youTubeRoutes({ watch: '<div class="g-recaptcha"></div>' }));
    await expect(
      fetchYouTubeCapture("https://youtu.be/aircAruvnKk", { fetch: captcha.fetch }),
    ).rejects.toMatchObject({ code: "blocked" });

    const empty = fakeFetch(youTubeRoutes({ captions: "" }));
    await expect(
      fetchYouTubeCapture("https://youtu.be/aircAruvnKk", { fetch: empty.fetch }),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });

  it("rejects links that aren't a single video", async () => {
    const { fetch, requests } = fakeFetch(() => undefined);
    await expect(
      fetchYouTubeCapture("https://www.youtube.com/playlist?list=PLabc123", { fetch }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(fetchYouTubeCapture("https://example.com", { fetch })).rejects.toMatchObject({
      code: "invalid_url",
    });
    expect(requests).toHaveLength(0);
  });
});
