import { describe, expect, it } from 'vitest';

import { dateOrderForLocale, uiLanguageForLocale } from './locale';

describe('dateOrderForLocale', () => {
  it.each([
    ['tr-TR', 'dmy'],
    ['tr', 'dmy'],
    ['en-GB', 'dmy'],
    ['en-AU', 'dmy'],
    ['de-DE', 'dmy'],
    ['fr-FR', 'dmy'],
    ['en-US', 'mdy'],
    ['en', 'mdy'],
    ['ja-JP', 'mdy'], // year-month-day locales put the month before the day
  ])('%s → %s', (locale, order) => {
    expect(dateOrderForLocale(locale)).toBe(order);
  });

  it('returns null when nothing is known, so the caller can use the text language', () => {
    expect(dateOrderForLocale(undefined)).toBeNull();
    expect(dateOrderForLocale(null)).toBeNull();
    expect(dateOrderForLocale('')).toBeNull();
  });

  it('survives a malformed locale', () => {
    expect(() => dateOrderForLocale('not a locale!!')).not.toThrow();
  });
});

describe('uiLanguageForLocale', () => {
  it('Turkish locales get Turkish; everything else English', () => {
    expect(uiLanguageForLocale('tr-TR')).toBe('tr');
    expect(uiLanguageForLocale('tr')).toBe('tr');
    expect(uiLanguageForLocale('en-US')).toBe('en');
    expect(uiLanguageForLocale('de-DE')).toBe('en');
    expect(uiLanguageForLocale(undefined)).toBe('en');
  });
});
