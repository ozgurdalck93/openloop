import { useMemo, useState } from 'react';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { WhenPicker } from '@/components/WhenPicker';
import { waitingDefaultsFor } from '@/engine/suggestions';
import type { WaitingOptions } from '@/engine/transitions';
import type { Loop } from '@/engine/types';
import { strings, type UiLang } from '@/i18n';
import { colors } from '@/theme';

interface DoneSheetProps {
  task: Loop;
  now: Date;
  lang: UiLang;
  busy: boolean;
  onClose: () => void;
  /** "Yes, done". */
  onEnds: () => void;
  /** "I'm waiting for something" — with what the user filled in. */
  onWaiting: (options: WaitingOptions) => void;
}

/**
 * The most important transition in the product. Finishing a TASK is not always the end of the story:
 * "Send the documents" → done → but now you are WAITING for a reply. So we ask, calmly, and if the
 * answer is "I'm waiting" we capture who, what and when — pre-filled, all editable.
 * Mount it only while open: it seeds its form from the task on mount.
 */
export function DoneSheet({ task, now, lang, busy, onClose, onEnds, onWaiting }: DoneSheetProps) {
  const defaults = useMemo(() => waitingDefaultsFor(task, now, lang), [task, now, lang]);
  const [step, setStep] = useState<'ask' | 'waiting'>('ask');
  const [entity, setEntity] = useState(defaults.entityName ?? '');
  const [expected, setExpected] = useState(defaults.expectedEvent);
  const [reviewAt, setReviewAt] = useState<Date>(defaults.reviewAt);
  const s = strings(lang);
  // Judged against when the screen loaded; the engine checks again against the real clock on submit.
  const passed = reviewAt.getTime() <= now.getTime();

  return (
    <BottomSheet visible onClose={onClose} testID="done-sheet" title={step === 'ask' ? s.prompts.doneSheetTitle : s.sheets.done.waitingTitle}>
      {step === 'ask' ? (
        <>
          <AppText tone="muted">{task.title}</AppText>
          <Button testID="done-yes" label={s.prompts.doneSheetYes} onPress={onEnds} disabled={busy} />
          <Button
            testID="done-waiting"
            label={s.prompts.doneSheetWaiting}
            variant="secondary"
            onPress={() => setStep('waiting')}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <TextField
            testID="waiting-entity"
            label={s.sheets.done.who}
            value={entity}
            onChangeText={setEntity}
            placeholder={s.sheets.done.whoPlaceholder}
          />
          <TextField
            testID="waiting-expected"
            label={s.sheets.done.expecting}
            value={expected}
            onChangeText={setExpected}
            placeholder={s.sheets.done.expectingPlaceholder}
          />
          <AppText variant="label" tone="muted">
            {s.field.when.toUpperCase()}
          </AppText>
          <WhenPicker testID="waiting-when" value={reviewAt} now={now} lang={lang} labels={{ date: s.field.date, time: s.field.time }} onChange={setReviewAt} />
          {passed ? (
            <AppText variant="caption" style={{ color: colors.danger }} testID="waiting-time-error">
              {s.issue.when_passed}
            </AppText>
          ) : null}
          <Button
            testID="waiting-start"
            label={s.sheets.done.start}
            onPress={() => onWaiting({ entityName: entity, expectedEvent: expected, reviewAt })}
            disabled={busy || passed}
          />
          <Button testID="waiting-back" label={s.back} variant="secondary" onPress={() => setStep('ask')} disabled={busy} />
        </>
      )}
    </BottomSheet>
  );
}
