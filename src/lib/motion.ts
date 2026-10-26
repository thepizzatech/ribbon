import { useEffect, useState } from "react";

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True for the first moments of a page (the staggered intro); false afterwards so later changes stay quick. */
export function useIntro(ready: boolean, ms = 1500): boolean {
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setIntro(false), ms);
    return () => window.clearTimeout(t);
  }, [ready, ms]);
  return intro;
}

/** Delay in ms for item `i` of `n`: spread across 0.2 s to 1.0 s on the intro, a light touch afterwards. */
export function stagger(i: number, n: number, intro: boolean): number {
  const t = n <= 1 ? 0 : i / (n - 1);
  return Math.round(intro ? 200 + t * 800 : t * 120);
}
