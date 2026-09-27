/**
 * Pure helpers behind the date/time controls on Review and Edit. There is no
 * native date-picker dependency: dates and times are nudged with steppers, which
 * behave the same on iOS, Android and the web build used for runtime testing.
 */
import { nextSlot } from '@/engine/followUpPolicy';

import { addDays, atTime } from './time';

export type WhenUnit = 'day' | 'hour' | 'minute';

/** Minutes move in quarter hours: what people actually schedule. */
export const MINUTE_STEP = 15;

/**
 * Moves `when` one step. Hours and minutes wrap WITHIN their unit and never carry
 * (23:00 + 1h → 00:00 the same day; 10:45 + 15min → 10:00), so each stepper changes
 * exactly the number it shows. Days carry across months.
 */
export function nudgeWhen(when: Date, unit: WhenUnit, direction: 1 | -1): Date {
  switch (unit) {
    case 'day':
      return addDays(when, direction);
    case 'hour':
      return atTime(when, (when.getHours() + direction + 24) % 24, when.getMinutes());
    case 'minute': {
      const steps = 60 / MINUTE_STEP;
      const snapped = Math.round(when.getMinutes() / MINUTE_STEP);
      return atTime(when, when.getHours(), (((snapped + direction) % steps) + steps) % steps * MINUTE_STEP);
    }
  }
}

/** Where the steppers start when a loop has no time yet: the next reasonable slot. */
export function seedWhen(now: Date): Date {
  return nextSlot(now);
}
