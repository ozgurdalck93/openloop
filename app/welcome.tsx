import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { setSetting } from '@/db/settings';
import { useDatabase } from '@/store/database';
import { useLanguage } from '@/store/language';
import { colors, radius, spacing } from '@/theme';

export const ONBOARDED_KEY = 'onboarded';

const STEPS = {
  en: [
    { label: 'CAPTURE', title: 'Say what’s still open.', body: 'Type it in your own words, or tap the microphone button and speak. A task, something you’re waiting for, something you promised.' },
    { label: 'FOLLOW THROUGH', title: 'It comes back at the right time.', body: 'OpenLoop works out who owns the next move and reminds you quietly. If a reminder goes unanswered it only asks: “Still relevant?”' },
    { label: 'CLOSE THE LOOP', title: 'Close it when it’s done.', body: 'Nothing is ever sent for you. Your notes stay on this device, and you can export them any time.' },
  ],
  tr: [
    { label: 'YAKALA', title: 'Açık kalanı söyle.', body: 'Kendi cümlelerinle yaz ya da mikrofon düğmesine dokunup konuş. Bir görev, beklediğin bir şey, verdiğin bir söz.' },
    { label: 'TAKİP ET', title: 'Doğru zamanda geri gelir.', body: 'OpenLoop sıranın kimde olduğunu çıkarır ve seni sakin biçimde hatırlatır. Cevapsız kalan hatırlatma yalnızca “Hâlâ geçerli mi?” diye sorar.' },
    { label: 'KAPAT', title: 'Bitince kapat.', body: 'Senin adına hiçbir şey gönderilmez. Notların bu cihazda kalır, istediğin zaman dışa aktarabilirsin.' },
  ],
} as const;

/** Shown once, on first launch. Three short cards; "Skip" is always available. */
export default function Welcome() {
  const db = useDatabase();
  const { lang } = useLanguage();
  const [step, setStep] = useState(0);
  const steps = STEPS[lang];
  const current = steps[step];
  const last = step === steps.length - 1;

  const finish = () => {
    void setSetting(db, ONBOARDED_KEY, '1').catch((error) => console.warn('Could not save the welcome flag', error));
    router.replace('/');
  };

  return (
    <Screen
      footer={
        <>
          <Button testID="welcome-next" label={last ? (lang === 'tr' ? 'Başla' : 'Get started') : lang === 'tr' ? 'Devam' : 'Next'} onPress={last ? finish : () => setStep(step + 1)} />
          {last ? null : (
            <Pressable testID="welcome-skip" accessibilityRole="button" onPress={finish} style={styles.skip}>
              <AppText variant="caption" tone="muted">{lang === 'tr' ? 'Atla' : 'Skip'}</AppText>
            </Pressable>
          )}
        </>
      }
    >
      <View style={styles.body}>
        <AppText variant="title">OpenLoop</AppText>
        <View style={styles.dots}>
          {steps.map((_, index) => (
            <View key={index} style={[styles.dot, index === step && styles.dotActive]} />
          ))}
        </View>
        <AppText variant="label" tone="muted" style={styles.label}>{current.label}</AppText>
        <AppText variant="heading">{current.title}</AppText>
        <AppText tone="muted">{current.body}</AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: spacing.huge, gap: spacing.md },
  dots: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent },
  label: { marginTop: spacing.xl },
  skip: { alignSelf: 'center', padding: spacing.sm },
});
