"use client";

import { useEffect, useRef, useState } from "react";

/**
 * requestAnimationFrame count-up with easeOutCubic. Restarts (from the
 * current value) whenever `target` changes while `active` is true.
 */
export function useCountUp(target: number, active: boolean, duration = 1200): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const from = fromRef.current;
    const startTs = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - startTs) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);

  return value;
}
