import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { FlashBanner } from '@/components/FlashBanner';
import { Screen } from '@/components/Screen';
import { DoneSheet } from '@/components/sheets/DoneSheet';
import { EditSheet } from '@/components/sheets/EditSheet';
import { SnoozeSheet } from '@/components/sheets/SnoozeSheet';
import { availableActions, timelineLabel, type LoopAction } from '@/engine/suggestions';
import { EngineError, type LoopEdits, type WaitingOptions } from '@/engine/transitions';
import { CLOSED_STATUSES, type Loop } from '@/engine/types';
import { strings, type Strings } from '@/i18n';
import type { ActionOutcome, LoopBundle } from '@/services/loopService';
import { ServiceError } from '@/services/loopService';
import { useChangeVersion } from '@/store/changes';
import { flash } from '@/store/flash';
import { useLanguage } from '@/store/language';
import { useLoopService } from '@/store/services';
import { colors, hairline, loopTypeMeta, radius, spacing } from '@/theme';
import { formatWhen } from '@/utils/format';

type Sheet = { kind: 'done' } | { kind: 'snooze'; action: 'remind_later' | 'bring_back_later' } | { kind: 'edit' } | null;

function stateLine(loop: Loop, s: Strings): string {
  const st = s.detail.state;
  if (loop.status === 'resolved') return st.resolved;
  if (loop.status === 'archived') return st.setAside;
  if (loop.type === 'waiting' && loop.status === 'active') return st.waitingFollowUpFirst;
  if (loop.status === 'snoozed') return st.snoozed;
  switch (loop.nextActionOwner) {
    case 'other':
      return loop.entityName ? st.waitingOn(loop.entityName) : st.waiting;
    case 'system':
      return st.comingUp;
    case 'none':
      return st.justRemembered;
    case 'user':
      return loop.type === 'return_later' ? st.broughtBack : st.needsYou;
  }
}

const statusWord = (loop: Loop, s: Strings): string =>
  loop.status === 'resolved'
    ? s.detail.status.resolved
    : loop.status === 'archived'
      ? s.detail.status.setAside
      : loop.type === 'waiting'
        ? s.detail.status.waiting
        : s.detail.status.open;

/**
 * Loop detail: what it is, what state it is in, what you can do next, and where it came from.
 * Every button hands an intent to `LoopService.perform` — this screen decides NOTHING about state
 * transitions, it only asks the questions the transitions need ("Does this end here?", "When?").
 */
export default function LoopDetail() {
  const { id, done } = useLocalSearchParams<{ id: string; done?: string }>();
  const service = useLoopService();
  const version = useChangeVersion();
  const { lang } = useLanguage();
  const s = strings(lang);
  const [state, setState] = useState<LoopBundle | 'missing' | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const startedDone = useRef(false);

  useEffect(() => {
    let current = true;
    service.load(id).then(
      (bundle) => {
        if (!current) return;
        setState(bundle ?? 'missing');
        setNow(new Date());
      },
      (error) => console.warn('Could not load loop', error),
    );
    return () => {
      current = false;
    };
  }, [service, id, version]);

  const bundle = state !== null && state !== 'missing' ? state : null;

  const leave = (outcome: ActionOutcome) => {
    flash(outcome.message);
    if (outcome.focusLoopId) router.replace({ pathname: '/loop/[id]', params: { id: outcome.focusLoopId } });
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /** Runs one service call with a busy guard and gentle error handling. */
  async function run(work: () => Promise<ActionOutcome>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await work();
      if (outcome.ask) {
        setSheet({ kind: 'done' });
        return;
      }
      setSheet(null);
      leave(outcome);
    } catch (error) {
      if (error instanceof EngineError || error instanceof ServiceError) {
        setSheet(null);
        setProblem(`${error.message}. ${s.detail.problem.showingLatest}`);
      } else {
        console.warn('Action failed', error);
        setProblem(s.detail.problem.somethingWentWrong);
      }
    } finally {
      setBusy(false);
    }
  }

  const onAction = (action: LoopAction) => {
    if (action === 'edit') return setSheet({ kind: 'edit' });
    if (action === 'remind_later' || action === 'bring_back_later') return setSheet({ kind: 'snooze', action });
    return void run(() => service.perform(id, action));
  };

  // A notification's "Done" opens this screen with ?done=1: start the Done flow once the loop is loaded.
  useEffect(() => {
    if (done === '1' && bundle && !startedDone.current) {
      startedDone.current = true;
      if (!CLOSED_STATUSES.includes(bundle.loop.status)) {
        service.perform(id, 'done').then(
          (outcome) => {
            if (outcome.ask) setSheet({ kind: 'done' });
            else leave(outcome);
          },
          (error) => setProblem(error instanceof Error ? error.message : s.detail.problem.couldNotStart),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per opened notification
  }, [done, bundle]);

  const actions = bundle ? availableActions(bundle.loop, lang) : [];
  const main = actions.filter((a) => a.group === 'main');
  const more = actions.filter((a) => a.group === 'more');

  return (
    <Screen scroll footer={<Button label={s.back} variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}>
      {state === null ? null : state === 'missing' || !bundle ? (
        <AppText variant="heading">{s.detail.notFound}</AppText>
      ) : (
        <View style={styles.gap}>
          <View style={[styles.badge, { backgroundColor: loopTypeMeta[bundle.loop.type].tint }]}>
            <AppText variant="label" style={{ color: loopTypeMeta[bundle.loop.type].color }}>
              {s.type[bundle.loop.type]}
            </AppText>
          </View>
          <AppText variant="title" testID="detail-title">
            {bundle.loop.title}
          </AppText>
          <AppText tone="soft" testID="detail-state">
            {stateLine(bundle.loop, s)}
          </AppText>
          <FlashBanner />
          {problem ? (
            <AppText variant="caption" style={{ color: colors.danger }} testID="detail-problem">
              {problem}
            </AppText>
          ) : null}

          {bundle.loop.nextReviewAt && !CLOSED_STATUSES.includes(bundle.loop.status) ? (
            <Field label={s.field.when} value={formatWhen(new Date(bundle.loop.nextReviewAt), now, lang)} />
          ) : null}

          {main.length > 0 ? (
            <View style={styles.actions} testID="actions">
              {main.map((action, index) => (
                <Button
                  key={action.id}
                  testID={`action-${action.id}`}
                  label={action.label}
                  variant={index === 0 ? 'primary' : 'secondary'}
                  disabled={busy}
                  onPress={() => onAction(action.id)}
                />
              ))}
              <View style={styles.more}>
                {more.map((action) => (
                  <Pressable key={action.id} testID={`action-${action.id}`} accessibilityRole="button" disabled={busy} onPress={() => onAction(action.id)} hitSlop={8}>
                    <AppText variant="caption" tone="muted">
                      {action.label}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : more.length > 0 ? (
            <View style={styles.more}>
              {more.map((action) => (
                <Pressable key={action.id} testID={`action-${action.id}`} accessibilityRole="button" disabled={busy} onPress={() => onAction(action.id)} hitSlop={8}>
                  <AppText variant="caption" tone="muted">
                    {action.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}

          {bundle.loop.entityName ? <Field label={s.field.person} value={bundle.loop.entityName} /> : null}
          {bundle.loop.rawContext ? <Field label={s.detail.context} value={bundle.loop.rawContext} /> : null}
          {bundle.loop.closingCondition ? <Field label={s.detail.closesWhen} value={bundle.loop.closingCondition} /> : null}

          {bundle.parent || bundle.children.length > 0 ? (
            <View style={styles.linked} testID="linked">
              <AppText variant="label" tone="muted">
                {s.detail.linked}
              </AppText>
              {bundle.parent ? (
                <LinkRow
                  label={s.detail.from(bundle.parent.title)}
                  status={statusWord(bundle.parent, s)}
                  onPress={() => router.push({ pathname: '/loop/[id]', params: { id: (bundle.parent as Loop).id } })}
                />
              ) : null}
              {bundle.children.map((child) => (
                <LinkRow
                  key={child.id}
                  label={child.title}
                  status={statusWord(child, s)}
                  onPress={() => router.push({ pathname: '/loop/[id]', params: { id: child.id } })}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.timeline} testID="timeline">
            <AppText variant="label" tone="muted">
              {s.detail.timeline}
            </AppText>
            {bundle.events.map((event) => (
              <View key={event.id} style={styles.event}>
                <AppText>{timelineLabel(event.eventType, lang)}</AppText>
                <AppText variant="caption" tone="muted">
                  {formatWhen(new Date(event.createdAt), now, lang)}
                  {event.note ? ` · ${event.note}` : ''}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      )}

      {bundle && sheet?.kind === 'done' ? (
        <DoneSheet
          task={bundle.loop}
          now={now}
          lang={lang}
          busy={busy}
          onClose={() => setSheet(null)}
          onEnds={() => void run(() => service.finishTask(id, { endsHere: true }))}
          onWaiting={(waiting: WaitingOptions) => void run(() => service.finishTask(id, { waiting }))}
        />
      ) : null}
      {bundle && sheet?.kind === 'snooze' ? (
        <SnoozeSheet
          title={sheet.action === 'bring_back_later' ? s.sheets.snooze.bringBackTitle : s.sheets.snooze.remindTitle}
          now={now}
          lang={lang}
          busy={busy}
          onClose={() => setSheet(null)}
          onPick={(until) => void run(() => service.perform(id, (sheet as { action: LoopAction }).action, { until }))}
        />
      ) : null}
      {bundle && sheet?.kind === 'edit' ? (
        <EditSheet
          loop={bundle.loop}
          now={now}
          lang={lang}
          busy={busy}
          onClose={() => setSheet(null)}
          onSave={(edits: LoopEdits) =>
            void run(async () => {
              const outcome = await service.edit(id, edits);
              return { ...outcome, focusLoopId: null };
            })
          }
        />
      ) : null}
    </Screen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <AppText variant="label" tone="muted">
        {label.toUpperCase()}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

function LinkRow({ label, status, onPress }: { label: string; status: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.linkRow}>
      <AppText style={styles.linkTitle}>{label}</AppText>
      <AppText variant="caption" tone="muted">
        {status}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.md },
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  more: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing.sm },
  field: { gap: spacing.xs, marginTop: spacing.sm },
  linked: { gap: spacing.sm, marginTop: spacing.lg },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  linkTitle: { flex: 1 },
  timeline: {
    marginTop: spacing.xl,
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  event: { gap: 2 },
});
