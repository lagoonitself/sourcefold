import { describe, expect, it } from "vitest";
import { parseReaderFile } from "../parse-file";

const FRONT = `---
source: youtube
title: Turbo
url: https://www.youtube.com/watch?v=abcDEF12345
saved: 2026-10-15
folder: Engines
---

# Turbo

> Saved from [YouTube](https://www.youtube.com/watch?v=abcDEF12345) on 2026-10-15.

`;

describe("## My highlights", () => {
  it("is cut off the body, so it is never shown and offsets ignore it", () => {
    const parsed = parseReaderFile(
      `${FRONT}## Transcript\n\nThe exhaust spins a turbine.\n\n## My highlights\n\n> The exhaust spins a turbine.\n\n[0:47](https://youtu.be/abcDEF12345?t=47) · Note: Intro\n`,
    );
    expect(parsed.body).toBe("## Transcript\n\nThe exhaust spins a turbine.");
    expect(parsed.note).toBeNull();
  });

  it("sits before the note, which is still read", () => {
    const parsed = parseReaderFile(
      `${FRONT}Body text.\n\n## My highlights\n\n> Body text.\n\n## My note\n\nMine.\n`,
    );
    expect(parsed.body).toBe("Body text.");
    expect(parsed.note).toBe("Mine.");
  });

  it("uses the last heading, like bodyFromDriveFile", () => {
    const parsed = parseReaderFile(
      `${FRONT}## My highlights\n\nA section the page itself had.\n\n## My highlights\n\n> quote\n`,
    );
    expect(parsed.body).toContain("A section the page itself had.");
    expect(parsed.body).not.toContain("> quote");
  });

  it("leaves a body without the section alone", () => {
    const parsed = parseReaderFile(`${FRONT}Plain body.\n\n## My note\n\nMine.\n`);
    expect(parsed.body).toBe("Plain body.");
  });

  it("works on a note kept as plain text and on an empty section", () => {
    expect(parseReaderFile("Just words.\n\n## My highlights\n\n> Just words.\n").body).toBe(
      "Just words.",
    );
    expect(parseReaderFile(`${FRONT}Body.\n\n## My highlights\n`).body).toBe("Body.");
  });
});
