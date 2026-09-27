import type { Dispatch } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { uncertaintiesOf, type Issue } from '@/engine/candidateEdit';
import { LOOP_TYPES } from '@/engine/types';
import { issueMessage, strings, typeLabel, type UiLang } from '@/i18n';
import type { DraftAction, DraftItem } from '@/store/reviewDraft';
import { colors, hairline, loopTypeMeta, radius, spacing } from '@/theme';

import { AppText } from './AppText';
import { Chip } from './Chip';
import { TextField } from './TextField';
import { WhenPicker } from './WhenPicker';

interface CandidateEditorProps {
  item: DraftItem;
  now: Date;
  lang: UiLang;
  /** Blocking problems for this card; only shown once the user has tried to keep. */
  issues: Issue[] | undefined;
  showIssues: boolean;
  dispatch: Dispatch<DraftAction>;
}

/**
 * One editable candidate. Everything the parser guessed can be changed: type, title,
 * person/company, review date and time, and the note. Fields it was unsure about say
 * so — calmly — until the user has touched them.
 */
export function CandidateEditor({ item, now, lang, issues, showIssues, dispatch }: CandidateEditorProps) {
  const { key, candidate: c, edited } = item;
  const s = strings(lang);
  const unsure = uncertaintiesOf(c, edited);
  const visibleIssues = showIssues ? issues : undefined;
  const hint = (code: (typeof unsure)[number]) => (unsure.includes(code) ? s.uncertainty[code] : null);
  const timingHint = hint('payday') ?? hint('timing') ?? hint('suggested');
  const showQuestion = c.needsUserConfirmation && c.confirmationQuestion && !edited.includes('type');

  return (
    <View style={styles.card} testID={`card-${key}`}>
      <View style={styles.header}>
        <View style={styles.types}>
          {LOOP_TYPES.map((type) => {
            const meta = loopTypeMeta[type];
            return (
              <Chip
                key={type}
                testID={`type-${key}-${type}`}
                label={typeLabel(type, lang)}
                selected={c.type === type}
                color={meta.color}
                tint={meta.tint}
                onPress={() => dispatch({ type: 'retype', key, to: type, now })}
              />
            );
          })}
        </View>
        <Pressable
          testID={`remove-${key}`}
          accessibilityRole="button"
          accessibilityLabel={`${s.remove} ${c.title}`}
          onPress={() => dispatch({ type: 'remove', key })}
          hitSlop={8}
        >
          <AppText variant="caption" tone="muted">
            {s.remove}
          </AppText>
        </Pressable>
      </View>

      {hint('type') ? (
        <AppText variant="caption" tone="accent">
          {hint('type')}
        </AppText>
      ) : null}
      {showQuestion ? (
        <AppText variant="caption" tone="muted">
          {c.confirmationQuestion}
        </AppText>
      ) : null}

      <TextField
        testID={`title-${key}`}
        label={s.field.title}
        value={c.title}
        onChangeText={(value) => dispatch({ type: 'title', key, value })}
        error={issueMessage(visibleIssues, 'title', lang)}
        autoCapitalize="sentences"
      />

      <TextField
        testID={`entity-${key}`}
        label={s.field.person}
        value={c.entityName ?? ''}
        onChangeText={(value) => dispatch({ type: 'entity', key, value })}
        hint={hint('name')}
      />

      <View style={styles.when}>
        <AppText variant="label" tone="muted">
          {s.field.when.toUpperCase()}
        </AppText>
        {c.type === 'reference' ? (
          <AppText tone="muted">{s.noReminder}</AppText>
        ) : (
          <>
            {c.timingLabel && c.timingSource === 'suggested' ? (
              <AppText variant="caption" tone="soft">
                {c.timingLabel}
              </AppText>
            ) : null}
            <WhenPicker
              testID={`when-${key}`}
              value={c.nextReviewAt ? new Date(c.nextReviewAt) : null}
              now={now}
              lang={lang}
              labels={{ date: s.field.date, time: s.field.time }}
              onChange={(when) => dispatch({ type: 'when', key, when })}
            />
            {issueMessage(visibleIssues, 'when', lang) ? (
              <AppText variant="caption" style={{ color: colors.danger }}>
                {issueMessage(visibleIssues, 'when', lang)}
              </AppText>
            ) : timingHint ? (
              <AppText variant="caption" tone="accent">
                {timingHint}
              </AppText>
            ) : null}
          </>
        )}
      </View>

      <TextField
        testID={`note-${key}`}
        label={s.field.note}
        value={c.rawContext ?? ''}
        onChangeText={(value) => dispatch({ type: 'context', key, value })}
        error={issueMessage(visibleIssues, 'context', lang)}
        multiline
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  types: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  when: { gap: spacing.sm },
});
