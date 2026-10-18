import * as React from "react";

const COLLAPSED_KEY = "sourcefold:sidebar-collapsed";
/** At this window width and up the sidebar sits beside the content; below it, it slides over. */
export const WIDE_WINDOW_QUERY = "(min-width: 1024px)";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export interface SidebarState {
  /** The window is wide enough to keep the sidebar beside the content. */
  wide: boolean;
  /** The sidebar is beside the content (wide window, not collapsed by the user). */
  docked: boolean;
  /** The sidebar is sliding over the content (narrow window, or collapsed and opened again). */
  drawerOpen: boolean;
  /** Shows or hides the sidebar, whatever the window width. */
  toggle: () => void;
  closeDrawer: () => void;
}

export function useSidebar(): SidebarState {
  const [wide, setWide] = React.useState(() => window.matchMedia(WIDE_WINDOW_QUERY).matches);
  const [collapsed, setCollapsed] = React.useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia(WIDE_WINDOW_QUERY);
    const onChange = () => {
      setWide(query.matches);
      setDrawerOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const docked = wide && !collapsed;

  const toggle = React.useCallback(() => {
    if (wide) {
      setDrawerOpen(false);
      setCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
        } catch {}
        return next;
      });
    } else {
      setDrawerOpen((prev) => !prev);
    }
  }, [wide]);

  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);

  return { wide, docked, drawerOpen: !docked && drawerOpen, toggle, closeDrawer };
}
