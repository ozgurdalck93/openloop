import { useSyncExternalStore } from 'react';

/**
 * A tiny "something changed" signal. The service raises it after every stored change —
 * including ones made by a notification button while the app is open — and screens that
 * show loops reload when it moves. Screens never poll and never share loop state.
 */
let version = 0;
const listeners = new Set<() => void>();

export function notifyChanged(): void {
  version += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Increases whenever any loop changed. Use it as an effect dependency to reload. */
export const useChangeVersion = (): number => useSyncExternalStore(subscribe, () => version, () => version);
