import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { XTreeNode } from "../src/capture-types";
import { renderXThreadMarkdown } from "../src/x/markdown";

const here = dirname(fileURLToPath(import.meta.url));
const xMediaDir = join(here, "x-media");

describe("renderXThreadMarkdown with shared x-media fixture", () => {
  it("renders thread.nodes.json byte-identically to thread.body.md", () => {
    const nodesJson = readFileSync(join(xMediaDir, "thread.nodes.json"), "utf-8");
    const bodyMd = readFileSync(join(xMediaDir, "thread.body.md"), "utf-8");

    const nodes = JSON.parse(nodesJson) as XTreeNode[];
    const rendered = renderXThreadMarkdown(nodes, "T");

    expect(rendered.trimEnd()).toBe(("# T\n\n" + bodyMd).trimEnd());
  });
});
