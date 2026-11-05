import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/api", () => ({ getBackupSetting: vi.fn(), setBackupSetting: vi.fn() }));

import { BackupSetting } from "../BackupSetting";

describe("BackupSetting", () => {
  it("explains what the switch does, in the agreed words", () => {
    const html = renderToStaticMarkup(<BackupSetting open signedIn />);
    expect(html).toContain("Back up to Google Drive");
    expect(html).toContain("Your library always lives in your Sourcefold account.");
    expect(html).toContain("copies every source into a Sourcefold folder in your Google Drive.");
  });

  it("is not there in offline mode, which has no account", () => {
    expect(renderToStaticMarkup(<BackupSetting open signedIn={false} />)).toBe("");
  });
});
