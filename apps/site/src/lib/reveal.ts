import { animate, inView, stagger } from "motion";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Scroll reveals for the whole page. Called once from the layout.
 * - `data-reveal`: the element rises in when it enters the viewport.
 * - `data-reveal="stagger"`: its direct children rise in one after another.
 * - `.marker-sweep`: gets `is-in` so the highlighter stroke draws in.
 * Each runs once.
 */
export function initReveals() {
  const reduced = prefersReducedMotion();

  inView(
    "[data-reveal]",
    (el) => {
      const target = el as HTMLElement;
      const isStagger = target.dataset.reveal === "stagger";
      const items = isStagger ? Array.from(target.children) : [target];
      if (reduced) {
        items.forEach((i) => ((i as HTMLElement).style.cssText += "opacity:1;transform:none"));
        return;
      }
      animate(
        items,
        { opacity: [0, 1], transform: ["translateY(18px)", "translateY(0px)"] },
        { duration: 0.7, ease: EASE_OUT, delay: isStagger ? stagger(0.06) : 0 },
      );
    },
    { margin: "0px 0px -12% 0px" },
  );

  inView(
    ".marker-sweep",
    (el) => {
      el.classList.add("is-in");
    },
    { margin: "0px 0px -15% 0px" },
  );
}

/**
 * Runs `start` when `el` scrolls into view, and `stop` (its return value) when it leaves. Use it
 * for demos that loop, so they only play while someone can see them.
 */
export function whileVisible(el: Element, start: () => (() => void) | void) {
  return inView(el, () => start() ?? undefined, { amount: 0.35 });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
