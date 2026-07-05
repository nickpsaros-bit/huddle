import { useEffect, useState, useRef } from "react";

// Injects the keyframes once, globally, the first time any animated element mounts.
// Self-contained so it works regardless of the global stylesheet.
let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.setAttribute("data-huddle-anim", "true");
  style.textContent = `
    @keyframes huddleFadeInUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes huddleScaleIn {
      from { opacity: 0; transform: scale(0.96); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes huddleSlideUp {
      from { transform: translateY(100%); }
      to   { transform: translateY(0); }
    }
    @keyframes huddlePop {
      0%   { transform: scale(0.8); opacity: 0; }
      60%  { transform: scale(1.05); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-huddle-animated] { animation: none !important; opacity: 1 !important; transform: none !important; }
    }
  `;
  document.head.appendChild(style);
}

const DURATIONS = { fast: 180, normal: 240, slow: 320 };

/**
 * FadeIn — snappy, subtle entrance. Wrap any content.
 * props:
 *   variant: "up" | "scale" | "pop"  (default "up")
 *   delay:   ms delay (for staggering)
 *   speed:   "fast" | "normal" | "slow" (default "normal")
 */
export default function FadeIn({ children, variant = "up", delay = 0, speed = "normal", style = {}, ...rest }) {
  ensureKeyframes();
  const anim = variant === "scale" ? "huddleScaleIn" : variant === "pop" ? "huddlePop" : "huddleFadeInUp";
  const dur = DURATIONS[speed] || DURATIONS.normal;
  return (
    <div
      data-huddle-animated
      style={{
        animation: `${anim} ${dur}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * CountUp — animates a number from 0 to `value` over a short duration.
 * Snappy (≈700ms), used for the profile stats.
 */
export function CountUp({ value = 0, duration = 700, style = {} }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => raf.current && cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span style={style}>{display}</span>;
}