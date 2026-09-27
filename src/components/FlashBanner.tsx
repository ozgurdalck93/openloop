import { StyleSheet, View } from 'react-native';

import { useFlash } from '@/store/flash';
import { colors, hairline, radius, spacing } from '@/theme';

import { AppText } from './AppText';

/** The one calm sentence after an action. Renders nothing when there is none. */
export function FlashBanner() {
  const message = useFlash();
  if (!message) return null;
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" testID="flash">
      <AppText variant="caption" tone="soft">
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.border,
  },
});
