import { describe, expect, it } from "vitest";
import { registerAppTools } from "../tools/app";
import { closedDesktop, connect, fakeDesktop, fakeWeb } from "./harness";

describe("show_in_app", () => {
  it("shows a group, a source, and a highlight with its source", async () => {
    const desktop = fakeDesktop();
    const h = await connect(registerAppTools, { web: fakeWeb({}), desktop });
    expect((await h.call("show_in_app", { group_id: "g1" })).text).toBe(
      "Opened group [g1] in the Sourcefold app.",
    );
    await h.call("show_in_app", { source_id: "s1" });
    const highlight = await h.call("show_in_app", { source_id: "s1", highlight_id: "h1" });
    expect(highlight.text).toContain("highlight [h1] in source [s1]");
    expect(desktop.show).toHaveBeenNthCalledWith(1, { group_id: "g1" });
    expect(desktop.show).toHaveBeenNthCalledWith(2, { source_id: "s1" });
    expect(desktop.show).toHaveBeenNthCalledWith(3, { source_id: "s1", highlight_id: "h1" });
  });

  it("asks for the desktop app to be opened when it is closed", async () => {
    const h = await connect(registerAppTools, { web: fakeWeb({}), desktop: closedDesktop() });
    const { text, isError } = await h.call("show_in_app", { group_id: "g1" });
    expect(isError).toBe(true);
    expect(text).toBe("Open the Sourcefold desktop app first.");
  });

  it("wants exactly one target and a source with a highlight", async () => {
    const desktop = fakeDesktop();
    const h = await connect(registerAppTools, { web: fakeWeb({}), desktop });
    const none = await h.call("show_in_app", {});
    expect(none.isError).toBe(true);
    expect(none.text).toContain("exactly one target");
    const two = await h.call("show_in_app", { group_id: "g1", source_id: "s1" });
    expect(two.isError).toBe(true);
    const lonely = await h.call("show_in_app", { highlight_id: "h1" });
    expect(lonely.isError).toBe(true);
    expect(lonely.text).toContain("source_id");
    expect(desktop.show).not.toHaveBeenCalled();
  });
});
