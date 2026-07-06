import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef } from '@maplibre/maplibre-react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapStyleSwitcher } from '@/components/map-style-switcher';
import { ScalePressable } from '@/components/scale-pressable';

import { BottomTabInset, Trace, TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';
import { HeadingPuck } from '@/features/map/heading-puck';
import { formatDuration, formatKm, formatPace, type ActivityType } from '@/features/recording/geo';
import { useRecordingStore } from '@/features/recording/store';
import { MAP_STYLES, useMapStyle } from '@/features/settings/map-style';

const ACTIVITY_TYPES: { key: ActivityType; label: string }[] = [
  { key: 'run', label: 'Run' },
  { key: 'ride', label: 'Ride' },
  { key: 'walk', label: 'Walk' },
];

export default function RecordScreen() {
  const styleKey = useMapStyle((s) => s.styleKey);
  const status = useRecordingStore((s) => s.status);
  const activityType = useRecordingStore((s) => s.activityType);
  const setActivityType = useRecordingStore((s) => s.setActivityType);
  const activityId = useRecordingStore((s) => s.activityId);
  const permissionDenied = useRecordingStore((s) => s.permissionDenied);
  const { start, pause, resume, stop, elapsedS } = useRecordingStore.getState();

  // M3: the background task writes to SQLite; this screen just reads it live.
  const { data: pointRows } = useLiveQuery(
    db
      .select()
      .from(trackPoints)
      .where(eq(trackPoints.activityId, activityId ?? ''))
      .orderBy(trackPoints.seq),
    [activityId],
  );
  const { data: activityRows } = useLiveQuery(
    db.select().from(activities).where(eq(activities.id, activityId ?? '')),
    [activityId],
  );
  const points = pointRows ?? [];
  const distanceM = activityRows?.[0]?.distanceM ?? 0;

  // 1 Hz clock for duration/pace display while recording (TECH_SPEC §5.5 throttle)
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'recording') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const lastPoint = points[points.length - 1];
  const durationS = elapsedS();
  const recording = status === 'recording';
  const paused = status === 'paused';

  // Follow the latest accepted point imperatively: easeTo without a zoom key
  // keeps the user's pinch zoom (declarative Camera props would re-apply a
  // fixed zoom on every render and wipe it).
  const cameraRef = useRef<CameraRef>(null);
  const lastLng = lastPoint?.lng;
  const lastLat = lastPoint?.lat;
  useEffect(() => {
    if (!(recording || paused) || lastLng == null || lastLat == null) return;
    cameraRef.current?.easeTo({ center: [lastLng, lastLat], duration: 500 });
  }, [recording, paused, lastLng, lastLat]);

  const trail: GeoJSON.Feature<GeoJSON.LineString> | null =
    points.length > 1
      ? {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
        }
      : null;

  return (
    <View style={styles.container}>
      <MapLibreMap mapStyle={MAP_STYLES[styleKey]} style={StyleSheet.absoluteFill}>
        {/* While recording, the effect above follows the latest accepted point
            at the user's current zoom; idle tracks the OS puck */}
        <Camera
          ref={cameraRef}
          initialViewState={{ zoom: 15 }}
          trackUserLocation={recording || paused ? undefined : 'default'}
        />
        <HeadingPuck />
        {trail && (
          <GeoJSONSource id="trail" data={trail}>
            <Layer
              id="trail-line"
              type="line"
              paint={{ 'line-color': Trace.accent, 'line-width': 5 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {/* GPS / permission chip left, basemap switcher top-right */}
        <View style={styles.topRow} pointerEvents="box-none">
          {permissionDenied ? (
            <ScalePressable
              style={[styles.iconChip, styles.chipDanger]}
              onPress={() => Linking.openSettings()}
              hitSlop={8}
              scaleTo={0.88}>
              <SymbolView
                name={{ ios: 'location.slash.fill', android: 'location_off', web: 'location_off' }}
                size={17}
                tintColor={Trace.danger}
              />
            </ScalePressable>
          ) : lastPoint?.accuracy != null ? (
            <Animated.View style={styles.chip} entering={FadeIn.duration(220)}>
              <SymbolView
                name={{ ios: 'location.fill', android: 'my_location', web: 'my_location' }}
                size={15}
                tintColor={Trace.tierGreat}
              />
              <Text style={styles.chipText}>±{Math.round(lastPoint.accuracy)} m</Text>
            </Animated.View>
          ) : (
            <View style={styles.iconChip}>
              <SymbolView
                name={{
                  ios: 'location',
                  android: 'location_searching',
                  web: 'location_searching',
                }}
                size={17}
                tintColor={Trace.textSecondary}
              />
            </View>
          )}
          <MapStyleSwitcher
            onChanged={(key) =>
              // tilt into 3D when entering satellite terrain, flatten when leaving
              cameraRef.current?.setStop({ pitch: key === 'satellite' ? 50 : 0, duration: 600 })
            }
          />
        </View>

        <Animated.View
          style={styles.bottom}
          pointerEvents="box-none"
          layout={LinearTransition.springify().damping(18)}>
          {(recording || paused) && (
            <Animated.View
              style={styles.statsCard}
              entering={FadeInDown.duration(280)}
              exiting={FadeOut.duration(150)}>
              <View style={styles.statsHeader}>
                <Text style={styles.duration}>{formatDuration(durationS)}</Text>
                {paused && (
                  <Animated.Text entering={FadeIn.duration(200)} style={styles.pausedBadge}>
                    PAUSED
                  </Animated.Text>
                )}
              </View>
              <View style={styles.statsRow}>
                <Stat value={formatKm(distanceM)} label="KM" />
                <View style={styles.statDivider} />
                <Stat value={formatPace(distanceM, durationS)} label="PACE /KM" />
                <View style={styles.statDivider} />
                <Stat value={String(points.length)} label="POINTS" />
              </View>
            </Animated.View>
          )}

          {status === 'idle' && (
            <Animated.View
              style={styles.segment}
              entering={FadeInDown.duration(280)}
              exiting={FadeOut.duration(150)}>
              {ACTIVITY_TYPES.map(({ key, label }) => (
                <ScalePressable
                  key={key}
                  scaleTo={0.92}
                  style={[styles.segmentItem, activityType === key && styles.segmentItemActive]}
                  onPress={() => setActivityType(key)}>
                  <Text
                    style={[styles.segmentText, activityType === key && styles.segmentTextActive]}>
                    {label}
                  </Text>
                </ScalePressable>
              ))}
            </Animated.View>
          )}

          <View style={styles.controls} pointerEvents="box-none">
            {status === 'idle' && (
              <Animated.View entering={FadeInDown.springify().damping(16)}>
                <ScalePressable style={styles.startButton} onPress={start} scaleTo={0.9}>
                  <Text style={styles.startText}>START</Text>
                </ScalePressable>
              </Animated.View>
            )}
            {recording && (
              <Animated.View style={styles.controlsRow} entering={FadeInDown.springify().damping(16)}>
                <ScalePressable style={styles.secondaryButton} onPress={pause}>
                  <Text style={styles.secondaryText}>PAUSE</Text>
                </ScalePressable>
                <ScalePressable style={styles.stopButton} onPress={stop}>
                  <Text style={styles.stopText}>STOP</Text>
                </ScalePressable>
              </Animated.View>
            )}
            {paused && (
              <Animated.View style={styles.controlsRow} entering={FadeInDown.springify().damping(16)}>
                <ScalePressable style={styles.startButtonSmall} onPress={resume}>
                  <Text style={styles.startText}>RESUME</Text>
                </ScalePressable>
                <ScalePressable style={styles.stopButton} onPress={stop}>
                  <Text style={styles.stopText}>STOP</Text>
                </ScalePressable>
              </Animated.View>
            )}
          </View>

          {status === 'idle' && (
            <Animated.Text
              entering={FadeIn.duration(300)}
              exiting={FadeOut.duration(120)}
              style={styles.hint}>
              Ready when you are.
            </Animated.Text>
          )}
        </Animated.View>
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
  overlay: { flex: 1, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Trace.backgroundElement}E6`,
    borderWidth: 1,
    borderColor: Trace.border,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${Trace.backgroundElement}E6`,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Trace.border,
  },
  chipDanger: { borderColor: Trace.danger },
  chipText: {
    color: Trace.textSecondary,
    fontFamily: TraceFonts.displayMedium,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  bottom: { paddingHorizontal: 16, paddingBottom: BottomTabInset - 24, gap: 12 },
  statsCard: {
    backgroundColor: `${Trace.backgroundElement}F2`,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Trace.border,
    gap: 14,
  },
  statsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  duration: {
    color: Trace.text,
    fontFamily: TraceFonts.monoBold,
    fontSize: 40,
    fontVariant: ['tabular-nums'],
  },
  pausedBadge: {
    color: Trace.tierOk,
    fontFamily: TraceFonts.display,
    fontSize: 12,
    letterSpacing: 1.5,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: {
    color: Trace.text,
    fontFamily: TraceFonts.mono,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: Trace.textMuted,
    fontFamily: TraceFonts.displayMedium,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  statDivider: { width: 1, height: 28, backgroundColor: Trace.border },
  segment: {
    flexDirection: 'row',
    backgroundColor: `${Trace.backgroundElement}E6`,
    borderRadius: 999,
    padding: 4,
    borderWidth: 1,
    borderColor: Trace.border,
    alignSelf: 'center',
  },
  segmentItem: { paddingHorizontal: 22, paddingVertical: 9, borderRadius: 999 },
  segmentItemActive: { backgroundColor: Trace.backgroundSelected },
  segmentText: { color: Trace.textSecondary, fontFamily: TraceFonts.displayMedium, fontSize: 14 },
  segmentTextActive: { color: Trace.accent },
  controls: { flexDirection: 'row', justifyContent: 'center' },
  controlsRow: { flexDirection: 'row', gap: 14 },
  startButton: {
    backgroundColor: Trace.accent,
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonSmall: {
    backgroundColor: Trace.accent,
    borderRadius: 999,
    paddingHorizontal: 30,
    paddingVertical: 18,
  },
  startText: {
    color: Trace.onAccent,
    fontFamily: TraceFonts.display,
    fontSize: 14,
    letterSpacing: 1.2,
  },
  secondaryButton: {
    backgroundColor: Trace.backgroundElement,
    borderRadius: 999,
    paddingHorizontal: 30,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: Trace.border,
  },
  secondaryText: {
    color: Trace.text,
    fontFamily: TraceFonts.display,
    fontSize: 16,
    letterSpacing: 1.5,
  },
  stopButton: {
    backgroundColor: Trace.danger,
    borderRadius: 999,
    paddingHorizontal: 30,
    paddingVertical: 18,
  },
  stopText: {
    color: '#2A1215',
    fontFamily: TraceFonts.display,
    fontSize: 16,
    letterSpacing: 1.5,
  },
  hint: {
    color: Trace.textMuted,
    fontFamily: TraceFonts.body,
    fontSize: 13,
    textAlign: 'center',
  },
});
