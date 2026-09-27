import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { deleteLoop, insertLoop, listLoops } from '@/db/loops';
import type { Loop, LoopType } from '@/engine/types';
import { useDatabase } from '@/store/database';
import { useLastDevNotification } from '@/store/devNotificationLog';
import { useServices } from '@/store/services';
import { colors, hairline, radius, spacing, typography } from '@/theme';
import { newId } from '@/utils/id';

/**
 * DEV-ONLY Native Test Lab — exercises SQLite and expo-notifications directly, through the
 * SAME repository and scheduler code the app uses, so a pass here means the real wiring works.
 * Never linked from anywhere in a production build (the link on Home is behind `if (__DEV__)`,
 * which Metro strips from a production bundle) — but guard the screen itself too, in case
 * something ever links to it by mistake.
 */
export default function DevLab() {
  return __DEV__ ? <DevLabScreen /> : null;
}

const MARK = 'DEV TEST';
const CHECKLIST = [
  'A. App açılıyor mu?',
  'B. SQLite migration açılıyor mu? (aşağıda bir hata banner’ı yoksa evet)',
  'C. Capture → Review → Home çalışıyor mu? (bu ekranı değil, normal akışı dene)',
  'D. Uygulamayı tamamen kapatıp aç: "Read test loop" hâlâ listeliyor mu?',
  'E. "Request permission" izin ekranını gösteriyor mu?',
  'F. 10 saniyelik bildirim gerçekten geliyor mu?',
  'G. TASK bildiriminde Done / 15 min later / Later today butonları görünüyor mu?',
  'H. WAITING bildiriminde Still waiting / Got a reply / Follow up butonları görünüyor mu?',
  'I. Bir butona basınca aşağıdaki "Notification response debug" doğru loop id’yi gösteriyor mu?',
  'J. Uygulamayı arka plana atıp geri getirince state (Home listesi) doğru mu?',
];

function makeTestLoop(type: LoopType, label: string, secondsOut: number | null): Loop {
  const now = new Date();
  const nextReviewAt = secondsOut === null ? null : new Date(now.getTime() + secondsOut * 1000).toISOString();
  return {
    id: newId(),
    captureId: null,
    type,
    status: type === 'waiting' ? 'waiting' : 'active',
    title: `${MARK} · ${label} · ${now.toLocaleTimeString()}`,
    rawContext: null,
    nextActionOwner: 'user',
    entityName: null,
    expectedEvent: type === 'waiting' ? 'a reply' : null,
    nextReviewAt,
    closingCondition: null,
    followUpPolicy: 'none',
    classificationConfidence: 1,
    timingConfidence: 1,
    entityConfidence: 1,
    parentLoopId: null,
    notificationId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    resolvedAt: null,
  };
}

function DevLabScreen() {
  const db = useDatabase();
  const { scheduler } = useServices();
  const [rows, setRows] = useState<Loop[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const lastResponse = useLastDevNotification();
  const notifSupported = Platform.OS !== 'web';

  const note = (line: string) => setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 24));
  const guarded = (label: string, fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch (error) {
      note(`✗ ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const refresh = async () => setRows((await listLoops(db)).filter((l) => l.title.startsWith(MARK)));

  const createTestLoop = guarded('Create test loop', async () => {
    const loop = makeTestLoop('task', 'plain', null);
    await insertLoop(db, loop);
    note(`Created "${loop.title}"`);
    await refresh();
  });

  const readTestLoop = guarded('Read test loop', async () => {
    await refresh();
    note(rows.length === 0 ? 'No DEV TEST loops in the database right now.' : `${rows.length} DEV TEST loop(s) in the database.`);
  });

  const restartMarker = guarded('Restart persistence test', async () => {
    const loop = makeTestLoop('task', 'RESTART MARKER', null);
    await insertLoop(db, loop);
    note(`Saved "${loop.title}". Now fully close the app (swipe it away, not just background), reopen it, come back here and tap "Read test loop".`);
    await refresh();
  });

  const deleteTestData = guarded('Delete test data', async () => {
    const current = (await listLoops(db)).filter((l) => l.title.startsWith(MARK));
    for (const loop of current) await deleteLoop(db, loop.id);
    if (notifSupported) {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const ids = new Set(current.map((l) => l.id));
      for (const s of scheduled) {
        const loopId = (s.content.data as { loopId?: string } | null)?.loopId;
        if (loopId && ids.has(loopId)) await Notifications.cancelScheduledNotificationAsync(s.identifier);
      }
    }
    note(`Deleted ${current.length} test loop(s) and any of their scheduled notifications.`);
    await refresh();
  });

  const requestPermission = guarded('Request permission', async () => {
    const granted = await scheduler.ensurePermission();
    note(granted ? '✓ Permission granted' : '✗ Permission NOT granted');
  });

  const scheduleTest = (type: LoopType) =>
    guarded(`Schedule ${type}`, async () => {
      const loop = makeTestLoop(type, `notify ${type}`, 10);
      await insertLoop(db, loop);
      await scheduler.syncLoops([loop], new Date());
      note(`Scheduled a ${type.toUpperCase()} notification for ~10s from now — loop ${loop.id.slice(0, 8)}…`);
      await refresh();
    });

  const listScheduled = guarded('List scheduled notifications', async () => {
    if (!notifSupported) return note('Not supported on web.');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    note(
      scheduled.length === 0
        ? 'No scheduled notifications.'
        : `${scheduled.length} scheduled:\n` + scheduled.map((s) => `  • ${s.content.title} (${s.content.categoryIdentifier ?? 'no category'})`).join('\n'),
    );
  });

  const cancelTestNotifications = guarded('Cancel test notifications', async () => {
    if (!notifSupported) return note('Not supported on web.');
    const testIds = new Set((await listLoops(db)).filter((l) => l.title.startsWith(MARK)).map((l) => l.id));
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    let cancelled = 0;
    for (const s of scheduled) {
      const loopId = (s.content.data as { loopId?: string } | null)?.loopId;
      if (loopId && testIds.has(loopId)) {
        await Notifications.cancelScheduledNotificationAsync(s.identifier);
        cancelled += 1;
      }
    }
    note(`Cancelled ${cancelled} test notification(s).`);
  });

  return (
    <Screen scroll>
      <AppText variant="title">Native Test Lab</AppText>
      <AppText tone="muted" style={styles.sub}>
        DEV build only — never shown in production. Exercises the real database and scheduler code.
      </AppText>

      <Section title="SQLite">
        <Row>
          <Button label="Create test loop" variant="secondary" onPress={createTestLoop} />
          <Button label="Read test loop" variant="secondary" onPress={readTestLoop} />
        </Row>
        <Row>
          <Button label="Restart persistence test" variant="secondary" onPress={restartMarker} />
          <Button label="Delete test data" variant="secondary" onPress={deleteTestData} />
        </Row>
        {rows.length > 0 ? (
          <View style={styles.list}>
            {rows.map((r) => (
              <AppText key={r.id} variant="caption" tone="muted">
                {r.title} — {r.status} — next: {r.nextReviewAt ?? '—'}
              </AppText>
            ))}
          </View>
        ) : null}
      </Section>

      <Section title="Notifications">
        {!notifSupported ? <AppText tone="muted">Not supported on web — try this on the phone build.</AppText> : null}
        <Row>
          <Button label="Request permission" variant="secondary" onPress={requestPermission} disabled={!notifSupported} />
        </Row>
        <Row>
          <Button label="TASK in 10s" variant="secondary" onPress={scheduleTest('task')} disabled={!notifSupported} />
          <Button label="WAITING in 10s" variant="secondary" onPress={scheduleTest('waiting')} disabled={!notifSupported} />
          <Button label="RETURN_LATER in 10s" variant="secondary" onPress={scheduleTest('return_later')} disabled={!notifSupported} />
        </Row>
        <Row>
          <Button label="List scheduled" variant="secondary" onPress={listScheduled} disabled={!notifSupported} />
          <Button label="Cancel test notifications" variant="secondary" onPress={cancelTestNotifications} disabled={!notifSupported} />
        </Row>
      </Section>

      <Section title="Notification response debug">
        {lastResponse ? (
          <View style={styles.responseBox}>
            <AppText variant="caption" tone="muted">loop id: {lastResponse.loopId ?? '(none)'}</AppText>
            <AppText variant="caption" tone="muted">category: {lastResponse.categoryIdentifier ?? '(none)'}</AppText>
            <AppText variant="caption" tone="muted">action: {lastResponse.actionId}</AppText>
            <AppText variant="caption" tone="muted">at: {lastResponse.at}</AppText>
          </View>
        ) : (
          <AppText tone="muted">No response received yet — tap a notification or one of its action buttons on the phone.</AppText>
        )}
      </Section>

      <Section title="Physical Android checklist">
        {CHECKLIST.map((line) => (
          <AppText key={line} variant="caption" tone="muted" style={styles.checkItem}>
            {line}
          </AppText>
        ))}
      </Section>

      <Section title="Log">
        {log.length === 0 ? (
          <AppText tone="muted">Nothing yet — tap a button above.</AppText>
        ) : (
          log.map((line, i) => (
            <AppText key={i} variant="caption" tone="muted" style={styles.logLine}>
              {line}
            </AppText>
          ))
        )}
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label" tone="muted">
        {title.toUpperCase()}
      </AppText>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  sub: { marginTop: spacing.xs },
  section: { marginTop: spacing.xl, gap: spacing.sm },
  sectionBody: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { marginTop: spacing.xs, gap: spacing.xs / 2 },
  responseBox: { gap: spacing.xs / 2 },
  checkItem: { lineHeight: typography.caption.lineHeight },
  logLine: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
