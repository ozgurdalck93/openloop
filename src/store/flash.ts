import { useSyncExternalStore } from 'react';

/**
 * One calm sentence after an action ("Snoozed until Today · 21:00"). It survives the
 * navigation that usually follows the action, and fades on its own. No stack of toasts.
 */
let current: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const VISIBLE_MS = 4500;

const emit = () => {
  for (const listener of listeners) listener();
};

export function flash(message: string | null | undefined): void {
  if (timer) clearTimeout(timer);
  current = message ?? null;
  emit();
  if (current) {
    timer = setTimeout(() => {
      current = null;
      emit();
    }, VISIBLE_MS);
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useFlash = (): string | null => useSyncExternalStore(subscribe, () => current, () => current);
