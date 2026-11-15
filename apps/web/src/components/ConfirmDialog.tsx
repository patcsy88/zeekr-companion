import { useRef, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';

/**
 * Asks before something that cannot be undone. Cancel has the focus when it opens, Escape or
 * Cancel closes it, and a tap on the dimmed page does nothing.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  busy,
  cancelDisabled = false,
  onConfirm,
  onCancel,
  descriptionTestId,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  /** Extra lines under the description, such as a warning or an error. */
  children?: ReactNode;
  confirmLabel: string;
  busy: boolean;
  cancelDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  descriptionTestId?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !cancelDisabled) onCancel();
      }}
    >
      <AlertDialogPopup initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription data-testid={descriptionTestId}>
            {description}
          </AlertDialogDescription>
          {children}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            size="lg"
            ref={cancelRef}
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button variant="destructive" size="lg" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
