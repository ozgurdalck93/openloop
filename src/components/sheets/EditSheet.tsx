import { useState } from 'react';

import { Button } from '@/components/Button';
import { BottomSheet } from '@/components/BottomSheet';
import { TextField } from '@/components/TextField';
import { WhenPicker } from '@/components/WhenPicker';
import { isSteppedAside, type LoopEdits } from '@/engine/transitions';
import type { Loop } from '@/engine/types';
import { strings, type UiLang } from '@/i18n';
import { colors } from '@/theme';
import { AppText } from '@/components/AppText';

interface EditSheetProps {
  loop: Loop;
  now: Date;
  lang: UiLang;
  busy: boolean;
  onClose: () => void;
  onSave: (edits: LoopEdits) => void;
}

/** Edit an existing loop: words, person/company, and (unless it is a note) when it comes back. */
export function EditSheet({ loop, now, lang, busy, onClose, onSave }: EditSheetProps) {
  const s = strings(lang);
  const [title, setTitle] = useState(loop.title);
  const [entity, setEntity] = useState(loop.entityName ?? '');
  const [note, setNote] = useState(loop.rawContext ?? '');
  const [reviewAt, setReviewAt] = useState<Date | null>(loop.nextReviewAt ? new Date(loop.nextReviewAt) : null);

  const canSchedule = loop.type !== 'reference' && !isSteppedAside(loop);
  const originalIso = loop.nextReviewAt;
  const timeChanged = reviewAt !== null && reviewAt.toISOString() !== originalIso;
  const titleMissing = title.trim() === '';
  // Judged against when the screen loaded; the engine checks again against the real clock on save.
  const timePassed = timeChanged && reviewAt.getTime() <= now.getTime();

  return (
    <BottomSheet visible onClose={onClose} testID="edit-sheet" title={s.sheets.edit.title}>
      <TextField
        testID="edit-title"
        label={s.field.title}
        value={title}
        onChangeText={setTitle}
        error={titleMissing ? s.issue.title_required : null}
      />
      <TextField testID="edit-entity" label={s.field.person} value={entity} onChangeText={setEntity} />
      {canSchedule ? (
        <>
          <AppText variant="label" tone="muted">
            {s.field.when.toUpperCase()}
          </AppText>
          <WhenPicker testID="edit-when" value={reviewAt} now={now} lang={lang} labels={{ date: s.field.date, time: s.field.time }} onChange={setReviewAt} />
          {timePassed ? (
            <AppText variant="caption" style={{ color: colors.danger }} testID="edit-time-error">
              {s.issue.when_passed}
            </AppText>
          ) : null}
        </>
      ) : null}
      <TextField testID="edit-note" label={s.field.note} value={note} onChangeText={setNote} multiline />
      <Button
        testID="edit-save"
        label={s.sheets.edit.save}
        disabled={busy || titleMissing || timePassed}
        onPress={() =>
          onSave({
            title,
            entityName: entity,
            rawContext: note,
            // Only send a time the user actually changed: an overdue loop's old time is history, not a request.
            ...(timeChanged && reviewAt ? { reviewAt } : {}),
          })
        }
      />
      <Button testID="edit-cancel" label={s.sheets.edit.cancel} variant="secondary" onPress={onClose} disabled={busy} />
    </BottomSheet>
  );
}
