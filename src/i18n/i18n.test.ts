import { describe, expect, it } from 'vitest';

import type { IssueCode, Uncertainty } from '@/engine/candidateEdit';
import { getUiLang, issueMessage, strings } from './index';

const UNCERTAINTIES: Uncertainty[] = ['type', 'timing', 'name', 'payday', 'suggested'];
const ISSUES: IssueCode[] = ['title_required', 'title_too_long', 'context_too_long', 'when_required', 'when_passed'];

describe('i18n', () => {
  it('picks Turkish for Turkish locales, English otherwise', () => {
    expect(getUiLang('tr-TR')).toBe('tr');
    expect(getUiLang('en-US')).toBe('en');
    expect(getUiLang('ja-JP')).toBe('en');
    expect(getUiLang(undefined)).toBe(getUiLang());
  });

  it('has every message in both languages, and Turkish differs from English', () => {
    for (const code of UNCERTAINTIES) {
      expect(strings('en').uncertainty[code]).toBeTruthy();
      expect(strings('tr').uncertainty[code]).toBeTruthy();
      expect(strings('tr').uncertainty[code]).not.toBe(strings('en').uncertainty[code]);
    }
    for (const code of ISSUES) {
      expect(strings('tr').issue[code]).toBeTruthy();
      expect(strings('tr').issue[code]).not.toBe(strings('en').issue[code]);
    }
  });

  it('the timing hint matches the wording the product asked for', () => {
    expect(strings('en').uncertainty.timing).toBe('Not sure about the timing');
    expect(strings('tr').uncertainty.timing).toBe('Zamanlamadan emin değilim');
  });

  it('issueMessage finds the message for a field, or null', () => {
    const issues = [{ field: 'title' as const, code: 'title_required' as const }];
    expect(issueMessage(issues, 'title', 'en')).toBe('Give it a title');
    expect(issueMessage(issues, 'title', 'tr')).toBe('Bir başlık yaz');
    expect(issueMessage(issues, 'when', 'en')).toBeNull();
    expect(issueMessage(undefined, 'title', 'en')).toBeNull();
  });
});
