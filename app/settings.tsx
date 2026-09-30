import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { DEFAULT_QUIET_HOURS, type QuietHours } from '@/notifications/quietHours';
import { loadQuietHours, saveQuietHours } from '@/notifications/quietHoursStore';
import { useDatabase } from '@/store/database';
import { useLanguage } from '@/store/language';
import { useServices } from '@/store/services';
import { colors, hairline, radius, spacing } from '@/theme';

const two = (n: number) => String(n).padStart(2, '0');

/** Notification preferences. Today: quiet hours. */
export default function Settings() {
  const db = useDatabase();
  const { lang } = useLanguage();
  const { scheduler } = useServices();
  const tr = lang === 'tr';
  const [quiet, setQuiet] = useState<QuietHours>(DEFAULT_QUIET_HOURS);

  useEffect(() => {
    let current = true;
    void loadQuietHours(db).then((value) => current && setQuiet(value));
    return () => {
      current = false;
    };
  }, [db]);

  // Saves, then re-plans every OS reminder so the new window applies to what is already scheduled.
  const update = (next: QuietHours) => {
    setQuiet(next);
    void saveQuietHours(db, next)
      .then(() => scheduler.resyncAll(new Date(), lang))
      .catch((error) => console.warn('Could not save quiet hours', error));
  };
  const step = (key: 'startHour' | 'endHour', direction: 1 | -1) =>
    update({ ...quiet, [key]: (quiet[key] + direction + 24) % 24 });

  return (
    <Screen scroll footer={<Button label={tr ? 'Geri' : 'Back'} variant="secondary" onPress={() => router.back()} />}>
      <AppText variant="title">{tr ? 'Ayarlar' : 'Settings'}</AppText>

      <View style={styles.block}>
        <AppText variant="label" tone="muted">{tr ? 'SESSİZ SAATLER' : 'QUIET HOURS'}</AppText>
        <AppText tone="muted">
          {tr
            ? 'Bu saatlerde bildirim gelmez. Sessiz saatlerde düşen hatırlatma, saatler bittiği an gelir. Kaydın kendi zamanı değişmez.'
            : 'No notifications arrive in this window. A reminder that falls inside it comes the moment quiet hours end. The item’s own time doesn’t change.'}
        </AppText>
        <View style={styles.row}>
          <Chip testID="quiet-off" label={tr ? 'Kapalı' : 'Off'} selected={!quiet.enabled} onPress={() => update({ ...quiet, enabled: false })} />
          <Chip testID="quiet-on" label={tr ? 'Açık' : 'On'} selected={quiet.enabled} onPress={() => update({ ...quiet, enabled: true })} />
        </View>

        {quiet.enabled ? (
          <View style={styles.times}>
            <HourRow label={tr ? 'Başlangıç' : 'From'} hour={quiet.startHour} testID="quiet-start" onStep={(d) => step('startHour', d)} />
            <HourRow label={tr ? 'Bitiş' : 'Until'} hour={quiet.endHour} testID="quiet-end" onStep={(d) => step('endHour', d)} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function HourRow({ label, hour, testID, onStep }: { label: string; hour: number; testID: string; onStep: (direction: 1 | -1) => void }) {
  return (
    <View style={styles.row}>
      <AppText tone="muted" style={styles.rowLabel}>{label}</AppText>
      <Pressable testID={`${testID}-prev`} accessibilityRole="button" accessibilityLabel={`${label} −1`} hitSlop={6} onPress={() => onStep(-1)} style={styles.arrow}>
        <AppText variant="bodyStrong">‹</AppText>
      </Pressable>
      <AppText testID={`${testID}-value`} variant="bodyStrong" style={styles.value}>{two(hour)}:00</AppText>
      <Pressable testID={`${testID}-next`} accessibilityRole="button" accessibilityLabel={`${label} +1`} hitSlop={6} onPress={() => onStep(1)} style={styles.arrow}>
        <AppText variant="bodyStrong">›</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.xl, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowLabel: { width: 84 },
  times: { gap: spacing.sm, marginTop: spacing.sm },
  arrow: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  value: { minWidth: 64, textAlign: 'center' },
});
