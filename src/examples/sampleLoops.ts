/**
 * What "Add an example" keeps: three short sentences, one per kind of thing OpenLoop tracks (a
 * reply we are waiting for, a task with a time, a refund that has not arrived). They go through
 * the normal parser and LoopService, so they are real, editable items — not a special demo mode.
 */
import type { UiLang } from '@/i18n';

export const SAMPLE_TEXT: Record<UiLang, string> = {
  en: "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.",
  tr: 'İK’ya e-posta attım, cevap bekliyorum. Yarın öğleden sonra dişçiyi aramamı hatırlat. Zara paketini iade ettim ama para iadesi gelmedi.',
};

/** Tap-to-fill suggestions on the Capture screen. */
export const CAPTURE_SUGGESTIONS: Record<UiLang, readonly string[]> = {
  en: [
    'I emailed Ali and I’m waiting for a reply',
    'Tomorrow afternoon remind me to call the dentist',
    'I promised Sara I’d send the photos on Friday',
  ],
  tr: [
    'Ali’ye e-posta attım, cevabını bekliyorum',
    'Yarın öğleden sonra dişçiyi aramamı hatırlat',
    'Sara’ya cuma günü fotoğrafları göndereceğime söz verdim',
  ],
};
