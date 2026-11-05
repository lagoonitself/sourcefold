import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/api", () => ({
  createInvite: vi.fn(),
  resetInvite: vi.fn(),
  deleteInvite: vi.fn(),
}));
vi.mock("@/lib/build-env", () => ({
  WEB_URL: "https://sourcefold-eight.vercel.app",
  CONTENT_URL: undefined,
}));

import { LinkBlock } from "../InviteLinks";

describe("LinkBlock with a website address", () => {
  it("shows the join link, the code, and both copy buttons", () => {
    const html = renderToStaticMarkup(
      <LinkBlock
        heading="Anyone with this link can view"
        code="K7QM2XPD"
        busy={false}
        onReset={() => {}}
        onTurnOff={() => {}}
      />,
    );
    expect(html).toContain("https://sourcefold-eight.vercel.app/join/K7QM2XPD");
    expect(html).toContain("K7QM-2XPD");
    expect(html).toContain("Copy link");
    expect(html).toContain("Copy code");
  });
});
