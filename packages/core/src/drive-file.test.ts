import { describe, expect, it } from "vitest";
import { bodyFromDriveFile, buildItemFile, type BuildItemInput } from "./drive-file";

describe("bodyFromDriveFile", () => {
  it("drops the front matter", () => {
    const file = "---\nsource: grokipedia\ntitle: Cars\nfolder: Cars/EVs\n---\n\n# Cars\n\nBody.\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nBody.\n");
  });

  it("drops the trailing note section", () => {
    const file = "---\ntitle: Cars\n---\n\n# Cars\n\nBody.\n\n## My note\n\nCheck the sources.\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nBody.\n");
  });

  it("keeps a body that has no front matter", () => {
    expect(bodyFromDriveFile("# Cars\n\nBody.")).toBe("# Cars\n\nBody.\n");
  });

  it("handles Windows line endings and a byte order mark", () => {
    const file = "\ufeff---\r\ntitle: Cars\r\n---\r\n\r\n# Cars\r\n\r\nBody.\r\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nBody.\n");
  });

  it("keeps horizontal rules inside the body", () => {
    const file = "---\ntitle: Cars\n---\n\n# Cars\n\nOne.\n\n---\n\nTwo.\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nOne.\n\n---\n\nTwo.\n");
  });
});

describe("buildItemFile and round-trip stability", () => {
  const item: BuildItemInput = {
    kind: "grokipedia",
    title: "Quantum Computing",
    url: "https://grokipedia.com/page/Quantum_Computing",
    created_at: "2026-10-13T10:00:00Z",
    folder: "Quantum/Basics",
    meta: {
      summary: "An introduction to quantum computing.",
      fact_checked: "2026-10-12",
    },
    markdown: "## Overview\n\nQuantum bits exist in superposition.\n",
    note: "Review section on error correction.",
  };

  it("builds the expected structure", () => {
    const output = buildItemFile(item, "Quantum/Basics");
    expect(output).toContain("source: grokipedia\n");
    expect(output).toContain("title: Quantum Computing\n");
    expect(output).toContain("fact_checked: 2026-10-12\n");
    expect(output).toContain("saved: 2026-10-13\n");
    expect(output).toContain("folder: Quantum/Basics\n");
    expect(output).toContain("# Quantum Computing\n\n> Saved from [Grokipedia]");
    expect(output).toContain(
      "## Overview\n\nQuantum bits exist in superposition.\n\n## My note\n\nReview section on error correction.\n",
    );
  });

  it("build -> bodyFromDriveFile -> build is byte-for-byte identical", () => {
    const firstBuild = buildItemFile(item, "Quantum/Basics");
    const extractedBody = bodyFromDriveFile(firstBuild);
    const secondBuild = buildItemFile({ ...item, markdown: extractedBody }, "Quantum/Basics");

    expect(secondBuild).toBe(firstBuild);

    const thirdExtracted = bodyFromDriveFile(secondBuild);
    const thirdBuild = buildItemFile({ ...item, markdown: thirdExtracted }, "Quantum/Basics");

    expect(thirdBuild).toBe(firstBuild);
  });

  it("strips pre-existing old source line and leading # Title from stored markdown", () => {
    const oldMarkdown =
      "# Quantum Computing\n\n> Saved from Grokipedia on 2026-10-10. Grokipedia articles change; see the live page: https://old.url\n\n## Overview\n\nBody content.";
    const built = buildItemFile({ ...item, markdown: oldMarkdown }, "Quantum/Basics");

    // Must only have exactly one "# Quantum Computing"
    const titleMatches = built.match(/^# Quantum Computing$/gm);
    expect(titleMatches?.length).toBe(1);

    // Must only have the new canonical source line, not the old one
    expect(built).not.toContain("https://old.url");
    expect(built).toContain(
      "> Saved from [Grokipedia](https://grokipedia.com/page/Quantum_Computing) on 2026-10-13. Grokipedia articles change; check the live page for edits.",
    );
  });
});
