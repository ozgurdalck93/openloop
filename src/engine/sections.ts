/**
 * Which Home section a loop belongs to (03_OPENLOOP_UX_FLOW.md → Screen 1).
 *
 *   NEEDS YOU         the next action belongs to the user (tasks, promises)
 *   WAITING           dependent on another person / company / system
 *   COMING UP         future events and expected outcomes
 *   REVISIT           intentionally parked
 *
 * References never appear on Home: they exist to be remembered, not resurfaced.
 */
import { strings, type UiLang } from '@/i18n';

import { CLOSED_STATUSES, type Loop } from './types';

export type HomeSection = 'needs_you' | 'waiting' | 'coming_up' | 'bring_back_later';

export type HomeGroups = Record<HomeSection, Loop[]>;

export function homeSectionFor(loop: Loop, now: Date): HomeSection | null {
  if (loop.status === 'draft' || CLOSED_STATUSES.includes(loop.status)) return null;

  switch (loop.type) {
    case 'reference':
      return null;
    case 'waiting':
      // A pending follow-up puts the ball in the user's court; the linked TASK shows under
      // NEEDS YOU, so listing the parent too would show the same thing twice.
      return loop.status === 'active' ? null : 'waiting';
    case 'event':
      return 'coming_up';
    case 'return_later':
      return 'bring_back_later';
    case 'task':
    case 'promise': {
      // A task the user snoozed is parked until its time comes back around.
      const parked =
        loop.status === 'snoozed' && loop.nextReviewAt !== null && new Date(loop.nextReviewAt).getTime() > now.getTime();
      return parked ? 'bring_back_later' : 'needs_you';
    }
  }
}

/** Soonest first; undated last; ties by age. */
const byUrgency = (a: Loop, b: Loop): number => {
  if (a.nextReviewAt !== b.nextReviewAt) {
    if (a.nextReviewAt === null) return 1;
    if (b.nextReviewAt === null) return -1;
    return a.nextReviewAt < b.nextReviewAt ? -1 : 1; // ISO-8601 UTC sorts lexicographically
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
};

export function groupForHome(loops: readonly Loop[], now: Date): HomeGroups {
  const groups: HomeGroups = { needs_you: [], waiting: [], coming_up: [], bring_back_later: [] };
  for (const loop of loops) {
    const section = homeSectionFor(loop, now);
    if (section) groups[section].push(loop);
  }
  for (const list of Object.values(groups)) list.sort(byUrgency);
  return groups;
}

/**
 * "2 need you · 3 are waiting · 1 is coming up". Empty parts are left out; an
 * empty string means there is nothing to say (show the empty state instead).
 */
export function summarizeHome(groups: HomeGroups, lang: UiLang = 'en'): string {
  const s = strings(lang).home.summary;
  const parts: string[] = [];
  const need = groups.needs_you.length;
  const wait = groups.waiting.length;
  const soon = groups.coming_up.length;
  if (need > 0) parts.push(s.needsYou(need));
  if (wait > 0) parts.push(s.waiting(wait));
  if (soon > 0) parts.push(s.comingUp(soon));
  return parts.join(' · ');
}
