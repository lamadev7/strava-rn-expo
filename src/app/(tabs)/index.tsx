import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, UserLocation } from '@maplibre/maplibre-react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, Trace, TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';
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
  const toggleStyle = useMapStyle((s) => s.toggle);
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
        {/* While recording, follow the latest accepted point; idle tracks the OS puck */}
        <Camera
          initialViewState={{ zoom: 15 }}
          trackUserLocation={recording || paused ? undefined : 'default'}
          {...(lastPoint && (recording || paused)
            ? { center: [lastPoint.lng, lastPoint.lat], zoom: 16, duration: 500 }
            : {})}
        />
        <UserLocation animated accuracy />
        {trail && (
          <GeoJSONSource id="trail" data={trail}>
            <Layer
              id="trail-line"
              type="line"
              style={{
                lineColor: Trace.accent,
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {/* GPS / permission chip + style toggle */}
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable style={styles.styleToggle} onPress={toggleStyle}>
            <Text style={styles.chipText}>{styleKey === 'dark' ? 'Detail' : 'Dark'}</Text>
          </Pressable>
          {permissionDenied ? (
            <Pressable style={[styles.chip, styles.chipDanger]} onPress={() => Linking.openSettings()}>
              <Text style={[styles.chipText, { color: Trace.danger }]}>
                Location off — tap to open Settings
              </Text>
            </Pressable>
          ) : (
            <View style={styles.chip}>
              <View style={styles.gpsDot} />
              <Text style={styles.chipText}>
                {lastPoint?.accuracy != null ? `GPS locked · ±${Math.round(lastPoint.accuracy)} m` : 'GPS ready'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          {(recording || paused) && (
            <View style={styles.statsCard}>
              <View style={styles.statsHeader}>
                <Text style={styles.duration}>{formatDuration(durationS)}</Text>
                {paused && <Text style={styles.pausedBadge}>PAUSED</Text>}
              </View>
              <View style={styles.statsRow}>
                <Stat value={formatKm(distanceM)} label="KM" />
                <View style={styles.statDivider} />
                <Stat value={formatPace(distanceM, durationS)} label="PACE /KM" />
                <View style={styles.statDivider} />
                <Stat value={String(points.length)} label="POINTS" />
              </View>
            </View>
          )}

          {status === 'idle' && (
            <View style={styles.segment}>
              {ACTIVITY_TYPES.map(({ key, label }) => (
                <Pressable
                  key={key}
                  style={[styles.segmentItem, activityType === key && styles.segmentItemActive]}
                  onPress={() => setActivityType(key)}>
                  <Text
                    style={[styles.segmentText, activityType === key && styles.segmentTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.controls} pointerEvents="box-none">
            {status === 'idle' && (
              <Pressable style={styles.startButton} onPress={start}>
                <Text style={styles.startText}>START</Text>
              </Pressable>
            )}
            {recording && (
              <>
                <Pressable style={styles.secondaryButton} onPress={pause}>
                  <Text style={styles.secondaryText}>PAUSE</Text>
                </Pressable>
                <Pressable style={styles.stopButton} onPress={stop}>
                  <Text style={styles.stopText}>STOP</Text>
                </Pressable>
              </>
            )}
            {paused && (
              <>
                <Pressable style={styles.startButtonSmall} onPress={resume}>
                  <Text style={styles.startText}>RESUME</Text>
                </Pressable>
                <Pressable style={styles.stopButton} onPress={stop}>
                  <Text style={styles.stopText}>STOP</Text>
                </Pressable>
              </>
            )}
          </View>

          {status === 'idle' && <Text style={styles.hint}>Ready when you are.</Text>}
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
  overlay: { flex: 1, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
  styleToggle: {
    backgroundColor: `${Trace.backgroundElement}E6`,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
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
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Trace.tierGreat },
  bottom: { paddingHorizontal: 16, paddingBottom: BottomTabInset + 12, gap: 12 },
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
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  startButton: {
    backgroundColor: Trace.accent,
    width: 96,
    height: 96,
    borderRadius: 48,
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
    fontSize: 16,
    letterSpacing: 1.5,
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
