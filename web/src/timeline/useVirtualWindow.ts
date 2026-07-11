import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

export type Orientation = 'horizontal' | 'vertical';

export interface VirtualWindow {
  startPx: number;
  endPx: number;
}

const DEFAULT_OVERSCAN_PX = 600;

/**
 * Tracks which slice of a scrollable axis is worth rendering: the viewport
 * extent plus `overscanPx` on both sides, clamped to `[0, lengthPx]`.
 * Re-measures on container scroll and window resize.
 */
export function useVirtualWindow(opts: {
  containerRef: RefObject<HTMLElement | null>;
  orientation: Orientation;
  lengthPx: number;
  overscanPx?: number;
}): VirtualWindow {
  const { containerRef, orientation, lengthPx } = opts;
  const overscanPx = opts.overscanPx ?? DEFAULT_OVERSCAN_PX;
  const [win, setWin] = useState<VirtualWindow>({
    startPx: 0,
    endPx: Math.min(lengthPx, overscanPx),
  });

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (el === null) return;
    const scroll = orientation === 'horizontal' ? el.scrollLeft : el.scrollTop;
    const viewport = orientation === 'horizontal' ? el.clientWidth : el.clientHeight;
    const startPx = Math.max(0, scroll - overscanPx);
    const endPx = Math.min(lengthPx, scroll + viewport + overscanPx);
    setWin((prev) => (prev.startPx === startPx && prev.endPx === endPx ? prev : { startPx, endPx }));
  }, [containerRef, orientation, lengthPx, overscanPx]);

  useLayoutEffect(() => {
    measure();
    const el = containerRef.current;
    if (el === null) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure, containerRef]);

  return win;
}
