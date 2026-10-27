import { useEffect, useState } from "react";

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const seen = (key: string) => {
  try {
    return sessionStorage.getItem(`ribbon-intro-${key}`) === "1";
  } catch {
    return false;
  }
};
const markSeen = (key: string) => {
  try {
    sessionStorage.setItem(`ribbon-intro-${key}`, "1");
  } catch {
    /* private mode: the intro may replay, which is harmless */
  }
};

/**
 * True while a page plays its short staggered intro, and only the first time per browser session: later visits
 * (and later changes on the page) render straight away. `ready` is when the content has arrived.
 */
export function useIntro(ready: boolean, key = "page", ms = 500): boolean {
  const [intro, setIntro] = useState(() => typeof window !== "undefined" && !prefersReducedMotion() && !seen(key));
  useEffect(() => {
    if (!ready || !intro) return;
    markSeen(key);
    const t = window.setTimeout(() => setIntro(false), ms);
    return () => window.clearTimeout(t);
  }, [ready, intro, key, ms]);
  return intro;
}

/** Delay in ms for item `i` of `n`: the whole intro is spread across 0 to 100 ms (each item then rises in 180 ms). */
export function stagger(i: number, n: number, intro: boolean): number {
  if (!intro) return 0;
  const t = n <= 1 ? 0 : Math.min(i, n - 1) / (n - 1);
  return Math.round(t * 100);
}
