import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { AppText } from './AppText';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Rounded, but not bubbly. Primary is the one restrained accent; secondary is a hairline outline. */
export function Button({ label, onPress, variant = 'primary', disabled = false, style, testID }: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.85 },
        style,
      ]}
    >
      <AppText variant="bodyStrong" style={{ color: primary ? colors.onAccent : colors.ink }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderStrong },
});
