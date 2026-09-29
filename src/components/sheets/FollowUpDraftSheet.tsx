import { useState } from 'react';
import { Share } from 'react-native';

import type { Loop } from '@/engine/types';
import { strings, type UiLang } from '@/i18n';

import { AppText } from '../AppText';
import { BottomSheet } from '../BottomSheet';
import { Button } from '../Button';
import { TextField } from '../TextField';

interface FollowUpDraftSheetProps {
  loop: Loop;
  lang: UiLang;
  busy: boolean;
  onClose: () => void;
  /** Creates the linked task only. Sending a message remains entirely with the user. */
  onCreate: (draft: string) => void;
}

function initialDraft(loop: Loop, lang: UiLang): string {
  const entity = loop.entityName || (lang === 'tr' ? 'merhaba' : 'there');
  const subject = loop.expectedEvent || loop.title;
  return lang === 'tr'
    ? `Merhaba ${entity}, ${subject} ile ilgili kısa bir takip yapmak istedim. Uygun olduğunda bir güncelleme paylaşabilir misin? Teşekkürler.`
    : `Hi ${entity}, I wanted to follow up about ${subject}. Could you share an update when you have a moment? Thank you.`;
}

export function FollowUpDraftSheet({ loop, lang, busy, onClose, onCreate }: FollowUpDraftSheetProps) {
  const s = strings(lang).followUpDraft;
  const [draft, setDraft] = useState(() => initialDraft(loop, lang));
  const entity = loop.entityName || loop.title;
  return (
    <BottomSheet visible onClose={onClose} title={s.title} testID="follow-up-draft-sheet">
      <AppText tone="muted">{s.intro(entity)}</AppText>
      <TextField label={s.label} value={draft} onChangeText={setDraft} multiline />
      <Button
        label={lang === 'tr' ? 'Mesajı paylaş' : 'Share message'}
        variant="secondary"
        disabled={!draft.trim()}
        onPress={() => void Share.share({ message: draft.trim() })}
      />
      <Button label={s.create} disabled={busy || !draft.trim()} onPress={() => onCreate(draft.trim())} />
      <Button label={s.cancel} variant="secondary" disabled={busy} onPress={onClose} />
    </BottomSheet>
  );
}
