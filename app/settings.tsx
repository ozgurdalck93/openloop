import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { PRIVACY_URL, WRITE_REVIEW_URL } from '@/config/links';
import { Screen } from '@/components/Screen';
import { expoNotificationsApi } from '@/notifications/expoApi';
import { DEFAULT_QUIET_HOURS, type QuietHours } from '@/notifications/quietHours';
import { loadQuietHours, saveQuietHours } from '@/notifications/quietHoursStore';
import { useDatabase } from '@/store/database';
import { useLanguage } from '@/store/language';
import { useServices } from '@/store/services';
import { colors, hairline, radius, spacing } from '@/theme';

const two = (n: number) => String(n).padStart(2, '0');
const START_PRESETS = [20, 21, 22, 23] as const;
const END_PRESETS = [6, 7, 8, 9] as const;


/** Notification preferences. Today: quiet hours. */
export default function Settings() {
  const db = useDatabase();
  const { lang } = useLanguage();
  const { scheduler } = useServices();
  const tr = lang === 'tr';
  const [quiet, setQuiet] = useState<QuietHours>(DEFAULT_QUIET_HOURS);
  const [permission, setPermission] = useState<{ granted: boolean; canAskAgain: boolean } | null>(null);

  // The user can change this in iOS Settings while we're in the background, so re-read on return.
  useEffect(() => {
    if (!expoNotificationsApi.supported) return;
    let current = true;
    const refresh = () => void expoNotificationsApi.getPermission().then((p) => current && setPermission(p), () => undefined);
    refresh();
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  const allowNotifications = async () => {
    if (permission?.canAskAgain) {
      const granted = await expoNotificationsApi.requestPermission().catch(() => false);
      setPermission(await expoNotificationsApi.getPermission());
      // Reminders that couldn't be scheduled earlier (permission was missing) get scheduled now.
      if (granted) await scheduler.resyncAll(new Date(), lang).catch((error) => console.warn('Reminder resync failed', error));
    } else {
      void Linking.openSettings();
    }
  };

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

      {permission ? (
        <View style={styles.block}>
          <AppText variant="label" tone="muted">{tr ? 'BİLDİRİMLER' : 'NOTIFICATIONS'}</AppText>
          {permission.granted ? (
            <AppText testID="notif-on">{tr ? '✓ Bildirimler açık. Hatırlatmalar zamanı gelince görünür.' : '✓ Notifications are on. Reminders appear when their time comes.'}</AppText>
          ) : (
            <>
              <AppText tone="muted">
                {tr
                  ? 'Bildirimler kapalı, bu yüzden hatırlatmalar gelmez. Kayıtların yine de Ana ekranda görünür.'
                  : 'Notifications are off, so reminders won’t arrive. Your items still show on Home.'}
              </AppText>
              <Button
                testID="notif-allow"
                label={permission.canAskAgain ? (tr ? 'Bildirimlere izin ver' : 'Allow notifications') : tr ? 'iPhone Ayarlarını aç' : 'Open iPhone Settings'}
                onPress={() => void allowNotifications()}
              />
            </>
          )}
        </View>
      ) : null}

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
            <HourRow label={tr ? 'Başlangıç' : 'From'} hour={quiet.startHour} testID="quiet-start" presets={START_PRESETS} onPick={(h) => update({ ...quiet, startHour: h })} onStep={(d) => step('startHour', d)} />
            <HourRow label={tr ? 'Bitiş' : 'Until'} hour={quiet.endHour} testID="quiet-end" presets={END_PRESETS} onPick={(h) => update({ ...quiet, endHour: h })} onStep={(d) => step('endHour', d)} />
          </View>
        ) : null}
      </View>

      <View style={styles.block}>
        <AppText variant="label" tone="muted">{tr ? 'DİL' : 'LANGUAGE'}</AppText>
        <LanguageSwitch />
      </View>

      <View style={styles.block}>
        <AppText variant="label" tone="muted">{tr ? 'VERİLERİM' : 'MY DATA'}</AppText>
        <AppText tone="muted">
          {tr ? 'Her şey bu cihazda kalır. İstediğin zaman bir kopyasını dışa aktarabilirsin.' : 'Everything stays on this device. Export a copy whenever you like.'}
        </AppText>
        <Button testID="open-data" label={tr ? 'Verilerim ve yedek' : 'My data & backup'} variant="secondary" onPress={() => router.push('/data')} />
      </View>

      <View style={styles.block}>
        <AppText variant="label" tone="muted">{tr ? 'GİZLİLİK' : 'PRIVACY'}</AppText>
        <Button
          testID="open-privacy"
          label={tr ? 'Gizlilik Politikası' : 'Privacy Policy'}
          variant="secondary"
          onPress={() => void Linking.openURL(PRIVACY_URL).catch((error) => console.warn('Could not open the privacy policy', error))}
        />
      </View>

      <View style={styles.block}>
        <AppText variant="label" tone="muted">{tr ? 'UYGULAMA' : 'APP'}</AppText>
        <Button
          testID="rate-app"
          label={tr ? 'Uygulamayı değerlendir' : 'Rate OpenLoop'}
          variant="secondary"
          onPress={() => void Linking.openURL(WRITE_REVIEW_URL).catch((error) => console.warn('Could not open the App Store', error))}
        />
      </View>
    </Screen>
  );
}

interface HourRowProps {
  label: string;
  hour: number;
  testID: string;
  /** Common choices, one tap. The arrows stay for anything else. */
  presets: readonly number[];
  onPick: (hour: number) => void;
  onStep: (direction: 1 | -1) => void;
}

function HourRow({ label, hour, testID, presets, onPick, onStep }: HourRowProps) {
  return (
    <View style={styles.hourBlock}>
      <View style={styles.chips}>
        {presets.map((h) => (
          <Chip key={h} testID={`${testID}-preset-${h}`} label={`${two(h)}:00`} selected={hour === h} onPress={() => onPick(h)} />
        ))}
      </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing.xl, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowLabel: { width: 84 },
  times: { gap: spacing.lg, marginTop: spacing.sm },
  hourBlock: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
