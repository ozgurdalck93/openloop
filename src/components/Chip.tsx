import { Pressable, StyleSheet } from 'react-native';

import { colors, hairline, radius, spacing } from '@/theme';

import { AppText } from './AppText';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
  /** Text/border colour when selected; defaults to the accent. */
  color?: string;
  /** Background when selected; defaults to the accent tint. */
  tint?: string;
}

/** A small selectable pill: outline when idle, tinted when chosen. */
export function Chip({ label, selected = false, onPress, testID, color = colors.accent, tint = colors.accentSoft }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: tint, borderColor: color } : styles.idle,
        pressed && { opacity: 0.8 },
      ]}
    >
      <AppText variant="caption" style={{ color: selected ? color : colors.inkSoft, fontWeight: selected ? '600' : '400' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: hairline,
    minHeight: 34,
    justifyContent: 'center',
  },
  idle: { borderColor: colors.border, backgroundColor: 'transparent' },
});
