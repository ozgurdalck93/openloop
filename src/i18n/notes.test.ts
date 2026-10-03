import { describe, expect, it } from 'vitest';

import { FLOW_1, createWorldFactory } from '../../test/harness';
import { localizeNote, localizeWhen } from './notes';

describe('localizeWhen', () => {
  it('translates day, weekday and month words and keeps the clock', () => {
    expect(localizeWhen('Today · 15:00', 'tr')).toBe('Bugün · 15:00');
    expect(localizeWhen('Tomorrow · 09:00', 'tr')).toBe('Yarın · 09:00');
    expect(localizeWhen('Tuesday · 10:00', 'tr')).toBe('Salı · 10:00');
    expect(localizeWhen('12 Oct · 09:00', 'tr')).toBe('12 Eki · 09:00');
    expect(localizeWhen('no date set', 'tr')).toBe('tarih yok');
  });
  it('is the identity in English', () => {
    expect(localizeWhen('Tuesday · 10:00', 'en')).toBe('Tuesday · 10:00');
  });
});

describe('localizeNote', () => {
  const cases: [string, string][] = [
    ['Not relevant anymore', 'Artık geçerli değil'],
    ['Marked done', 'Tamamlandı olarak işaretlendi'],
    ['Review Tuesday · 10:00', 'Kontrol: Salı · 10:00'],
    ['Until Today · 10:15', 'Erteleme: Bugün · 10:15'],
    ['Moved to Friday · 15:00', 'Taşındı: Cuma · 15:00'],
    ['Next check: Tomorrow · 09:00', 'Sonraki kontrol: Yarın · 09:00'],
    ['Now waiting: "HR reply"', 'Şimdi bekleniyor: "HR reply"'],
    ['After completing "Call HR"', '"Call HR" tamamlandıktan sonra'],
    ['"Call HR" was completed', '"Call HR" tamamlandı'],
    ['Follow-up: "Follow up with Ali"', 'Takip: "Follow up with Ali"'],
    ['Follow-up for "Ali reply"', '"Ali reply" için takip'],
    ['From "Zara refund"', '"Zara refund" kaydından'],
    ['"Follow up with Ali" done — back to waiting', '"Follow up with Ali" tamamlandı — yeniden beklemede'],
    ['"Follow up with Ali" set aside — back to waiting', '"Follow up with Ali" kenara bırakıldı — yeniden beklemede'],
    ['Changed: title, person or company', 'Değişti: başlık, kişi veya kurum'],
    ['Repeats weekly — next Monday · 09:00', 'Haftalık tekrar — sonraki: Pazartesi · 09:00'],
  ];
  for (const [en, tr] of cases) {
    it(`"${en}"`, () => {
      expect(localizeNote(en, 'tr')).toBe(tr);
      expect(localizeNote(en, 'en')).toBe(en);
    });
  }

  it('keeps what the user said, untouched', () => {
    expect(localizeNote('Moved to Friday · 15:00 — “dişçiyi cumaya al”', 'tr')).toBe('Taşındı: Cuma · 15:00 — “dişçiyi cumaya al”');
  });
  it('passes unknown text through (e.g. something the user typed)', () => {
    expect(localizeNote('kendi notum', 'tr')).toBe('kendi notum');
  });
});

describe('every note the engine really writes gets translated', () => {
  const world = createWorldFactory();
  it('across a full session of actions, no English note is left in a Turkish timeline', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const dentist = await w.byTitle('Call dentist');
    const zara = await w.byTitle('Zara refund');

    await w.service.perform(hr.id, 'still_waiting');
    await w.service.perform(hr.id, 'follow_up');
    await w.service.perform(dentist.id, 'snooze_15');
    await w.service.perform(zara.id, 'got_reply');
    await w.service.edit(dentist.id, { title: 'Call the dentist', reviewAt: new Date(w.clock.now.getTime() + 86_400_000) });

    const notes: string[] = [];
    for (const loop of await w.loops()) {
      const bundle = await w.service.load(loop.id);
      for (const event of bundle?.events ?? []) if (event.note) notes.push(event.note);
    }
    expect(notes.length).toBeGreaterThan(5);
    const untranslated = notes.filter((n) => localizeNote(n, 'tr') === n);
    expect(untranslated).toEqual([]);
  });
});
