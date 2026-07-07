/**
 * Trace design tokens — Strava-style signal orange on warm white (design "Trace Moments").
 * The app commits to the light athletic look; the cinematic replay and the moment camera
 * are the only dark surfaces. Light and dark OS modes map to the same palette.
 */

import '@/global.css';

import { Platform } from 'react-native';

const trace = {
  text: '#1B1B20',
  background: '#F7F6F3',
  backgroundElement: '#FFFFFF',
  backgroundSelected: 'rgba(252,82,0,0.1)',
  textSecondary: '#66666F',
  textMuted: '#8A8A93',
  accent: '#FC5200',
  onAccent: '#FFFFFF',
  border: 'rgba(0,0,0,0.08)',
  /** semantic tiers — never used as brand accent */
  tierGreat: '#1E9E5A',
  tierOk: '#E8A13C',
  tierTricky: '#98A29B',
  danger: '#E5484D',
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
