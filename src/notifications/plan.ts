import { resurfaceCopy } from '@/engine/suggestions';
import { CLOSED_STATUSES, type Loop } from '@/engine/types';
import type { UiLang } from '@/i18n';

import { CATEGORY_IDS, categoryKeyFor, type NotificationCategoryKey } from './categories';

export interface NotificationPlan {
  fireAt: Date;
  title: string;
  body: string;
  categoryKey: NotificationCategoryKey;
  categoryIdentifier: string;
  data: { loopId: string };
}

/**
 * Should this loop have an OS reminder, and what should it say? Pure. Returns
 * null for references, closed or draft loops, loops with no review time, and
 * times already behind us (those surface on Home instead).
 */
export function planNotification(loop: Loop, now: Date, lang: UiLang = 'en'): NotificationPlan | null {
  if (loop.status === 'draft' || CLOSED_STATUSES.includes(loop.status)) return null;
  if (loop.nextReviewAt === null) return null;

  const categoryKey = categoryKeyFor(loop.type);
  const copy = resurfaceCopy(loop, now, lang);
  if (!categoryKey || !copy) return null;

  const fireAt = new Date(loop.nextReviewAt);
  if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() <= now.getTime()) return null;

  return {
    fireAt,
    title: copy.title,
    body: copy.body,
    categoryKey,
    categoryIdentifier: CATEGORY_IDS[categoryKey],
    data: { loopId: loop.id },
  };
}
