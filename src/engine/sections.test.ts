import { describe, expect, it } from 'vitest';

import { at, makeLoop } from '../../test/fixtures';
import { groupForHome, homeSectionFor, summarizeHome } from './sections';

const NOW = at(2026, 9, 23, 10, 0);
const iso = (d: Date) => d.toISOString();
const loop = (id: string, overrides: Parameters<typeof makeLoop>[0] = {}) => makeLoop({ id, ...overrides });

describe('homeSectionFor', () => {
  it.each([
    ['task', 'active', 'needs_you'],
    ['promise', 'active', 'needs_you'],
    ['waiting', 'waiting', 'waiting'],
    ['event', 'scheduled', 'coming_up'],
    ['return_later', 'scheduled', 'bring_back_later'],
  ] as const)('%s (%s) → %s', (type, status, section) => {
    expect(homeSectionFor(loop('a', { type, status }), NOW)).toBe(section);
  });

  it('references, drafts and closed loops never appear', () => {
    expect(homeSectionFor(loop('a', { type: 'reference' }), NOW)).toBeNull();
    expect(homeSectionFor(loop('a', { status: 'draft' }), NOW)).toBeNull();
    expect(homeSectionFor(loop('a', { status: 'resolved' }), NOW)).toBeNull();
    expect(homeSectionFor(loop('a', { status: 'archived' }), NOW)).toBeNull();
  });

  it('a waiting loop with a pending follow-up steps aside for the follow-up task', () => {
    expect(homeSectionFor(loop('a', { type: 'waiting', status: 'active', nextActionOwner: 'user' }), NOW)).toBeNull();
  });

  it('a snoozed waiting loop is still waiting', () => {
    expect(homeSectionFor(loop('a', { type: 'waiting', status: 'snoozed' }), NOW)).toBe('waiting');
  });

  it('a snoozed task is parked until its time returns, then needs you again', () => {
    const parked = loop('a', { status: 'snoozed', nextReviewAt: iso(at(2026, 9, 24, 9)) });
    const back = loop('b', { status: 'snoozed', nextReviewAt: iso(at(2026, 9, 23, 9)) });
    expect(homeSectionFor(parked, NOW)).toBe('bring_back_later');
    expect(homeSectionFor(back, NOW)).toBe('needs_you');
  });
});

describe('groupForHome', () => {
  it('sorts soonest first, undated last, then oldest first', () => {
    const groups = groupForHome(
      [
        loop('late', { nextReviewAt: iso(at(2026, 9, 25, 9)) }),
        loop('undated-new', { nextReviewAt: null, createdAt: '2026-09-22T09:00:00.000Z' }),
        loop('soon', { nextReviewAt: iso(at(2026, 9, 24, 9)) }),
        loop('undated-old', { nextReviewAt: null, createdAt: '2026-09-20T09:00:00.000Z' }),
      ],
      NOW,
    );
    expect(groups.needs_you.map((l) => l.id)).toEqual(['soon', 'late', 'undated-old', 'undated-new']);
  });

  it('puts every loop in at most one section', () => {
    const loops = [
      loop('t', { type: 'task' }),
      loop('w', { type: 'waiting', status: 'waiting' }),
      loop('e', { type: 'event', status: 'scheduled' }),
      loop('r', { type: 'return_later', status: 'scheduled' }),
      loop('ref', { type: 'reference' }),
      loop('done', { status: 'resolved' }),
    ];
    const groups = groupForHome(loops, NOW);
    expect(groups.needs_you.map((l) => l.id)).toEqual(['t']);
    expect(groups.waiting.map((l) => l.id)).toEqual(['w']);
    expect(groups.coming_up.map((l) => l.id)).toEqual(['e']);
    expect(groups.bring_back_later.map((l) => l.id)).toEqual(['r']);
  });

  it('shows the follow-up task, not its waiting parent (no duplicate)', () => {
    const groups = groupForHome(
      [
        loop('parent', { type: 'waiting', status: 'active', title: 'HR reply' }),
        loop('child', { type: 'task', parentLoopId: 'parent', title: 'Follow up with HR' }),
      ],
      NOW,
    );
    expect(groups.waiting).toEqual([]);
    expect(groups.needs_you.map((l) => l.title)).toEqual(['Follow up with HR']);
  });
});

describe('summarizeHome', () => {
  const make = (needs: number, waiting: number, coming: number) =>
    groupForHome(
      [
        ...Array.from({ length: needs }, (_, i) => loop(`n${i}`)),
        ...Array.from({ length: waiting }, (_, i) => loop(`w${i}`, { type: 'waiting', status: 'waiting' })),
        ...Array.from({ length: coming }, (_, i) => loop(`c${i}`, { type: 'event', status: 'scheduled' })),
      ],
      NOW,
    );

  it('matches the spec example exactly', () => {
    expect(summarizeHome(make(2, 3, 1))).toBe('2 need you · 3 are waiting · 1 is coming up');
  });

  it('handles singular forms and drops empty parts', () => {
    expect(summarizeHome(make(1, 1, 0))).toBe('1 needs you · 1 is waiting');
    expect(summarizeHome(make(0, 2, 2))).toBe('2 are waiting · 2 are coming up');
    expect(summarizeHome(make(0, 0, 1))).toBe('1 is coming up');
  });

  it('is empty when there is nothing to say (show the calm empty state instead)', () => {
    expect(summarizeHome(make(0, 0, 0))).toBe('');
  });
});
