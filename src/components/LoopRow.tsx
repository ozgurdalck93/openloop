import { Pressable, StyleSheet, View } from 'react-native';

import type { Loop } from '@/engine/types';
import { typeLabel, type UiLang } from '@/i18n';
import { colors, hairline, loopTypeMeta, radius, spacing } from '@/theme';
import { formatWhen, waitingCaption } from '@/utils/format';

import { AppText } from './AppText';

interface LoopRowProps {
  loop: Loop;
  now: Date;
  lang?: UiLang;
  onPress: () => void;
}

/** One quiet row: a small type label, the title, and when it resurfaces. Not a dashboard card. */
export function LoopRow({ loop, now, lang = 'en', onPress }: LoopRowProps) {
  const meta = loopTypeMeta[loop.type];
  const waiting = waitingCaption(loop, now, lang);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={[styles.badge, { backgroundColor: meta.tint }]}>
        <AppText variant="label" style={{ color: meta.color }}>
          {typeLabel(loop.type, lang)}
        </AppText>
      </View>
      <AppText variant="bodyStrong" style={styles.title}>
        {loop.title}
      </AppText>
      {loop.nextReviewAt ? (
        <AppText variant="caption" tone="muted">
          {formatWhen(new Date(loop.nextReviewAt), now, lang)}
        </AppText>
      ) : null}
      {waiting ? (
        <AppText variant="caption" tone="muted" testID="waiting-days">
          {waiting}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: spacing.lg,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  title: { color: colors.ink },
});
