import { useState } from 'react';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { WhenPicker } from '@/components/WhenPicker';
import { snoozeOptions } from '@/engine/suggestions';
import { strings, type UiLang } from '@/i18n';
import { colors } from '@/theme';
import { seedWhen } from '@/utils/whenEdit';

interface SnoozeSheetProps {
  title: string;
  now: Date;
  lang: UiLang;
  busy: boolean;
  onClose: () => void;
  onPick: (until: Date) => void;
}

/** "Remind me later" / "Bring back later": a few sensible moments, or pick your own. */
export function SnoozeSheet({ title, now, lang, busy, onClose, onPick }: SnoozeSheetProps) {
  const [custom, setCustom] = useState<Date | null>(null);
  const s = strings(lang);
  const passed = custom !== null && custom.getTime() <= now.getTime();

  return (
    <BottomSheet visible onClose={onClose} testID="snooze-sheet" title={title}>
      {snoozeOptions(now, lang).map((option) => (
        <Button
          key={option.key}
          testID={`snooze-${option.key}`}
          label={option.label}
          variant="secondary"
          onPress={() => onPick(option.at)}
          disabled={busy}
        />
      ))}
      {custom === null ? (
        <Button testID="snooze-custom" label={s.sheets.snooze.pickCustom} variant="secondary" onPress={() => setCustom(seedWhen(now))} disabled={busy} />
      ) : (
        <>
          <WhenPicker testID="snooze-when" value={custom} now={now} lang={lang} labels={{ date: s.field.date, time: s.field.time }} onChange={setCustom} />
          {passed ? <AppText variant="caption" style={{ color: colors.danger }}>{s.issue.when_passed}</AppText> : null}
          <Button testID="snooze-custom-set" label={s.sheets.snooze.setCustom} onPress={() => onPick(custom)} disabled={busy || passed} />
        </>
      )}
    </BottomSheet>
  );
}
