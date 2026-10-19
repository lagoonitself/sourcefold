import { describe, expect, it } from "vitest";
import {
  NO_PROJECT_VIEW,
  reduceProjectView,
  viewForChordKey,
  viewForCommand,
  viewInProject,
} from "../project-view";

describe("reduceProjectView", () => {
  it("opens a view for a given project", () => {
    const s1 = reduceProjectView(NO_PROJECT_VIEW, {
      type: "open",
      view: "outline",
      projectId: "p1",
    });
    expect(s1).toEqual({ view: "outline", projectId: "p1" });
  });

  it("leaves the view", () => {
    const s1 = reduceProjectView({ view: "broll", projectId: "p1" }, { type: "leave" });
    expect(s1).toEqual(NO_PROJECT_VIEW);
  });

  it("clears view if the project changes, or preserves view if same project reselected", () => {
    const s1 = reduceProjectView(
      { view: "outline", projectId: "p1" },
      { type: "project-selected", projectId: "p2" },
    );
    expect(s1).toEqual(NO_PROJECT_VIEW);

    const s2 = reduceProjectView(
      { view: "outline", projectId: "p1" },
      { type: "project-selected", projectId: "p1" },
    );
    expect(s2).toEqual({ view: "outline", projectId: "p1" });
  });
});

describe("viewInProject", () => {
  it("returns view only when projectId matches", () => {
    expect(viewInProject({ view: "outline", projectId: "p1" }, "p1")).toBe("outline");
    expect(viewInProject({ view: "outline", projectId: "p1" }, "p2")).toBeNull();
    expect(viewInProject({ view: null, projectId: null }, "p1")).toBeNull();
  });
});

describe("viewForChordKey and viewForCommand", () => {
  it("resolves view from chord key", () => {
    expect(viewForChordKey("o")).toBe("outline");
    expect(viewForChordKey("O")).toBe("outline");
    expect(viewForChordKey("b")).toBe("broll");
    expect(viewForChordKey("d")).toBe("duplicates");
    expect(viewForChordKey("x")).toBeNull();
  });

  it("resolves view from command id", () => {
    expect(viewForCommand("projects.outline")).toBe("outline");
    expect(viewForCommand("projects.broll")).toBe("broll");
    expect(viewForCommand("projects.duplicates")).toBe("duplicates");
    expect(viewForCommand("app.settings")).toBeNull();
  });
});
