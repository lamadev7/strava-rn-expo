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
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { Trace } from '@/constants/theme';
import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { backfillPlaces } from '@/features/recording/places';
import { useRecordingStore } from '@/features/recording/store';

SplashScreen.preventAutoHideAsync();

const traceTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
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
  const { success: migrated, error: migrationError } = useMigrations(db, migrations);

  useEffect(() => {
    if (fontsLoaded && migrated) {
      SplashScreen.hideAsync();
      useRecordingStore.getState().recoverOrphans();
      backfillPlaces().catch(() => {});
    }
  }, [fontsLoaded, migrated]);

  if (migrationError) {
    return <Text style={{ color: '#FF6A5C', padding: 40 }}>DB migration failed: {migrationError.message}</Text>;
  }
  if (!fontsLoaded || !migrated) return null;

  return (
    <ThemeProvider value={traceTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="activity/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="moment-capture" options={{ presentation: 'fullScreenModal' }} />
      </Stack>
    </ThemeProvider>
  );
}
