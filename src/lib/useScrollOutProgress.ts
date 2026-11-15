import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface ScrollOutProgressResult<T extends Element> {
  ref: RefObject<T | null>;
  /** 0 = element still covers the viewport; 1 = fully scrolled out the top. */
  progress: number;
}

/**
 * 0..1 "scrolled out" progress for a hero element.
 *
 * Unlike a generic viewport-crossing progress, this is 0 while the element
 * still fills the viewport (the rest state) and 1 once its bottom edge has
 * reached the viewport top. Updates are batched on scroll/resize via rAF so
 * the value changes only on scroll events, never inside a render loop.
 */
export function useScrollOutProgress<
  T extends Element = HTMLDivElement,
>(): ScrollOutProgressResult<T> {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let rafId = 0;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const next = (viewport - rect.bottom) / viewport;
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
