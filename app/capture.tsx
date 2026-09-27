import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { getDeviceLocale, strings } from '@/i18n';
import { analyzeText, createParser } from '@/parser';
import { useLanguage } from '@/store/language';
import { setPendingReview } from '@/store/pendingReview';
import { useLoopService } from '@/store/services';
import { colors, hairline, radius, spacing, typography } from '@/theme';
import { interpretInput } from '@/updates/interpret';

export default function Capture() {
  const service = useLoopService();
  const { lang } = useLanguage();
  const s = strings(lang);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [nothingFound, setNothingFound] = useState(false);

  const makeSense = async () => {
    const raw = text.trim();
    if (!raw || busy) return;
    setBusy(true);
    setNothingFound(false);
    try {
      const now = new Date();
      const locale = getDeviceLocale();
      // First: does any of this update a loop we already have ("Refund came", "still no reply")?
      // Only the leftover text goes to the capture parser, so an update clause never also becomes a new loop.
      const openLoops = await service.listOpen();
      const interpretation = interpretInput(raw, openLoops, now, { locale });
      const result = await analyzeText(createParser({ locale }), interpretation.remainder, now);
      const nothingToShow =
        result.candidates.length === 0 &&
        result.clarifications.length === 0 &&
        interpretation.proposals.length === 0 &&
        interpretation.unmatched.length === 0;
      if (nothingToShow) {
        setNothingFound(true);
        return;
      }
      setPendingReview({ rawText: raw, ...result, updates: interpretation.proposals, unmatched: interpretation.unmatched });
      router.push('/review');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        footer={
          <>
            <Button
              label={busy ? s.capture.ctaBusy : s.capture.cta}
              onPress={makeSense}
              disabled={busy || text.trim().length === 0}
            />
            {/* Voice is planned; the button is visible per the UX flow but not wired yet. */}
            <Button label={s.capture.voiceCta} variant="secondary" disabled onPress={() => undefined} />
          </>
        }
      >
        <AppText variant="title">{s.capture.title}</AppText>
        <View style={styles.inputWrap}>
          <TextInput
            value={text}
            onChangeText={(value) => {
              setText(value);
              if (nothingFound) setNothingFound(false);
            }}
            placeholder={s.capture.placeholder}
            placeholderTextColor={colors.muted}
            multiline
            autoFocus
            textAlignVertical="top"
            style={styles.input}
          />
        </View>
        {nothingFound ? (
          <AppText tone="muted" style={styles.hint}>
            {s.capture.nothingFoundHint}
          </AppText>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  inputWrap: {
    flex: 1,
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  input: { flex: 1, color: colors.ink, ...typography.body },
  hint: { marginTop: spacing.md },
});
