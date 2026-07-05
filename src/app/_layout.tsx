import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import {
  SplineSansMono_500Medium,
  SplineSansMono_600SemiBold,
} from '@expo-google-fonts/spline-sans-mono';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { Trace } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

const traceTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Trace.accent,
    background: Trace.background,
    card: Trace.backgroundElement,
    text: Trace.text,
    border: Trace.border,
  },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SplineSansMono_500Medium,
    SplineSansMono_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ThemeProvider value={traceTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="activity/[id]" options={{ presentation: 'card' }} />
      </Stack>
    </ThemeProvider>
  );
}
