import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bodyFromDriveFile, buildItemFile, type BuildItemInput } from "../../src/drive-file";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("golden fixtures", () => {
  const jsonFiles = readdirSync(currentDir).filter((file) => file.endsWith(".input.json"));

  it("found golden fixtures to test", () => {
    expect(jsonFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const jsonFile of jsonFiles) {
    const baseName = jsonFile.replace(/\.input\.json$/, "");
    const mdFile = `${baseName}.md`;

    it(`matches byte-for-byte: ${baseName}`, () => {
      const jsonContent = readFileSync(join(currentDir, jsonFile), "utf-8");
      const expectedMd = readFileSync(join(currentDir, mdFile), "utf-8").replace(/\r\n/g, "\n");

      const input = JSON.parse(jsonContent) as BuildItemInput;
      const built = buildItemFile(input, input.folder ?? undefined);

      expect(built).toBe(expectedMd);

      // Verify round-trip stability: build -> bodyFromDriveFile -> build is identical
      const extractedBody = bodyFromDriveFile(built);
      const roundTripped = buildItemFile(
        { ...input, markdown: extractedBody },
        input.folder ?? undefined,
      );

      expect(roundTripped).toBe(expectedMd);
    });
  }
});
