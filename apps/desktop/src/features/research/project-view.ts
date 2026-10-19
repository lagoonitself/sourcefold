// The project's own views besides its groups: Outline, B-roll and Duplicates
// (docs/dev/handoff-research.md, "Project views").

export type ProjectView = "outline" | "broll" | "duplicates";

export const PROJECT_VIEWS: readonly ProjectView[] = ["outline", "broll", "duplicates"];

export const PROJECT_VIEW_LABELS: Record<ProjectView, string> = {
  outline: "Outline",
  broll: "B-roll",
  duplicates: "Duplicates",
};

/** The registry command that opens each view, and the keys shown for it. */
export const PROJECT_VIEW_COMMANDS: Record<ProjectView, { id: string; keys: string }> = {
  outline: { id: "projects.outline", keys: "g o" },
  broll: { id: "projects.broll", keys: "g b" },
  duplicates: { id: "projects.duplicates", keys: "g d" },
};

export function viewForCommand(commandId: string): ProjectView | null {
  for (const view of PROJECT_VIEWS) {
    if (PROJECT_VIEW_COMMANDS[view].id === commandId) return view;
  }
  return null;
}

/** The letter after `g` in the global chord, `g o` and so on. */
export function viewForChordKey(key: string): ProjectView | null {
  const lower = key.toLowerCase();
  for (const view of PROJECT_VIEWS) {
    if (PROJECT_VIEW_COMMANDS[view].keys === `g ${lower}`) return view;
  }
  return null;
}

/** The open view, and the project it was opened in. A view never carries over to another project. */
export interface ProjectViewState {
  view: ProjectView | null;
  projectId: string | null;
}

export const NO_PROJECT_VIEW: ProjectViewState = { view: null, projectId: null };

export type ProjectViewAction =
  | { type: "open"; view: ProjectView; projectId: string }
  /** A group was opened (or anything else that leaves the view). */
  | { type: "leave" }
  | { type: "project-selected"; projectId: string | null };

export function reduceProjectView(
  state: ProjectViewState,
  action: ProjectViewAction,
): ProjectViewState {
  switch (action.type) {
    case "open":
      return state.view === action.view && state.projectId === action.projectId
        ? state
        : { view: action.view, projectId: action.projectId };
    case "leave":
      return state.view === null ? state : NO_PROJECT_VIEW;
    case "project-selected":
      return state.projectId === action.projectId ? state : NO_PROJECT_VIEW;
  }
}

/** The view to show for the open project, or null while a group is open. */
export function viewInProject(state: ProjectViewState, projectId: string | null): ProjectView | null {
  return state.projectId !== null && state.projectId === projectId ? state.view : null;
}
