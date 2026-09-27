import type { EngineContext, Loop } from '@/engine/types';

/** Local-time date builder: months are 1-based here to read like a calendar. */
export function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/** Sequential ids ("id-1", "id-2", …) make engine output assertable. */
export function makeContext(now: Date): EngineContext & { ids: () => string[] } {
  let n = 0;
  const issued: string[] = [];
  return {
    now,
    newId: () => {
      n += 1;
      const id = `id-${n}`;
      issued.push(id);
      return id;
    },
    ids: () => issued,
  };
}

export function makeLoop(overrides: Partial<Loop> = {}): Loop {
  const created = '2026-09-21T09:00:00.000Z';
  return {
    id: 'loop-1',
    captureId: null,
    type: 'task',
    status: 'active',
    title: 'Call dentist',
    rawContext: null,
    nextActionOwner: 'user',
    entityName: null,
    expectedEvent: null,
    nextReviewAt: null,
    closingCondition: null,
    followUpPolicy: null,
    classificationConfidence: 0.9,
    timingConfidence: 0.9,
    entityConfidence: 0,
    parentLoopId: null,
    notificationId: null,
    createdAt: created,
    updatedAt: created,
    resolvedAt: null,
    ...overrides,
  };
}
