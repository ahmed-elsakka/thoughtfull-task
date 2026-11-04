import { useEffect, type RefObject } from 'react';

// Closes a menu on an outside press or Escape, and returns focus to its button on Escape.
export function useDismiss(
  container: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (
        container.current &&
        event.target instanceof Node &&
        !container.current.contains(event.target)
      )
        close();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      close();
      trigger.current?.focus();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [container, trigger, open, close]);
}
