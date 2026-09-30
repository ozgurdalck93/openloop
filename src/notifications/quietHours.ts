/**
 * Quiet hours: a window (whole hours, local time) in which OS reminders are held back. Pure.
 * A reminder that would fire inside the window is moved to the moment the window ends — the loop's
 * own review time never changes, only when the phone makes a sound. The window may cross midnight
 * (22 → 8).
 */
import { addDays, atTime } from '@/utils/time';

export interface QuietHours {
  enabled: boolean;
  /** 0–23. The window starts at the top of this hour. */
  startHour: number;
  /** 0–23. The window ends at the top of this hour. Equal to `startHour` means "no window". */
  endHour: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, startHour: 22, endHour: 8 };

const inWindow = (hour: number, { startHour, endHour }: QuietHours): boolean => {
  if (startHour === endHour) return false;
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
};

export function applyQuietHours(fireAt: Date, quiet: QuietHours): Date {
  if (!quiet.enabled || !inWindow(fireAt.getHours(), quiet)) return fireAt;
  const end = atTime(fireAt, quiet.endHour);
  // Overnight window and we're in the evening part: the window ends tomorrow morning.
  return quiet.startHour > quiet.endHour && fireAt.getHours() >= quiet.startHour ? addDays(end, 1) : end;
}

/** Reads a stored value defensively; anything unusable falls back to the default. */
export function parseQuietHours(raw: string | null): QuietHours {
  if (!raw) return DEFAULT_QUIET_HOURS;
  try {
    const value = JSON.parse(raw) as Partial<QuietHours>;
    const hour = (n: unknown, fallback: number) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 23 ? (n as number) : fallback);
    return {
      enabled: value.enabled === true,
      startHour: hour(value.startHour, DEFAULT_QUIET_HOURS.startHour),
      endHour: hour(value.endHour, DEFAULT_QUIET_HOURS.endHour),
    };
  } catch {
    return DEFAULT_QUIET_HOURS;
  }
}
