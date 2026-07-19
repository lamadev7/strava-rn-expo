import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, type CameraRef } from '@maplibre/maplibre-react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapStyleSwitcher } from '@/components/map-style-switcher';
import { ScalePressable } from '@/components/scale-pressable';

import { BottomTabInset, Trace, TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { activities, photoPins, trackPoints } from '@/db/schema';
import { HeadingPuck } from '@/features/map/heading-puck';
import { usePastPaths } from '@/features/map/past-paths';
import { useMomentsStore } from '@/features/moments/store';
import { elevationStats, estimateKcal, formatDuration, formatKm, formatPace, type ActivityType } from '@/features/recording/geo';
import { useRecordingStore } from '@/features/recording/store';
import { MAP_STYLES, useMapStyle } from '@/features/settings/map-style';

const ACTIVITY_TYPES: { key: ActivityType; label: string }[] = [
  { key: 'run', label: 'Run' },
  { key: 'ride', label: 'Ride' },
  { key: 'hike', label: 'Hike' },
];

/** default map scale when idle — district level (~6 km across) */
const IDLE_ZOOM = 5;

export default function RecordScreen() {
  const router = useRouter();
  const styleKey = useMapStyle((s) => s.styleKey);
  const justPinned = useMomentsStore((s) => s.justPinned);
  const clearToast = useMomentsStore((s) => s.clearToast);
  const status = useRecordingStore((s) => s.status);
  const activityType = useRecordingStore((s) => s.activityType);
  const setActivityType = useRecordingStore((s) => s.setActivityType);
  const activityId = useRecordingStore((s) => s.activityId);
  const permissionDenied = useRecordingStore((s) => s.permissionDenied);
  const steps = useRecordingStore((s) => s.steps);
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
  // exclude the in-progress activity — it's drawn as the bright live trail
  const pastPaths = usePastPaths(activityId);

  // saved camera-roll photo pins (photo-map page) — dots only, no images
  const { data: pinRows2 } = useLiveQuery(db.select().from(photoPins));
  const photoDots: GeoJSON.FeatureCollection | null = useMemo(
    () =>
      pinRows2?.length
        ? {
            type: 'FeatureCollection',
            features: pinRows2.map((p) => ({
              type: 'Feature' as const,
              properties: {},
              geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            })),
          }
        : null,
    [pinRows2],
  );

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
  // live climb total — drives the hike ELEV stat and the kcal climb bonus
  const liveElevation = useMemo(() => elevationStats(points), [points]);

  // "Moment pinned" toast (design §3c) — auto-dismiss
  useEffect(() => {
    if (!justPinned) return;
    const id = setTimeout(clearToast, 3400);
    return () => clearTimeout(id);
  }, [justPinned, clearToast]);

  // Follow the latest accepted point imperatively: easeTo without a zoom key
  // keeps the user's pinch zoom (declarative Camera props would re-apply a
  // fixed zoom on every render and wipe it). The FIRST follow after recording
  // starts sets an explicit zoom — the map may still be at the world-level
  // default if recording began before the OS puck ever got a fix.
  const cameraRef = useRef<CameraRef>(null);
  const followingRef = useRef(false);

  // Idle default zoom: initialViewState only applies on a fresh map, and the
  // puck-tracking mode keeps its own zoom — enforce district scale explicitly
  // once on mount so the default is what we say it is.
  useEffect(() => {
    if (recording || paused) return;
    const t = setTimeout(() => cameraRef.current?.zoomTo(IDLE_ZOOM, { duration: 600 }), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastLng = lastPoint?.lng;
  const lastLat = lastPoint?.lat;
  useEffect(() => {
    if (!(recording || paused)) {
      followingRef.current = false;
      return;
    }
    if (lastLng == null || lastLat == null) return;
    if (!followingRef.current) {
      followingRef.current = true;
      cameraRef.current?.setStop({ center: [lastLng, lastLat], zoom: 13, duration: 500 });
    } else {
      cameraRef.current?.easeTo({ center: [lastLng, lastLat], duration: 500 });
    }
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
          initialViewState={{ zoom: IDLE_ZOOM }}
          trackUserLocation={recording || paused ? undefined : 'default'}
        />
        <HeadingPuck />
        {/* everywhere you've been — all past routes, muted; overlaps glow brighter */}
        {pastPaths && (
          <GeoJSONSource id="past-paths" data={pastPaths}>
            <Layer
              id="past-paths-line"
              type="line"
              paint={{ 'line-color': Trace.accent, 'line-width': 3, 'line-opacity': 0.3 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>
        )}
        {photoDots && (
          <GeoJSONSource id="photo-pins" data={photoDots}>
            <Layer
              id="photo-pins-circles"
              type="circle"
              paint={{
                'circle-radius': 3.5,
                'circle-color': Trace.tierGreat,
                'circle-stroke-width': 1.2,
                'circle-stroke-color': '#0E120C',
                'circle-opacity': 0.85,
              }}
            />
          </GeoJSONSource>
        )}
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
        <View pointerEvents="box-none" style={styles.topGroup}>
        {/* design §3a — live stats card sits at the top of the screen */}
        {(recording || paused) && (
          <Animated.View
            style={styles.statsCard}
            entering={FadeInDown.duration(280)}
            exiting={FadeOut.duration(150)}>
            <View style={styles.statsHeader}>
              <Text style={styles.duration}>{formatDuration(durationS)}</Text>
              <View style={[styles.statusPill, paused && styles.statusPillPaused]}>
                <View style={[styles.statusPillDot, paused && styles.statusPillDotPaused]} />
                <Text style={[styles.statusPillText, paused && styles.statusPillTextPaused]}>
                  {paused ? 'PAUSED' : 'RECORDING'}
                </Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <Stat value={formatKm(distanceM)} label="KM" />
              <View style={styles.statDivider} />
              {/* hiking is about climb + steps; run/ride keep pace + kcal */}
              {activityType === 'hike' ? (
                <>
                  <Stat value={`↑${Math.round(liveElevation.gainM)}`} label="ELEV M" />
                  <View style={styles.statDivider} />
                  {steps !== null ? (
                    <Stat value={steps.toLocaleString()} label="STEPS" />
                  ) : (
                    <Stat
                      value={String(estimateKcal(distanceM, activityType, liveElevation.gainM))}
                      label="KCAL"
                    />
                  )}
                </>
              ) : (
                <>
                  <Stat value={formatPace(distanceM, durationS)} label="PACE /KM" />
                  <View style={styles.statDivider} />
                  <Stat
                    value={String(estimateKcal(distanceM, activityType, liveElevation.gainM))}
                    label="KCAL"
                  />
                </>
              )}
            </View>
          </Animated.View>
        )}

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

        {/* design §3c — dark "moment pinned" toast under the stats card */}
        {justPinned && (
          <Animated.View
            style={styles.toast}
            entering={FadeInDown.springify().damping(16)}
            exiting={FadeOut.duration(180)}
            pointerEvents="none">
            <View style={styles.toastIcon}>
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                size={13}
                tintColor={Trace.accent}
              />
            </View>
            <View>
              <Text style={styles.toastTitle}>
                Moment pinned at {formatKm(justPinned.distanceM)} km
              </Text>
              <Text style={styles.toastBody}>It&apos;ll pop up right here in your replay</Text>
            </View>
          </Animated.View>
        )}
        </View>

        <Animated.View
          style={styles.bottom}
          pointerEvents="box-none"
          layout={LinearTransition.springify().damping(18)}>
          {(recording || paused) && (
            <Animated.View
              style={styles.momentFab}
              entering={FadeInDown.duration(280)}
              exiting={FadeOut.duration(150)}>
              <ScalePressable
                style={styles.momentButton}
                onPress={() => router.push('/moment-capture')}
                scaleTo={0.88}>
                <SymbolView
                  name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                  size={24}
                  tintColor={Trace.accent}
                />
              </ScalePressable>
              <Text style={styles.momentLabel}>Pin a moment</Text>
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
                <ScalePressable style={styles.pauseCircle} onPress={pause} scaleTo={0.9}>
                  <SymbolView
                    name={{ ios: 'pause.fill', android: 'pause', web: 'pause' }}
                    size={24}
                    tintColor={Trace.text}
                  />
                </ScalePressable>
                <ScalePressable style={styles.stopCircle} onPress={stop} scaleTo={0.9}>
                  <View style={styles.stopSquare} />
                </ScalePressable>
              </Animated.View>
            )}
            {paused && (
              <Animated.View style={styles.controlsRow} entering={FadeInDown.springify().damping(16)}>
                <ScalePressable style={styles.pauseCircle} onPress={resume} scaleTo={0.9}>
                  <SymbolView
                    name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                    size={24}
                    tintColor={Trace.accent}
                  />
                </ScalePressable>
                <ScalePressable style={styles.stopCircle} onPress={stop} scaleTo={0.9}>
                  <View style={styles.stopSquare} />
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
  topGroup: { gap: 10 },
  statsCard: {
    marginHorizontal: 12,
    marginTop: 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    gap: 10,
    boxShadow: '0 10px 30px rgba(27,27,32,0.12)',
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  duration: {
    color: Trace.text,
    fontFamily: TraceFonts.monoBold,
    fontSize: 44,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(252,82,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(252,82,0,0.25)',
  },
  statusPillPaused: {
    backgroundColor: 'rgba(232,161,60,0.12)',
    borderColor: 'rgba(232,161,60,0.3)',
  },
  statusPillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Trace.accent },
  statusPillDotPaused: { backgroundColor: Trace.tierOk },
  statusPillText: {
    color: Trace.accent,
    fontFamily: TraceFonts.display,
    fontSize: 11.5,
    letterSpacing: 1,
  },
  statusPillTextPaused: { color: Trace.tierOk },
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
  controlsRow: { flexDirection: 'row', gap: 28 },
  startButton: {
    backgroundColor: Trace.accent,
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: {
    color: Trace.onAccent,
    fontFamily: TraceFonts.display,
    fontSize: 14,
    letterSpacing: 1.2,
  },
  // design §3a — white pause circle, orange stop circle with a white square
  pauseCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    boxShadow: '0 8px 24px rgba(27,27,32,0.16)',
  },
  stopCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Trace.accent,
    boxShadow: '0 0 0 5px rgba(252,82,0,0.16), 0 8px 24px rgba(27,27,32,0.25)',
  },
  stopSquare: { width: 22, height: 22, borderRadius: 5, backgroundColor: '#FFFFFF' },
  hint: {
    color: Trace.textMuted,
    fontFamily: TraceFonts.body,
    fontSize: 13,
    textAlign: 'center',
  },
  // design §3c — dark toast on the light map
  toast: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#1B1B20',
    boxShadow: '0 12px 30px rgba(27,27,32,0.3)',
  },
  toastIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(252,82,0,0.18)',
  },
  toastTitle: { color: '#FFFFFF', fontFamily: TraceFonts.display, fontSize: 13 },
  toastBody: { color: 'rgba(255,255,255,0.55)', fontFamily: TraceFonts.body, fontSize: 11 },
  // design §3a — white camera FAB with the orange focus ring
  momentFab: { alignItems: 'center', alignSelf: 'flex-end', gap: 7 },
  momentButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    boxShadow: '0 0 0 5px rgba(252,82,0,0.14), 0 10px 26px rgba(27,27,32,0.2)',
  },
  momentLabel: {
    color: Trace.text,
    fontFamily: TraceFonts.display,
    fontSize: 11,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
});
