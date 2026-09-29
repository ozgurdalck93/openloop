import { CLOSED_STATUSES, type Loop } from '@/engine/types';

export interface WeeklyCheckIn { closed: number; waiting: number; needsAttention: number }

/** A compact, non-judgmental seven-day check-in. */
export function weeklyCheckIn(loops: readonly Loop[], now: Date): WeeklyCheckIn {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return {
    closed: loops.filter((loop) => loop.resolvedAt && new Date(loop.resolvedAt).getTime() >= weekAgo).length,
    waiting: loops.filter((loop) => loop.type === 'waiting' && !CLOSED_STATUSES.includes(loop.status)).length,
    needsAttention: loops.filter((loop) => !CLOSED_STATUSES.includes(loop.status) && loop.nextActionOwner === 'user' && (!loop.nextReviewAt || new Date(loop.nextReviewAt) <= now)).length,
  };
}
