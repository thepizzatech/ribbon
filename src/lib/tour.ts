// The guided tour. driver.js is loaded on demand so it costs nothing until someone takes the tour.
import { xapi } from "@/lib/gifts/api-extra";

export type TourStep = { target: string; title: string; body: string; side?: "top" | "bottom" | "left" | "right" };

export const TOUR_STEPS: readonly TourStep[] = [
  { target: "hero", title: "Welcome", body: "Hi! This is your gifting dashboard. Everything at a glance.", side: "bottom" },
  { target: "add-gift", title: "Add a gift", body: "Got a gift idea or a purchase? Tap here. Takes 10 seconds.", side: "bottom" },
  { target: "nav-calendar", title: "Calendar", body: "Birthdays, gift deadlines and your own events in one week view. Connect Google, Apple or any calendar in Settings.", side: "right" },
  { target: "nav-ledger", title: "The ledger", body: "Every gift you’ve given or received, with totals and filters.", side: "right" },
  { target: "nav-people", title: "People", body: "One page per person: wishlist, budget, past gifts.", side: "right" },
  { target: "nav-ask", title: "Ask Ribbon", body: "Ask Ribbon in plain English, like “what did I spend on Mom?”", side: "right" },
  { target: "theme", title: "Theme", body: "Light, dark or auto. Pick your vibe.", side: "bottom" },
  { target: "nav-settings", title: "Settings and backup", body: "Back up your data here. Future you says thanks. Replay this tour any time under Help.", side: "right" },
];

/** The copy of a target that is actually on screen: the sidebar, top bar and tab bar each carry some. */
export function visibleTarget(name: string): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  return (
    nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }) ?? null
  );
}

/** Steps whose target exists on this screen size, in order. */
export function availableSteps(): TourStep[] {
  return TOUR_STEPS.filter((step) => visibleTarget(step.target));
}

let running = false;
export const tourRunning = () => running;

function announce(text: string) {
  let region = document.getElementById("tour-live");
  if (!region) {
    region = document.createElement("div");
    region.id = "tour-live";
    region.className = "sr-only";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    document.body.appendChild(region);
  }
  region.textContent = "";
  window.setTimeout(() => {
    if (region) region.textContent = text;
  }, 50);
}

export async function startTour(opts: { beforeStart?: () => Promise<void> | void } = {}): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    await opts.beforeStart?.();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const steps = availableSteps();
    if (steps.length === 0) {
      running = false;
      return false;
    }
    const [{ driver }] = await Promise.all([import("driver.js"), import("driver.js/dist/driver.css")]);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let finished = false;

    const finish = (state: "done" | "skipped") => {
      if (finished) return;
      finished = true;
      void xapi.setTour(state).catch(() => undefined);
    };

    const tour = driver({
      animate: !reduce,
      smoothScroll: !reduce,
      allowClose: true,
      allowKeyboardControl: true,
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 12,
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      popoverClass: "ribbon-tour",
      steps: steps.map((step, index) => ({
        element: () => visibleTarget(step.target) ?? document.body,
        popover: { title: step.title, description: step.body, side: step.side ?? "bottom", align: "start" },
        onHighlightStarted: () => announce(`Step ${index + 1} of ${steps.length}: ${step.title}. ${step.body}`),
      })),
      onPopoverRender: (popover) => {
        const wrapper = popover.wrapper;
        wrapper.setAttribute("role", "dialog");
        wrapper.setAttribute("aria-modal", "true");
        popover.title.id = "tour-title";
        popover.description.id = "tour-desc";
        wrapper.setAttribute("aria-labelledby", "tour-title");
        wrapper.setAttribute("aria-describedby", "tour-desc");
        popover.closeButton.setAttribute("aria-label", "Close the tour");

        if (!popover.footerButtons.querySelector(".driver-skip")) {
          const skip = document.createElement("button");
          skip.type = "button";
          skip.className = "driver-skip";
          skip.textContent = "Skip tour";
          skip.addEventListener("click", () => tour.destroy());
          popover.footerButtons.prepend(skip);
        }
        // Enter and Space work on whichever button has focus; start on the primary one.
        const primary = popover.nextButton.style.display === "none" ? popover.footerButtons.querySelector<HTMLElement>(".driver-popover-done-btn") : popover.nextButton;
        window.setTimeout(() => (primary ?? popover.nextButton).focus({ preventScroll: true }), 0);
      },
      onDestroyStarted: () => {
        finish(tour.hasNextStep() ? "skipped" : "done");
        tour.destroy();
      },
      onDestroyed: () => {
        running = false;
        document.removeEventListener("keydown", trap, true);
        announce("Tour closed");
        window.setTimeout(() => opener?.isConnected && opener.focus({ preventScroll: true }), 0);
      },
    });

    // Keep Tab inside the popover while the tour is open.
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const box = document.querySelector<HTMLElement>(".driver-popover.ribbon-tour");
      if (!box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>("button:not([disabled])")).filter((n) => n.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!box.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trap, true);

    tour.drive();
    return true;
  } catch (error) {
    running = false;
    console.error("The tour couldn’t start", error);
    return false;
  }
}
