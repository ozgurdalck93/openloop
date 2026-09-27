import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Prefix for testIDs: `${testID}` on the sheet, `${testID}-backdrop` on the scrim. */
  testID: string;
  children: ReactNode;
}

/**
 * A bottom sheet built on the platform Modal — no gesture or animation library, so it behaves
 * the same on iOS, Android and the web build. Tap the scrim (or the back button) to dismiss.
 */
export function BottomSheet({ visible, onClose, title, testID, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    // "fade", not "slide": a slide animates the whole modal, dragging the dimming scrim up with the sheet.
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.fill}>
        <Pressable testID={`${testID}-backdrop`} accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
        <View testID={testID} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md }]}>
          <View style={styles.grabber} />
          {title ? (
            <AppText variant="heading" style={styles.title}>
              {title}
            </AppText>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.body}>
            <View style={styles.content}>{children}</View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '88%',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.lg,
  },
  title: { marginBottom: spacing.md },
  body: { flexGrow: 0 },
  content: { gap: spacing.md, paddingBottom: spacing.sm },
});
