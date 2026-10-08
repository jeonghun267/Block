"use client";

import { useEffect, useRef, useState } from "react";

function canAnimate() {
  return typeof window !== "undefined" && typeof window.requestAnimationFrame === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Counts a figure up from its previous value so a changed number reads as movement, not a jump.
export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(() => canAnimate() ? 0 : target);
  const shown = useRef(value);
  useEffect(() => {
    if (!canAnimate()) {
      const timer = window.setTimeout(() => { shown.current = target; setValue(target); }, 0);
      return () => window.clearTimeout(timer);
    }
    const from = shown.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const next = from + (target - from) * (1 - Math.pow(1 - progress, 3));
      shown.current = next;
      setValue(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

export function CountUp({ value, digits = 0, prefix = "", suffix = "" }: { value: number; digits?: number; prefix?: string; suffix?: string }) {
  const shown = useCountUp(value);
  return <>{prefix}{shown.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}{suffix}</>;
}
