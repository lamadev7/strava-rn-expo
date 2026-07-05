import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Trace, TraceFonts } from '@/constants/theme';
import { elevationGainM, formatDuration, formatKm, formatPace } from '@/features/recording/geo';
import { useRecordingStore } from '@/features/recording/store';
import { MAP_STYLES, useMapStyle } from '@/features/settings/map-style';

const TYPE_LABEL = { run: 'Run', ride: 'Ride', walk: 'Walk' } as const;

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const activity = useRecordingStore((s) => s.completed.find((a) => a.id === id));
  const deleteActivity = useRecordingStore((s) => s.deleteActivity);
  const styleKey = useMapStyle((s) => s.styleKey);
  const toggleStyle = useMapStyle((s) => s.toggle);

  const confirmDelete = () =>
    Alert.alert('Delete activity?', 'Gone for good.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (id) deleteActivity(id);
          router.back();
        },
      },
    ]);

  if (!activity) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.missing}>Activity not found (history is session-only until the database ships).</Text>
      </SafeAreaView>
    );
  }

  const coords = activity.points.map((p) => [p.lng, p.lat] as [number, number]);
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const hasTrack = coords.length > 1;

  const route: GeoJSON.Feature<GeoJSON.LineString> | null = hasTrack
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
    : null;

  const when = new Date(activity.startedAt).toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.mapWrap}>
        {hasTrack ? (
          <MapLibreMap mapStyle={MAP_STYLES[styleKey]} style={StyleSheet.absoluteFill}>
            <Camera
              initialViewState={{
                bounds: [
                  Math.min(...lngs),
                  Math.min(...lats),
                  Math.max(...lngs),
                  Math.max(...lats),
                ],
                padding: { top: 60, bottom: 60, left: 40, right: 40 },
              }}
            />
            {route && (
              <GeoJSONSource id="route" data={route}>
                <Layer
                  id="route-line"
                  type="line"
                  style={{ lineColor: Trace.accent, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
                />
              </GeoJSONSource>
            )}
          </MapLibreMap>
        ) : (
          <View style={styles.noTrack}>
            <Text style={styles.noTrackText}>Not enough GPS points for a map.</Text>
          </View>
        )}
        <SafeAreaView style={styles.mapOverlay} pointerEvents="box-none">
          <Pressable style={styles.styleToggle} onPress={toggleStyle}>
            <Text style={styles.styleToggleText}>{styleKey === 'dark' ? 'Detail' : 'Dark'}</Text>
          </Pressable>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <Text style={styles.title}>
          {TYPE_LABEL[activity.type]} · {when}
        </Text>
        <View style={styles.statsRow}>
          <Stat value={formatKm(activity.distanceM)} label="KM" />
          <View style={styles.divider} />
          <Stat value={formatDuration(activity.durationS)} label="TIME" />
          <View style={styles.divider} />
          <Stat value={formatPace(activity.distanceM, activity.durationS)} label="PACE /KM" />
          <View style={styles.divider} />
          <Stat value={String(Math.round(elevationGainM(activity.points)))} label="ELEV M" />
        </View>
        <View style={styles.sheetFooter}>
          <Text style={styles.meta}>{activity.points.length} GPS points recorded</Text>
          <Pressable style={styles.deleteButton} onPress={confirmDelete}>
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Trace.background },
  mapWrap: { flex: 1 },
  mapOverlay: { flex: 1, alignItems: 'flex-end', padding: 12 },
  styleToggle: {
    backgroundColor: `${Trace.backgroundElement}E6`,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Trace.border,
  },
  styleToggleText: { color: Trace.text, fontFamily: TraceFonts.displayMedium, fontSize: 13 },
  noTrack: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noTrackText: { color: Trace.textSecondary, fontFamily: TraceFonts.body, fontSize: 14 },
  sheet: {
    backgroundColor: Trace.backgroundElement,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 16,
  },
  title: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 18 },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: {
    color: Trace.text,
    fontFamily: TraceFonts.mono,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: Trace.textMuted,
    fontFamily: TraceFonts.displayMedium,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  divider: { width: 1, height: 28, backgroundColor: Trace.border },
  meta: { color: Trace.textMuted, fontFamily: TraceFonts.body, fontSize: 12.5 },
  sheetFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deleteButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Trace.danger,
  },
  deleteText: { color: Trace.danger, fontFamily: TraceFonts.displayMedium, fontSize: 13 },
  missing: { color: Trace.textSecondary, fontFamily: TraceFonts.body, fontSize: 14, padding: 24 },
});
