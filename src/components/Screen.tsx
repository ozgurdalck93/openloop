import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, hairline, spacing } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  /** Scrolls its content (Home, detail). Fixed screens (capture) lay out on their own. */
  scroll?: boolean;
  /** Pinned below the content — the primary action of the screen. */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Warm off-white page with generous side padding, inside the safe area. */
export function Screen({ children, scroll = false, footer, style }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe}>
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[styles.content, style]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, style]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xl },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
