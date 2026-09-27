/**
 * Warm off-white base, dark ink, one restrained natural accent (pine).
 * No neon, no purple, no gradients. Loop-type colors are muted earth tones.
 */
export const colors = {
  background: '#F7F3EC',
  surface: '#FCFAF6',
  surfaceRaised: '#FFFFFF',

  ink: '#1F1B16',
  inkSoft: '#4A443B',
  muted: '#8A8275',

  border: '#E6DFD2',
  borderStrong: '#D3CABA',

  accent: '#3F6B57',
  accentSoft: '#E3ECE6',
  onAccent: '#FBFAF6',

  danger: '#A24B3A',
  overlay: 'rgba(31, 27, 22, 0.4)',
} as const;

export type ThemeColors = typeof colors;
