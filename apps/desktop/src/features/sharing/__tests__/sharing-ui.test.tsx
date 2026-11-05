import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The dialogs' building blocks, rendered to HTML (no browser here). Their calls go through
// `@/lib/api`, which is mocked so nothing reaches for a session.
vi.mock("@/lib/api", () => ({
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
  createInvite: vi.fn(),
  resetInvite: vi.fn(),
  deleteInvite: vi.fn(),
  getInvitePreview: vi.fn(),
  acceptInvite: vi.fn(),
}));
// No website address in the build: invite links can't be built, only the code is shown.
vi.mock("@/lib/build-env", () => ({ WEB_URL: undefined, CONTENT_URL: undefined }));

import type { InvitePreview, ShareMember, SharePerson } from "@/lib/types";
import { InvitePreviewSummary } from "../InviteCard";
import { LinkBlock } from "../InviteLinks";
import { PeopleList } from "../PeopleList";

const owner: SharePerson = {
  user_id: "u-owner",
  email: "mira@example.com",
  name: "Mira Stone",
  avatar_url: null,
};
const member: ShareMember = {
  user_id: "u-1",
  email: "ben@example.com",
  name: "Ben Hall",
  avatar_url: null,
  role: "editor",
  joined_at: "2026-11-01T00:00:00.000Z",
};

function people(canManage: boolean, yourUserId: string | null = "u-owner") {
  return renderToStaticMarkup(
    <PeopleList
      projectId="p1"
      owner={owner}
      members={[
        member,
        { ...member, user_id: "u-2", name: "", email: "cy@example.com", role: "viewer" },
      ]}
      yourUserId={yourUserId}
      canManage={canManage}
      onMembersChange={() => {}}
    />,
  );
}

describe("PeopleList", () => {
  it("lets the owner change roles and remove people", () => {
    const html = people(true);
    expect(html).toContain("> (you)<");
    expect(html).toContain("Role for Ben Hall");
    expect(html).toContain("Role for cy@example.com");
    expect(html).toContain("Can edit");
    expect(html).toContain("Can view");
  });

  it("shows other members only plain role labels", () => {
    const html = people(false, "u-1");
    expect(html).not.toContain("Role for");
    expect(html).toContain("> (you)<");
    expect(html).toContain("Owner");
    expect(html).toContain("Can view");
  });
});

describe("LinkBlock", () => {
  it("shows the code as K7QM-2XPD with Copy code, and no link when the build has no website", () => {
    const html = renderToStaticMarkup(
      <LinkBlock
        heading="Anyone with this link can join as an editor"
        code="K7QM2XPD"
        busy={false}
        onReset={() => {}}
        onTurnOff={() => {}}
      />,
    );
    expect(html).toContain("Anyone with this link can join as an editor");
    expect(html).toContain("K7QM-2XPD");
    expect(html).toContain("Copy code");
    expect(html).not.toContain("Copy link");
    expect(html).toContain("New link");
    expect(html).toContain("Turn off link");
  });
});

describe("InvitePreviewSummary", () => {
  const preview: InvitePreview = {
    project_id: "p1",
    project_name: "Cars",
    role: "editor",
    owner,
    member_count: 3,
    your_role: null,
  };

  it("says who shared it, how many people, and the role you'd get", () => {
    const html = renderToStaticMarkup(<InvitePreviewSummary preview={preview} />);
    expect(html).toContain("Cars");
    expect(html).toContain("Shared by Mira Stone, 3 people.");
    expect(html).toContain("You&#x27;ll join as an editor.");
  });

  it("says so when you are already in", () => {
    const html = renderToStaticMarkup(
      <InvitePreviewSummary preview={{ ...preview, role: "viewer", your_role: "editor" }} />,
    );
    expect(html).toContain("already in this project");
    expect(html).not.toContain("join as");
  });
});
