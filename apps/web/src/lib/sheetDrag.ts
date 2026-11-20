import { useRef, type PointerEvent } from 'react';

export const DISMISS_PX = 100;
const FAST_PX_PER_MS = 0.6;
const FAST_MIN_PX = 30;

interface Drag {
  startY: number;
  startAt: number;
  dy: number;
}

/**
 * Drag a bottom sheet down by its grab bar. A long or fast drag calls `onDismiss`; a short one
 * springs back. Does nothing while `disabled`. Pointer events, so touch and mouse both work.
 */
export function useSheetDrag(onDismiss: () => void, disabled: boolean) {
  const drag = useRef<Drag | null>(null);
  const sheet = (e: PointerEvent<HTMLElement>) =>
    e.currentTarget.closest<HTMLElement>('[data-slot="alert-dialog-popup"]');

  const move = (el: HTMLElement | null, dy: number, animate: boolean) => {
    if (!el) return;
    el.style.transition = animate ? '' : 'none';
    el.style.translate = dy > 0 ? `0 ${String(dy)}px` : '';
  };

  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startY: e.clientY, startAt: e.timeStamp, dy: 0 };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      d.dy = Math.max(0, e.clientY - d.startY);
      move(sheet(e), d.dy, false);
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const ms = Math.max(1, e.timeStamp - d.startAt);
      const far = d.dy >= DISMISS_PX || (d.dy >= FAST_MIN_PX && d.dy / ms >= FAST_PX_PER_MS);
      move(sheet(e), 0, true);
      if (far) onDismiss();
    },
    onPointerCancel(e: PointerEvent<HTMLElement>) {
      drag.current = null;
      move(sheet(e), 0, true);
    },
  };
}
