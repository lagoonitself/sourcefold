import { describe, expect, it } from "vitest";
import {
  READER_COMMANDS,
  SEARCH_BOX_COMMANDS,
  SHORTCUT_COMMANDS,
  getCommandsByGroup,
} from "../registry";

describe("search shortcuts", () => {
  it("describes the search box as searching titles and the text of sources", () => {
    const search = SHORTCUT_COMMANDS.find((c) => c.id === "app.search");
    expect(search?.description).toBe("Search titles and the text of every source");
    expect(search?.combos).toEqual(["/"]);
  });

  it("has the reader find keys", () => {
    const byId = new Map(READER_COMMANDS.map((c) => [c.id, c]));
    expect(byId.get("reader.find")).toMatchObject({
      combos: ["Mod+F"],
      title: "Find in this source",
    });
    expect(byId.get("reader.find-next")?.combos).toEqual(["Enter"]);
    expect(byId.get("reader.find-previous")?.combos).toEqual(["Shift+Enter"]);
  });

  it("lists Tab for the search box on the ? sheet but not in the command palette", () => {
    expect(SEARCH_BOX_COMMANDS.map((c) => c.combos)).toEqual([["Tab"]]);
    expect(SHORTCUT_COMMANDS.some((c) => c.id === SEARCH_BOX_COMMANDS[0].id)).toBe(false);
    expect(getCommandsByGroup().App.map((c) => c.id)).toContain("search.switch-scope");
  });

  it("gives every command a unique id", () => {
    const all = [...SHORTCUT_COMMANDS, ...SEARCH_BOX_COMMANDS, ...READER_COMMANDS];
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
