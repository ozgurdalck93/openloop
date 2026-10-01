import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { CAPTURE_SUGGESTIONS } from '@/examples/sampleLoops';
import { getDeviceLocale, strings, type Strings } from '@/i18n';
import { analyzeText, createHybridParser } from '@/parser';
import { useLanguage } from '@/store/language';
import { setPendingReview } from '@/store/pendingReview';
import { useLoopService } from '@/store/services';
import { colors, hairline, radius, spacing, typography } from '@/theme';
import { interpretInput } from '@/updates/interpret';
import { useVoiceCapture, type VoiceStatus } from '@/voice/useVoiceCapture';

const VOICE_HINT: Partial<Record<VoiceStatus, keyof Strings['capture']>> = {
  unavailable: 'voiceUnavailable',
  'permission-denied': 'voicePermissionDenied',
  error: 'voiceError',
};

export default function Capture() {
  const service = useLoopService();
  const { lang } = useLanguage();
  const s = strings(lang);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [nothingFound, setNothingFound] = useState(false);
  const voice = useVoiceCapture(lang);
  const voiceBaseText = useRef('');

  useEffect(() => {
    if (voice.status !== 'listening') return;
    setText(voiceBaseText.current ? `${voiceBaseText.current} ${voice.transcript}` : voice.transcript);
  }, [voice.status, voice.transcript]);

  const toggleVoice = () => {
    if (voice.status === 'listening') {
      voice.stop();
      return;
    }
    voiceBaseText.current = text.trim();
    setNothingFound(false);
    void voice.start();
  };

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
      const parser = createHybridParser({
        locale,
        aiBaseUrl: process.env.EXPO_PUBLIC_AI_PARSER_URL,
        aiClientKey: process.env.EXPO_PUBLIC_AI_PARSER_CLIENT_KEY,
      });
      const result = await analyzeText(parser, interpretation.remainder, now);
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
              disabled={busy || voice.status === 'listening' || text.trim().length === 0}
            />
            <Button
              label={voice.status === 'listening' ? s.capture.voiceListening : s.capture.voiceCta}
              variant="secondary"
              disabled={busy}
              onPress={toggleVoice}
            />
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
        {text.trim().length === 0 && voice.status !== 'listening' ? (
          <View style={styles.suggestions}>
            <AppText variant="label" tone="muted">{lang === 'tr' ? 'ÖRNEKLER — DOKUN' : 'TRY ONE — TAP'}</AppText>
            {CAPTURE_SUGGESTIONS[lang].map((sentence) => (
              <Pressable key={sentence} accessibilityRole="button" testID="capture-suggestion" onPress={() => setText(sentence)} style={styles.suggestion}>
                <AppText tone="muted">{sentence}</AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
        {nothingFound ? (
          <AppText tone="muted" style={styles.hint}>
            {s.capture.nothingFoundHint}
          </AppText>
        ) : null}
        {VOICE_HINT[voice.status] ? (
          <AppText tone="muted" style={styles.hint}>
            {s.capture[VOICE_HINT[voice.status]!]}
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
  suggestions: { marginTop: spacing.lg, gap: spacing.sm },
  suggestion: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
