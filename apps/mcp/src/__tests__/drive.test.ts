import { describe, expect, it } from "vitest";
import { driveTiming, registerDriveTools } from "../tools/drive";
import { connect, fakeWeb } from "./harness";

const connected = () => ({ json: { data: { connected: true, unsaved: 3 } } });

describe("save_to_drive", () => {
  it("keeps saving until nothing is left and reports the total", async () => {
    let batch = 0;
    const web = fakeWeb({
      "GET /drive/status": connected,
      "POST /drive/save": () => {
        batch++;
        return {
          json: {
            data:
              batch === 1
                ? { processed: 50, remaining: 7, done: false, failed: [] }
                : { processed: 7, remaining: 0, done: true, failed: [] },
          },
        };
      },
    });
    const h = await connect(registerDriveTools, { web });
    const { text, isError } = await h.call("save_to_drive");
    expect(isError).toBe(false);
    expect(text).toBe("Saved 57 items to Google Drive.");
    expect(web.calls.filter((c) => c === "POST /drive/save")).toHaveLength(2);
  });

  it("waits for a save the app already started, then carries on", async () => {
    driveTiming.busyRetryMs = 1;
    let calls = 0;
    const web = fakeWeb({
      "GET /drive/status": connected,
      "POST /drive/save": () => {
        calls++;
        return calls < 3
          ? {
              status: 409,
              json: { error: { code: "sync_in_progress", message: "A save is already running." } },
            }
          : { json: { data: { processed: 0, remaining: 0, done: true, failed: [] } } };
      },
    });
    const h = await connect(registerDriveTools, { web });
    const { text, isError } = await h.call("save_to_drive");
    expect(isError).toBe(false);
    expect(text).toContain("a save the Sourcefold app had started saved the changes");
    expect(calls).toBe(3);
    driveTiming.busyRetryMs = 3_000;
  });

  it("says when there was nothing to save", async () => {
    const web = fakeWeb({
      "GET /drive/status": connected,
      "POST /drive/save": () => ({
        json: { data: { processed: 0, remaining: 0, done: true, failed: [] } },
      }),
    });
    const h = await connect(registerDriveTools, { web });
    expect((await h.call("save_to_drive")).text).toContain("up to date");
  });

  it("lists items that failed", async () => {
    const web = fakeWeb({
      "GET /drive/status": connected,
      "POST /drive/save": () => ({
        json: {
          data: {
            processed: 2,
            remaining: 0,
            done: true,
            failed: [{ id: "s2", title: "Big PDF", message: "Drive refused the file" }],
          },
        },
      }),
    });
    const h = await connect(registerDriveTools, { web });
    const { text } = await h.call("save_to_drive");
    expect(text).toContain("Saved 1 item to Google Drive.");
    expect(text).toContain("1 item failed:");
    expect(text).toContain("[s2] Big PDF: Drive refused the file");
  });

  it("explains when Drive is not connected, without trying to save", async () => {
    const web = fakeWeb({
      "GET /drive/status": () => ({ json: { data: { connected: false, unsaved: 0 } } }),
    });
    const h = await connect(registerDriveTools, { web });
    const { text, isError } = await h.call("save_to_drive");
    expect(isError).toBe(true);
    expect(text).toContain("Google Drive isn't connected");
    expect(web.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("passes on the web app's reason when saving fails", async () => {
    const web = fakeWeb({
      "GET /drive/status": connected,
      "POST /drive/save": () => ({
        status: 401,
        json: {
          error: { message: "Reconnect Google Drive to keep saving.", code: "reconnect_drive" },
        },
      }),
    });
    const h = await connect(registerDriveTools, { web });
    const { text, isError } = await h.call("save_to_drive");
    expect(isError).toBe(true);
    expect(text).toContain("Reconnect Google Drive to keep saving.");
  });
});
