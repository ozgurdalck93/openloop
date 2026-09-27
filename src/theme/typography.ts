import type { TextStyle } from 'react-native';

/** System fonts on purpose: native-feeling, no font loading step. */
export const typography = {
  title: { fontSize: 30, lineHeight: 36, fontWeight: '600', letterSpacing: -0.4 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Small uppercase section / badge label. */
  label: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.9 },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
