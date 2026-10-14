import { describe, expect, it } from "vitest";
import { bodyFromDriveFile } from "./drive-file";

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
    const file = "﻿---\r\ntitle: Cars\r\n---\r\n\r\n# Cars\r\n\r\nBody.\r\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nBody.\n");
  });

  it("keeps horizontal rules inside the body", () => {
    const file = "---\ntitle: Cars\n---\n\n# Cars\n\nOne.\n\n---\n\nTwo.\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nOne.\n\n---\n\nTwo.\n");
  });
});
