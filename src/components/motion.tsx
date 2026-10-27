import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * A number that counts up from 0 (or from its last value) to `value`. With reduced motion it just shows the
 * number. The final value is always in the page for screen readers; the counting digits are hidden from them.
 */
export function CountUp({ value, duration = 800, animate = true, className }: { value: number; duration?: number; animate?: boolean; className?: string }) {
  const [shown, setShown] = useState(animate ? 0 : value);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion() || !animate || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const span = origin === 0 ? duration : Math.min(duration, 450);
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / span);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = shown;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, animate]);
  return (
    <span className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="tnum">
        {shown}
      </span>
    </span>
  );
}
