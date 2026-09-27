import { router } from 'expo-router';
import { useReducer, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { CandidateEditor } from '@/components/CandidateEditor';
import { Chip } from '@/components/Chip';
import { FlashBanner } from '@/components/FlashBanner';
import { Screen } from '@/components/Screen';
import type { Loop } from '@/engine/types';
import { CandidateValidationError } from '@/engine/transitions';
import { strings, type Strings, type UiLang } from '@/i18n';
import type { LoopService } from '@/services/loopService';
import { flash } from '@/store/flash';
import { useLanguage } from '@/store/language';
import { clearPendingReview, getPendingReview } from '@/store/pendingReview';
import { draftCandidates, draftReducer, initDraft, validateDraft } from '@/store/reviewDraft';
import { useLoopService } from '@/store/services';
import { colors, hairline, spacing } from '@/theme';
import { applyProposal } from '@/updates/apply';
import { rescheduleTarget } from '@/updates/interpret';
import type { UpdateProposal } from '@/updates/types';
import { formatWhen } from '@/utils/format';

/**
 * Review: "Here's what's still open". Every candidate is editable — type, title,
 * person/company, review date and time, note — and can be removed. Fields the parser
 * was unsure about say so until the user has touched them. Nothing is saved until
 * "Keep track of these", and nothing invalid can be.
 */
export default function Review() {
  const service = useLoopService();
  const { lang } = useLanguage();
  const s = strings(lang);
  const [pending] = useState(getPendingReview);
  const [draft, dispatch] = useReducer(draftReducer, pending?.candidates ?? [], initDraft);
  const [now] = useState(() => new Date());
  const [checkedAt, setCheckedAt] = useState(now);
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!pending) {
    // Reached without a capture (e.g. the app was restarted on this screen): start over calmly.
    return (
      <Screen>
        <AppText variant="heading">{s.review.nothingToReview}</AppText>
        <Button label={s.back} onPress={() => router.replace('/')} style={styles.back} />
      </Screen>
    );
  }

  const problems = validateDraft(draft, checkedAt);
  const blocked = Object.keys(problems).length > 0;

  const keep = async () => {
    if (saving || draft.items.length === 0) return;
    const at = new Date();
    setCheckedAt(at);
    if (Object.keys(validateDraft(draft, at)).length > 0) {
      setShowIssues(true);
      return;
    }
    setSaving(true);
    try {
      // The service stores everything atomically, then (in context) asks for notification permission
      // and schedules reminders. This screen only collects what the user decided.
      const outcome = await service.keep(draftCandidates(draft), pending.rawText);
      clearPendingReview();
      flash(outcome.message);
      router.dismissAll();
    } catch (error) {
      if (error instanceof CandidateValidationError) setShowIssues(true);
      else console.warn('Could not keep these loops', error);
      setSaving(false);
    }
  };

  const discard = () => {
    clearPendingReview();
    router.dismissAll();
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        scroll
        footer={
          <>
            {showIssues && blocked ? (
              <AppText variant="caption" style={{ color: colors.danger }} testID="fix-first">
                {s.fixFirst}
              </AppText>
            ) : null}
            <Button label={s.review.keepCta} onPress={keep} disabled={saving || draft.items.length === 0} />
            <Button label={s.review.notNowCta} variant="secondary" onPress={discard} />
          </>
        }
      >
        <AppText variant="title">{s.review.title}</AppText>
        <FlashBanner />

        {pending.updates.length > 0 || pending.unmatched.length > 0 ? (
          <View style={styles.list}>
            {pending.updates.map((proposal) => (
              <UpdateCard key={proposal.id} proposal={proposal} lang={lang} s={s} service={service} />
            ))}
            {pending.unmatched.map((said, index) => (
              <View key={`um${index}`} style={styles.clarification}>
                <AppText tone="muted">{s.updates.unmatched(said)}</AppText>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.list}>
          {draft.items.map((item) => (
            <CandidateEditor
              key={item.key}
              item={item}
              now={now}
              lang={lang}
              issues={problems[item.key]}
              showIssues={showIssues}
              dispatch={dispatch}
            />
          ))}

          {draft.items.length === 0 ? <AppText tone="muted">{s.nothingLeft}</AppText> : null}

          {pending.clarifications.map((q, index) => (
            <View key={`q${index}`} style={styles.clarification}>
              <AppText tone="muted">“{q.text}”</AppText>
              <AppText>{q.question}</AppText>
              <AppText variant="caption" tone="muted">
                {s.review.noGuessDisclaimer}
              </AppText>
            </View>
          ))}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** The question a proposal asks about the loop it would change, in the user's language. */
function questionFor(s: Strings, proposal: UpdateProposal, loop: Loop, now: Date): string {
  switch (proposal.intent) {
    case 'resolve':
      return s.updates.resolved(loop.title);
    case 'still_waiting':
      return s.updates.stillWaiting(loop.title);
    case 'dismiss':
      return s.updates.dismiss(loop.title);
    case 'reschedule': {
      const at = rescheduleTarget(proposal.when, loop, now);
      return at ? s.updates.reschedule(loop.title, formatWhen(at, now)) : s.updates.noTime;
    }
  }
}

type UpdateCardPhase = 'idle' | 'choosing' | 'busy' | 'done' | 'skipped';

/**
 * One natural-language update to a loop the user already has ("Refund came"). Never applied
 * silently: a high-confidence match still asks to confirm; anything less asks which loop, or
 * lets the user skip it. Applying goes through the same `LoopService` every button does, so it
 * is transactional and lands in the loop's timeline in the user's own words.
 */
function UpdateCard({ proposal, lang, s, service }: { proposal: UpdateProposal; lang: UiLang; s: Strings; service: LoopService }) {
  const [now] = useState(() => new Date());
  const [phase, setPhase] = useState<UpdateCardPhase>(proposal.confidence === 'high' ? 'idle' : 'choosing');
  const top = proposal.candidates[0]?.loop ?? null;
  if (!top) return null; // nothing this could even apply to

  const apply = async (loop: Loop) => {
    setPhase('busy');
    try {
      const outcome = await applyProposal(service, proposal, loop, new Date());
      flash(outcome.message);
      setPhase('done');
    } catch (error) {
      console.warn('Could not apply update', error);
      setPhase(proposal.confidence === 'high' ? 'idle' : 'choosing');
    }
  };

  return (
    <View style={styles.clarification} testID={`update-${proposal.id}`}>
      <AppText tone="muted">“{proposal.said}”</AppText>

      {phase === 'done' || phase === 'skipped' ? (
        <AppText variant="caption" tone="muted">
          {phase === 'done' ? `✓ ${s.updates.confirm}` : s.updates.skip}
        </AppText>
      ) : phase === 'choosing' ? (
        <>
          <AppText>{s.updates.which}</AppText>
          <View style={styles.chips}>
            {proposal.candidates.map((c) => (
              <Chip key={c.loop.id} label={c.loop.title} onPress={() => apply(c.loop)} testID={`update-pick-${c.loop.id}`} />
            ))}
            <Chip label={s.updates.skip} onPress={() => setPhase('skipped')} testID={`update-skip-${proposal.id}`} />
          </View>
        </>
      ) : (
        <>
          <AppText>{questionFor(s, proposal, top, now)}</AppText>
          <View style={styles.chips}>
            <Button
              label={s.updates.confirm}
              onPress={() => apply(top)}
              disabled={phase === 'busy'}
              testID={`update-confirm-${proposal.id}`}
            />
            {proposal.candidates.length > 1 ? (
              <Button
                label={s.updates.chooseAnother}
                variant="secondary"
                onPress={() => setPhase('choosing')}
                disabled={phase === 'busy'}
                testID={`update-more-${proposal.id}`}
              />
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  back: { marginTop: spacing.lg },
  list: { marginTop: spacing.xl, gap: spacing.md },
  clarification: {
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: 16,
    borderWidth: hairline,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
});
