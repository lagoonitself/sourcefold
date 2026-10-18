import { describe, expect, it } from "vitest";
import {
  LOCAL_COPY_MESSAGE,
  WEB_UPDATE_MESSAGE,
  buildFolderNames,
  footerStatus,
  indexNotice,
} from "../labels";
import type { SearchStatus } from "../search-api";

function status(overrides: Partial<SearchStatus> = {}): SearchStatus {
  return {
    state: "idle",
    message: null,
    sources_total: 12,
    sources_indexed: 12,
    passages_total: 100,
    passages_embedded: 100,
    disk_bytes: 0,
    ...overrides,
  };
}

describe("indexNotice", () => {
  it("is empty while the index can be searched", () => {
    expect(indexNotice(null)).toBeNull();
    expect(indexNotice(status())).toBeNull();
    expect(indexNotice(status({ state: "indexing" }))).toBeNull();
  });

  it("asks for Local copy when there are no files to read", () => {
    expect(indexNotice(status({ state: "needs_local_copy" }))).toBe(LOCAL_COPY_MESSAGE);
    expect(LOCAL_COPY_MESSAGE).toBe("Turn on Local copy in Settings to search inside sources.");
  });

  it("asks for a web app update", () => {
    expect(indexNotice(status({ state: "needs_web_update" }))).toBe(WEB_UPDATE_MESSAGE);
    expect(WEB_UPDATE_MESSAGE).toBe("Update the web app to search inside sources.");
  });

  it("shows an error's message", () => {
    expect(indexNotice(status({ state: "error", message: "Disk is full." }))).toBe("Disk is full.");
  });
});

describe("footerStatus", () => {
  it("says how many sources are searched", () => {
    expect(footerStatus(status(), false)).toEqual({
      index: "Searching 12 sources",
      meaning: null,
    });
    expect(footerStatus(status({ sources_total: 1 }), false).index).toBe("Searching 1 source");
  });

  it("says how far indexing has got", () => {
    const s = status({ state: "indexing", sources_indexed: 3, sources_total: 12 });
    expect(footerStatus(s, false).index).toBe("Indexing 3 of 12 sources");
  });

  it("shows the vector count only while meaning is on and vectors are missing", () => {
    const s = status({ passages_total: 2400, passages_embedded: 1200 });
    expect(footerStatus(s, true).meaning).toBe("Search by meaning: 1,200 of 2,400 passages");
    expect(footerStatus(s, false).meaning).toBeNull();
    expect(footerStatus(status(), true).meaning).toBeNull();
    const empty = status({ passages_total: 0, passages_embedded: 0 });
    expect(footerStatus(empty, true).meaning).toBeNull();
  });

  it("shows nothing before the first answer or when a notice takes its place", () => {
    expect(footerStatus(null, true)).toEqual({ index: null, meaning: null });
    expect(footerStatus(status({ state: "needs_local_copy" }), true)).toEqual({
      index: null,
      meaning: null,
    });
  });
});

describe("buildFolderNames", () => {
  const folders = [
    { id: "p1", parent_id: null, name: "Engines", position: 0 },
    { id: "g1", parent_id: "p1", name: "Turbo", position: 0 },
    { id: "g2", parent_id: "g1", name: "Lag", position: 0 },
  ];
  const names = buildFolderNames(folders);

  it("finds the project of a nested group", () => {
    expect(names.projectOf("g2")).toBe("p1");
    expect(names.projectOf("p1")).toBe("p1");
    expect(names.projectOf("missing")).toBeNull();
  });

  it("names groups and projects", () => {
    expect(names.groupName("g2")).toBe("Lag");
    expect(names.groupName("missing")).toBe("Group");
    expect(names.projectName("p1")).toBe("Engines");
    expect(names.projectName("unsorted")).toBe("Unsorted");
  });
});
