import { useSyncExternalStore } from 'react';

/**
 * DEV-ONLY: the last notification response the app actually received — for the Native Test
 * Lab's "notification response debug" panel (`app/dev-lab.tsx`). Written from
 * `useNotificationResponses`, guarded by `__DEV__` there, so this has no production footprint;
 * this module itself is inert (no OS access) either way.
 */
export interface DevNotificationEntry {
  loopId: string | null;
  categoryIdentifier: string | null;
  actionId: string;
  at: string; // ISO
}

let last: DevNotificationEntry | null = null;
const listeners = new Set<() => void>();

export function recordDevNotification(entry: DevNotificationEntry): void {
  last = entry;
  for (const listener of listeners) listener();
}

export function clearDevNotification(): void {
  last = null;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLastDevNotification = (): DevNotificationEntry | null =>
  useSyncExternalStore(subscribe, () => last, () => last);
