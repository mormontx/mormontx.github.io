import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface ScrollProgressResult<T extends Element> {
  ref: RefObject<T | null>;
  progress: number;
}

/**
 * Exponential damping toward a target. Frame-rate independent when `lambda`
 * is derived from elapsed time (e.g. `1 - Math.exp(-rate * delta)`).
 */
export function damp(current: number, target: number, lambda: number): number {
  return current + (target - current) * lambda;
}

/**
 * 0..1 progress of an element travelling through the viewport.
 * 0 = element top just entering at the viewport bottom; 1 = element bottom
 * just leaving at the viewport top. Updated on scroll/resize via rAF.
 */
export function useScrollProgress<
  T extends Element = HTMLDivElement,
>(): ScrollProgressResult<T> {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let rafId = 0;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const total = rect.height + viewport;
      const next = (viewport - rect.top) / total;
      setProgress(next < 0 ? 0 : next > 1 ? 1 : next);
    };

    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return { ref, progress };
}
