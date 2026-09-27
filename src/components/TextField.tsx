import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, hairline, radius, spacing, typography } from '@/theme';

import { AppText } from './AppText';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** A blocking problem. Shown in the danger colour and marks the field. */
  error?: string | null;
  /** A gentle note under the field (e.g. "Not sure about the name"). */
  hint?: string | null;
}

/** Label above, quiet bordered input, optional hint/error below. */
export function TextField({ label, error, hint, multiline, ...input }: TextFieldProps) {
  return (
    <View style={styles.wrap}>
      <AppText variant="label" tone="muted">
        {label.toUpperCase()}
      </AppText>
      <TextInput
        {...input}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.multiline, error ? styles.errored : null]}
      />
      {error ? (
        <AppText variant="caption" style={{ color: colors.danger }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="accent">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.borderStrong,
    color: colors.ink,
    ...typography.body,
  },
  multiline: { minHeight: 72 },
  errored: { borderColor: colors.danger },
});
