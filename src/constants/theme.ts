/**
 * Trace design tokens — extracted from docs/Strava Shapes - Mockups (standalone).html
 * Electric lime on green-cast near-black. The app commits to the dark world;
 * light mode maps to the same palette (design decision, see TECH_SPEC).
 */

import '@/global.css';

import { Platform } from 'react-native';

const trace = {
  text: '#F2F6EA',
  background: '#0E120C',
  backgroundElement: '#171C15',
  backgroundSelected: '#242B22',
  textSecondary: '#8D9A8C',
  textMuted: '#6C7566',
  accent: '#CDFF3C',
  onAccent: '#141900',
  border: '#2F382C',
  /** semantic tiers — never used as brand accent */
  tierGreat: '#5CE3A1',
  tierOk: '#FFC24B',
  tierTricky: '#98A29B',
  danger: '#FF6A5C',
} as const;

export const Colors = {
  light: trace,
  dark: trace,
} as const;

export const Trace = trace;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Loaded in app/_layout.tsx via @expo-google-fonts packages */
export const TraceFonts = {
  display: 'SpaceGrotesk_600SemiBold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'SpaceGrotesk_400Regular',
  mono: 'SplineSansMono_500Medium',
  monoBold: 'SplineSansMono_600SemiBold',
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
