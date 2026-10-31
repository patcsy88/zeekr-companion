import { useEffect, useRef } from 'react';

const THRESHOLD_PX = 80;

/** Calls `onRefresh` when the user drags down from the top of the page. Touch only. */
export function usePullToRefresh(onRefresh: () => void): void {
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    let startY: number | null = null;
    const start = (e: TouchEvent) => {
      startY = window.scrollY <= 0 ? (e.touches[0]?.clientY ?? null) : null;
    };
    const end = (e: TouchEvent) => {
      const y = e.changedTouches[0]?.clientY;
      if (startY !== null && y !== undefined && y - startY > THRESHOLD_PX) latest.current();
      startY = null;
    };
    const cancel = () => {
      startY = null;
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', cancel);
    };
  }, []);
}
