import { Text, type TextProps } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/theme';

type Tone = 'ink' | 'soft' | 'muted' | 'accent';

const TONE: Record<Tone, string> = {
  ink: colors.ink,
  soft: colors.inkSoft,
  muted: colors.muted,
  accent: colors.accent,
};

interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: Tone;
}

/** The one text component: dark ink on warm off-white, typography from the theme. */
export function AppText({ variant = 'body', tone = 'ink', style, ...rest }: AppTextProps) {
  return <Text {...rest} style={[typography[variant], { color: TONE[tone] }, style]} />;
}
