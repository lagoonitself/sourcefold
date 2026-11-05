import { describe, expect, it } from "vitest";
import {
  displayName,
  extractInviteCode,
  formatInviteCode,
  initialsFor,
  inviteLink,
  joinAsText,
  peopleCount,
  roleLabel,
  sharedLabel,
} from "../helpers";

describe("extractInviteCode", () => {
  it("reads a bare code in any case, with or without a dash", () => {
    expect(extractInviteCode("k7qm2xpd")).toBe("K7QM2XPD");
    expect(extractInviteCode("K7QM-2XPD")).toBe("K7QM2XPD");
    expect(extractInviteCode("  k7qm 2xpd  ")).toBe("K7QM2XPD");
  });

  it("reads a join link", () => {
    expect(extractInviteCode("https://sourcefold-eight.vercel.app/join/K7QM2XPD")).toBe("K7QM2XPD");
    expect(extractInviteCode("https://example.com/join/k7qm-2xpd/")).toBe("K7QM2XPD");
    expect(extractInviteCode("https://example.com/join/K7QM2XPD?ref=1#top")).toBe("K7QM2XPD");
  });

  it("refuses anything that isn't eight characters", () => {
    expect(extractInviteCode("")).toBeNull();
    expect(extractInviteCode("K7QM")).toBeNull();
    expect(extractInviteCode("K7QM2XPD9")).toBeNull();
    expect(extractInviteCode("https://example.com/projects")).toBeNull();
  });
});

describe("formatting", () => {
  it("shows a code as two groups of four", () => {
    expect(formatInviteCode("K7QM2XPD")).toBe("K7QM-2XPD");
    expect(formatInviteCode("K7")).toBe("K7");
  });

  it("builds the link from the website address, or gives none without one", () => {
    expect(inviteLink("K7QM2XPD", "https://sourcefold-eight.vercel.app")).toBe(
      "https://sourcefold-eight.vercel.app/join/K7QM2XPD",
    );
    expect(inviteLink("K7QM2XPD", "https://example.com/")).toBe(
      "https://example.com/join/K7QM2XPD",
    );
    expect(inviteLink("K7QM2XPD", undefined)).toBeNull();
  });

  it("makes initials from a name or falls back to the email", () => {
    expect(initialsFor({ name: "Anil Reddy", email: "a@b.c" })).toBe("AR");
    expect(initialsFor({ name: "Mira", email: "m@b.c" })).toBe("M");
    expect(initialsFor({ name: "", email: "zed@b.c" })).toBe("Z");
    expect(displayName({ name: " ", email: "zed@b.c" })).toBe("zed@b.c");
  });

  it("counts people", () => {
    expect(peopleCount(1)).toBe("1 person");
    expect(peopleCount(3)).toBe("3 people");
  });

  it("names roles", () => {
    expect(roleLabel("editor")).toBe("Can edit");
    expect(roleLabel("viewer")).toBe("Can view");
    expect(joinAsText("editor")).toBe("You'll join as an editor.");
    expect(joinAsText("viewer")).toBe("You'll join as a viewer.");
  });

  it("labels shared projects", () => {
    const base = { owner_name: "Mira", owner_email: "m@b.c", member_count: 2 };
    expect(sharedLabel({ ...base, role: "owner" })).toBe("Shared");
    expect(sharedLabel({ ...base, role: "editor" })).toBe("by Mira");
    expect(sharedLabel({ ...base, owner_name: " ", role: "viewer" })).toBe("by m@b.c");
  });
});
