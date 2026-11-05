import { beforeEach, describe, expect, it, vi } from "vitest";

// The sharing and backup calls: which route, which method, which body.
const remoteFetch = vi.fn(async (_endpoint: string, _options?: RequestInit) => ({}) as unknown);
vi.mock("../remote-client", () => ({
  isRemoteConfigured: () => true,
  localApiFetch: vi.fn(),
  remoteFetch: (endpoint: string, options?: RequestInit) => remoteFetch(endpoint, options),
}));

import {
  acceptInvite,
  createInvite,
  deleteInvite,
  getBackupSetting,
  getInvitePreview,
  getProjectSharing,
  removeMember,
  resetInvite,
  setBackupSetting,
  setMemberRole,
} from "../api";

function lastCall() {
  const [endpoint, options] = remoteFetch.mock.calls.at(-1)!;
  return {
    endpoint,
    method: options?.method ?? "GET",
    body: options?.body ? JSON.parse(String(options.body)) : undefined,
  };
}

describe("sharing and backup routes", () => {
  beforeEach(() => remoteFetch.mockClear());

  it("reads who is in a project", async () => {
    await getProjectSharing("p1");
    expect(lastCall()).toEqual({
      endpoint: "/api/projects/p1/sharing",
      method: "GET",
      body: undefined,
    });
  });

  it("makes, resets and turns off invite links", async () => {
    await createInvite("p1", "viewer");
    expect(lastCall()).toMatchObject({
      endpoint: "/api/projects/p1/invite",
      method: "POST",
      body: { role: "viewer" },
    });
    await resetInvite("p1", "editor");
    expect(lastCall()).toMatchObject({
      endpoint: "/api/projects/p1/invite/reset",
      method: "POST",
      body: { role: "editor" },
    });
    await deleteInvite("p1", "viewer");
    expect(lastCall()).toMatchObject({
      endpoint: "/api/projects/p1/invite?role=viewer",
      method: "DELETE",
    });
  });

  it("changes a role, and removes or leaves", async () => {
    await setMemberRole("p1", "u1", "viewer");
    expect(lastCall()).toMatchObject({
      endpoint: "/api/projects/p1/members/u1",
      method: "PATCH",
      body: { role: "viewer" },
    });
    await removeMember("p1", "u1");
    expect(lastCall()).toMatchObject({ endpoint: "/api/projects/p1/members/u1", method: "DELETE" });
  });

  it("previews and accepts an invite by code", async () => {
    await getInvitePreview("K7QM2XPD");
    expect(lastCall()).toMatchObject({ endpoint: "/api/invites/K7QM2XPD", method: "GET" });
    await acceptInvite("K7QM2XPD");
    expect(lastCall()).toMatchObject({
      endpoint: "/api/invites/K7QM2XPD/accept",
      method: "POST",
    });
  });

  it("reads and sets the Google Drive backup", async () => {
    await getBackupSetting();
    expect(lastCall()).toMatchObject({ endpoint: "/api/settings/backup", method: "GET" });
    await setBackupSetting(false);
    expect(lastCall()).toMatchObject({
      endpoint: "/api/settings/backup",
      method: "PUT",
      body: { enabled: false },
    });
  });
});
