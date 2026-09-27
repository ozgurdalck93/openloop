/**
 * Locale helpers. Pure: the device locale is read once, in `i18n`, and passed in.
 * Uses `Intl` when the runtime has it (Hermes, browsers, Node) and a small region
 * table when it does not.
 */

/** Order of the numbers in a numeric date like "12/10". */
export type DateOrder = 'dmy' | 'mdy';

/** Regions that write month first. Everything else in common use writes day first. */
const MONTH_FIRST_REGIONS = new Set(['US', 'PH', 'FM', 'PW', 'MH', 'GU', 'VI', 'AS', 'MP']);

/**
 * Which way a locale reads "12/10": `tr-TR` and `en-GB` → day first (12 October);
 * `en-US` → month first (December 10). Returns null when nothing is known, so the
 * caller can fall back to the language of the text.
 */
export function dateOrderForLocale(locale: string | null | undefined): DateOrder | null {
  if (!locale) return null;
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(
      new Date(2000, 10, 25),
    );
    const day = parts.findIndex((p) => p.type === 'day');
    const month = parts.findIndex((p) => p.type === 'month');
    if (day >= 0 && month >= 0) return day < month ? 'dmy' : 'mdy';
  } catch {
    // fall through to the region table
  }
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  if (region) return MONTH_FIRST_REGIONS.has(region) ? 'mdy' : 'dmy';
  return /^tr\b/i.test(locale) ? 'dmy' : null;
}

/** "tr-TR" / "tr" → 'tr'; everything else → 'en' (the only other language the app speaks). */
export function uiLanguageForLocale(locale: string | null | undefined): 'en' | 'tr' {
  return /^tr\b/i.test(locale ?? '') ? 'tr' : 'en';
}
