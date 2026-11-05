import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// While the Google Drive backup is off, the Save to Drive button (and with it the unsaved count)
// is gone from the top bar. Signed in, with no status yet, the button area shows "disconnected".
const remote = { configured: true };
vi.mock("@/lib/remote-client", () => ({
  isRemoteConfigured: () => remote.configured,
  remoteFetch: vi.fn(),
}));

import { DriveSyncStatus } from "../DriveSyncStatus";
import { getBackupEnabled, setBackupEnabledState, subscribeBackupEnabled } from "../backup-store";

afterEach(() => {
  setBackupEnabledState(true);
  remote.configured = true;
});

describe("backup store", () => {
  it("counts as on until told otherwise, and tells listeners about changes only", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBackupEnabled(listener);
    expect(getBackupEnabled()).toBe(true);

    setBackupEnabledState(true);
    expect(listener).not.toHaveBeenCalled();

    setBackupEnabledState(false);
    expect(getBackupEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setBackupEnabledState(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("DriveSyncStatus while the backup is off", () => {
  it("renders nothing", () => {
    setBackupEnabledState(false);
    expect(renderToStaticMarkup(<DriveSyncStatus />)).toBe("");
  });

  it("still renders when the backup is on", () => {
    expect(renderToStaticMarkup(<DriveSyncStatus />)).toContain("Drive disconnected");
  });

  it("keeps the offline indicator, which has nothing to do with the backup", () => {
    remote.configured = false;
    setBackupEnabledState(false);
    expect(renderToStaticMarkup(<DriveSyncStatus />)).toContain("On this computer");
  });
});
