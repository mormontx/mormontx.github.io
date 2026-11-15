import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface InViewResult<T extends Element> {
  ref: RefObject<T | null>;
  inView: boolean;
}

/**
 * IntersectionObserver hook. Returns a ref to attach and whether the element
 * has crossed the given visibility threshold. SSR-safe: on the server nothing
 * is observed and `inView` starts false.
 */
export function useInView<T extends Element = HTMLDivElement>(
  threshold = 0.15,
): InViewResult<T> {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}
