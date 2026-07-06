import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapStyleSwitcher } from '@/components/map-style-switcher';
import { ScalePressable } from '@/components/scale-pressable';
import { Trace, TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';
import { usePlayback } from '@/features/playback/use-playback';
import { formatDuration, formatKm, formatPace } from '@/features/recording/geo';
import { useRecordingStore } from '@/features/recording/store';
import { MAP_STYLES, useMapStyle } from '@/features/settings/map-style';

const TYPE_LABEL = { run: 'Run', ride: 'Ride', walk: 'Walk' } as const;

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: activityRows } = useLiveQuery(
    db.select().from(activities).where(eq(activities.id, id ?? '')),
    [id],
  );
  const { data: pointRows } = useLiveQuery(
    db.select().from(trackPoints).where(eq(trackPoints.activityId, id ?? '')).orderBy(trackPoints.seq),
    [id],
  );
  const activity = activityRows?.[0];
  const deleteActivity = useRecordingStore((s) => s.deleteActivity);
  const styleKey = useMapStyle((s) => s.styleKey);
  const cameraRef = useRef<CameraRef>(null);

  const [replayMode, setReplayMode] = useState(false);
  const playback = usePlayback(pointRows ?? []);

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
        <Text style={styles.missing}>Activity not found.</Text>
      </SafeAreaView>
    );
  }

  const points = pointRows ?? [];
  const coords = points.map((p) => [p.lng, p.lat] as [number, number]);
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const hasTrack = coords.length > 1;

  const route: GeoJSON.Feature<GeoJSON.LineString> | null = hasTrack
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
    : null;

  const replaying = replayMode && playback.frame != null;
  // path covered so far in the replay: passed points + interpolated position
  const traveled: GeoJSON.Feature<GeoJSON.LineString> | null = replaying
    ? {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [...coords.slice(0, playback.frame!.index + 1), playback.frame!.lngLat],
        },
      }
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
              ref={cameraRef}
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
                  paint={{
                    'line-color': Trace.accent,
                    'line-width': 4,
                    // dim the full route while replaying so progress reads clearly
                    'line-opacity': replaying ? 0.25 : 1,
                  }}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                />
              </GeoJSONSource>
            )}
            {route && (
              <GeoJSONSource id="route-traveled" data={traveled ?? route}>
                <Layer
                  id="route-traveled-line"
                  type="line"
                  paint={{
                    'line-color': Trace.accent,
                    'line-width': 4,
                    'line-opacity': replaying ? 1 : 0,
                  }}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                />
              </GeoJSONSource>
            )}
            {/* always mounted — conditional children inside the map trip
                MapLibre's frozen-id check; hide via opacity instead */}
            <Marker
              id="replay-puck"
              lngLat={playback.frame?.lngLat ?? coords[0]}
              pointerEvents="none">
              <View style={[styles.replayDot, { opacity: replaying ? 1 : 0 }]} />
            </Marker>
          </MapLibreMap>
        ) : (
          <View style={styles.noTrack}>
            <Text style={styles.noTrackText}>Not enough GPS points for a map.</Text>
          </View>
        )}
        <SafeAreaView style={styles.mapOverlay} pointerEvents="box-none">
          <MapStyleSwitcher
            onChanged={(key) =>
              cameraRef.current?.setStop({ pitch: key === 'satellite' ? 50 : 0, duration: 600 })
            }
          />
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
          <Stat value={String(Math.round(activity.elevGainM ?? 0))} label="ELEV M" />
        </View>
        {replayMode && playback.frame && (
          <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(120)} style={styles.playbackPanel}>
            <View style={styles.playbackStatsRow}>
              <Stat value={(playback.frame.speedMs * 3.6).toFixed(1)} label="KM/H NOW" />
              <View style={styles.divider} />
              <Stat value={formatKm(playback.frame.distanceM)} label="KM GONE" />
              <View style={styles.divider} />
              <Stat value={formatDuration(playback.frame.elapsedS)} label="TIME" />
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${playback.progress * 100}%` }]} />
            </View>
            <View style={styles.playbackControls}>
              <ScalePressable style={styles.playButton} onPress={playback.toggle} scaleTo={0.9}>
                <SymbolView
                  name={
                    playback.playing
                      ? { ios: 'pause.fill', android: 'pause', web: 'pause' }
                      : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }
                  }
                  size={18}
                  tintColor={Trace.onAccent}
                />
              </ScalePressable>
              <ScalePressable style={styles.rateButton} onPress={playback.cycleRate} scaleTo={0.92}>
                <Text style={styles.rateText}>{playback.rate}×</Text>
              </ScalePressable>
              <ScalePressable
                style={styles.exitButton}
                onPress={() => {
                  playback.reset();
                  setReplayMode(false);
                }}
                scaleTo={0.92}>
                <Text style={styles.exitText}>Exit replay</Text>
              </ScalePressable>
            </View>
          </Animated.View>
        )}

        <View style={styles.sheetFooter}>
          <Text style={styles.meta}>{points.length} GPS points recorded</Text>
          <View style={styles.footerButtons}>
            {hasTrack && !replayMode && (
              <ScalePressable
                style={styles.replayButton}
                onPress={() => {
                  setReplayMode(true);
                  playback.toggle();
                }}
                scaleTo={0.92}>
                <SymbolView
                  name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                  size={12}
                  tintColor={Trace.onAccent}
                />
                <Text style={styles.replayText}>Replay</Text>
              </ScalePressable>
            )}
            <ScalePressable style={styles.deleteButton} onPress={confirmDelete} scaleTo={0.92}>
              <Text style={styles.deleteText}>Delete</Text>
            </ScalePressable>
          </View>
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
  replayDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Trace.accent,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
  footerButtons: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Trace.accent,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  replayText: { color: Trace.onAccent, fontFamily: TraceFonts.displayMedium, fontSize: 13 },
  playbackPanel: { gap: 14 },
  playbackStatsRow: { flexDirection: 'row', alignItems: 'center' },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Trace.border,
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: Trace.accent },
  playbackControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Trace.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Trace.border,
    backgroundColor: Trace.background,
  },
  rateText: {
    color: Trace.text,
    fontFamily: TraceFonts.mono,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  exitButton: {
    marginLeft: 'auto',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Trace.border,
  },
  exitText: { color: Trace.textSecondary, fontFamily: TraceFonts.displayMedium, fontSize: 13 },
  missing: { color: Trace.textSecondary, fontFamily: TraceFonts.body, fontSize: 14, padding: 24 },
});
