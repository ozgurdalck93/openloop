import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { toLocalIsoWithOffset } from './time';

/**
 * The offset is whatever this machine's local timezone is — tests must not
 * hardcode one (see CLAUDE.md). We compute the expected offset the same way
 * the function does, and only assert the wall-clock + round-trip parts.
 */
function expectedOffset(d: Date): string {
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

describe('toLocalIsoWithOffset', () => {
  it('keeps the wall-clock time and appends the local offset', () => {
    const d = at(2026, 9, 29, 18, 16);
    expect(toLocalIsoWithOffset(d)).toBe(`2026-09-29T18:16:00${expectedOffset(d)}`);
  });

  it('zero-pads month, day, hour and minute', () => {
    const d = at(2026, 1, 5, 6, 7);
    expect(toLocalIsoWithOffset(d)).toBe(`2026-01-05T06:07:00${expectedOffset(d)}`);
  });

  it('produces a string Date.parse reads back to the same instant', () => {
    const d = at(2026, 3, 15, 9, 30);
    expect(Date.parse(toLocalIsoWithOffset(d))).toBe(d.getTime());
  });
});
