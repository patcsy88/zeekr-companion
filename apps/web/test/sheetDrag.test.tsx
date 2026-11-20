import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ConfirmDialog';

function open(over: { cancelDisabled?: boolean } = {}) {
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Delete?"
      description="Cannot be undone."
      confirmLabel="Delete"
      busy={false}
      onConfirm={() => undefined}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onCancel, grabber: screen.getByTestId('sheet-grabber') };
}

function pointer(el: Element, type: string, clientY: number, timeStamp: number) {
  const e = createEvent(type, el, { clientY, pointerId: 1, bubbles: true });
  Object.defineProperty(e, 'timeStamp', { value: timeStamp });
  Object.defineProperty(e, 'clientY', { value: clientY });
  fireEvent(el, e);
}

function drag(el: Element, to: number, ms: number) {
  pointer(el, 'pointerdown', 0, 1000);
  pointer(el, 'pointermove', to, 1000 + ms / 2);
  pointer(el, 'pointerup', to, 1000 + ms);
}

describe('confirm sheet drag to dismiss', () => {
  // jsdom has no pointer capture; real browsers do.
  Element.prototype.setPointerCapture = vi.fn();

  it('a long slow drag cancels', () => {
    const { onCancel, grabber } = open();
    drag(grabber, 150, 1000);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a short fast flick cancels', () => {
    const { onCancel, grabber } = open();
    drag(grabber, 40, 50);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a short slow drag springs back and does not cancel', () => {
    const { onCancel, grabber } = open();
    drag(grabber, 40, 1000);
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLElement>('[data-slot="alert-dialog-popup"]')?.style.translate,
    ).toBe('');
  });

  it('moves with the finger while dragging, never upward', () => {
    const { grabber } = open();
    const popup = document.querySelector<HTMLElement>('[data-slot="alert-dialog-popup"]');
    pointer(grabber, 'pointerdown', 100, 1000);
    pointer(grabber, 'pointermove', 160, 10);
    expect(popup?.style.translate).toBe('0 60px');
    pointer(grabber, 'pointermove', 50, 20);
    expect(popup?.style.translate).toBe('');
  });

  it('does nothing while a request runs', () => {
    const { onCancel, grabber } = open({ cancelDisabled: true });
    drag(grabber, 300, 200);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a pointer cancel springs back', () => {
    const { onCancel, grabber } = open();
    pointer(grabber, 'pointerdown', 0, 1000);
    pointer(grabber, 'pointermove', 200, 10);
    pointer(grabber, 'pointercancel', 200, 20);
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLElement>('[data-slot="alert-dialog-popup"]')?.style.translate,
    ).toBe('');
  });

  it('moves and releases without a start are ignored', () => {
    const { onCancel, grabber } = open();
    pointer(grabber, 'pointermove', 200, 10);
    pointer(grabber, 'pointerup', 200, 20);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
