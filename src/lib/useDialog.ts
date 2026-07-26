import { useEffect, useRef, type MutableRefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The three things a modal owes a keyboard user, none of which were present:
 * Escape closes it, focus starts inside it, and Tab cannot wander out to the page
 * behind. Focus is returned to whatever opened the dialog on close.
 */
export function useDialog(open: boolean, onClose: () => void): MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  /**
   * Held in a ref, and deliberately NOT a dependency below. Callers pass an inline
   * arrow, so `onClose` is a new function on every render; with it in the dep array
   * the effect re-ran per render and re-focused the dialog's first control. In the
   * import dialog that made typing impossible: the first keystroke re-rendered,
   * focus jumped to the close button, and every later character was dropped.
   */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === head || !ref.current.contains(active))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      restoreTo.current?.focus?.();
    };
  }, [open]);

  return ref;
}
