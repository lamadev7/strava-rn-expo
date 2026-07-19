import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapStyleSwitcher } from '@/components/map-style-switcher';
import { ScalePressable } from '@/components/scale-pressable';
import { Trace, TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { activities, moments, trackPoints, type MomentRow } from '@/db/schema';
import { MomentMarker, type MomentPhase } from '@/features/moments/moment-marker';
import { momentPhotoUri } from '@/features/moments/photos';
import { usePlayback } from '@/features/playback/use-playback';
import { formatDuration, formatKm, formatPace } from '@/features/recording/geo';
import { useRecordingStore } from '@/features/recording/store';
import { MAP_STYLES, useMapStyle, type MapStyleKey } from '@/features/settings/map-style';

const TYPE_LABEL = { run: 'Run', ride: 'Ride', hike: 'Hike' } as const;

/** design §3d — the cinematic replay always runs on the dark basemap */
const REPLAY_BG = '#16171B';

export default function ActivityDetailScreen() {
  const { id, replay } = useLocalSearchParams<{ id: string; replay?: string }>();
  const router = useRouter();
  const { data: activityRows } = useLiveQuery(
    db.select().from(activities).where(eq(activities.id, id ?? '')),
    [id],
  );
  const { data: pointRows } = useLiveQuery(
    db.select().from(trackPoints).where(eq(trackPoints.activityId, id ?? '')).orderBy(trackPoints.seq),
    [id],
  );
  const { data: momentRows } = useLiveQuery(
    db.select().from(moments).where(eq(moments.activityId, id ?? '')).orderBy(moments.distanceM),
    [id],
  );
  const activity = activityRows?.[0];
  const deleteActivity = useRecordingStore((s) => s.deleteActivity);
  const styleKey = useMapStyle((s) => s.styleKey);
  const cameraRef = useRef<CameraRef>(null);

  const [replayMode, setReplayMode] = useState(false);
  /** replay-local basemap — defaults to the cinematic dark map every entry,
      switchable without touching the user's global preference */
  const [replayStyle, setReplayStyle] = useState<MapStyleKey>('dark');
  /** moment manually opened by tapping its pin/chip (design §3f step 4) */
  const [openMoment, setOpenMoment] = useState<string | null>(null);
  const playback = usePlayback(pointRows ?? []);

  // deep link straight into the cinematic replay: myapp://activity/<id>?replay=1
  const wantReplay = replay === '1' && (pointRows?.length ?? 0) > 1 && !replayMode;
  useEffect(() => {
    if (!wantReplay) return;
    const t = setTimeout(() => {
      setReplayMode(true);
      playback.toggle();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantReplay]);

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

  // ——— single-popup rule state (hooks must sit above the early return) ———
  const momentList = momentRows ?? [];
  const replaying = replayMode && playback.frame != null;

  // ——— 10 s auto-close: any open card collapses on its own ———
  // dismissed ids force a dwell-derived 'open' down to 'chip'; a chip tap
  // (manual openMoment) reopens and restarts its own 10 s clock.
  const [dismissed, setDismissed] = useState<string[]>([]);

  // ——— replay rotation: app is portrait-locked; replay may go landscape ———
  useEffect(() => {
    if (!replayMode) return;
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [replayMode]);

  // ——— replay camera follow: glide with the marker so the user never drags ———
  // frame updates ~30 fps; a 500 ms easeTo cadence with matching duration
  // reads as one continuous camera glide. Paused → follow stops, map is free.
  const frameRef = useRef(playback.frame);
  frameRef.current = playback.frame;
  useEffect(() => {
    if (!(replayMode && playback.playing)) return;
    const first = frameRef.current;
    if (first) cameraRef.current?.setStop({ center: first.lngLat, zoom: 15.5, duration: 700 });
    const id = setInterval(() => {
      const frame = frameRef.current;
      if (frame) cameraRef.current?.easeTo({ center: frame.lngLat, duration: 520 });
    }, 500);
    return () => clearInterval(id);
  }, [replayMode, playback.playing]);
  const currentMomentId = replaying
    ? (momentList.filter((m) => playback.frame!.distanceM >= m.distanceM).at(-1)?.id ?? null)
    : null;
  // a manually opened card yields as soon as the replay pops the next one
  useEffect(() => {
    if (currentMomentId) setOpenMoment((cur) => (cur === currentMomentId ? cur : null));
  }, [currentMomentId]);

  // the card currently showing large, from either source (manual tap wins)
  const activeOpenId = openMoment ?? (currentMomentId && !dismissed.includes(currentMomentId) ? currentMomentId : null);
  useEffect(() => {
    if (!activeOpenId) return;
    const t = setTimeout(() => {
      setDismissed((prev) => (prev.includes(activeOpenId) ? prev : [...prev, activeOpenId]));
      setOpenMoment((cur) => (cur === activeOpenId ? null : cur));
    }, 10_000);
    return () => clearTimeout(t);
  }, [activeOpenId]);

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
  const bounds: [number, number, number, number] | null = hasTrack
    ? [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
    : null;

  const route: GeoJSON.Feature<GeoJSON.LineString> | null = hasTrack
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
    : null;

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

  // popup choreography (design §3f): pop when the replay marker passes the
  // pin, dwell for ~20% of the run's distance, then settle into a tappable chip.
  // Single-popup rule (state above the early return): only currentMomentId may
  // hold the open card — earlier cards collapse to chips the moment a new one pops.
  const dwellM = Math.max(200, activity.distanceM * 0.2);
  const phaseFor = (m: MomentRow): MomentPhase => {
    if (openMoment === m.id) return 'open';
    if (!replaying) return 'hidden';
    const gone = playback.frame!.distanceM - m.distanceM;
    if (gone < 0) return 'hidden';
    return m.id === currentMomentId && gone < dwellM && !dismissed.includes(m.id)
      ? 'open'
      : 'chip';
  };
  const toggleMoment = (momentId: string) =>
    setOpenMoment((cur) => (cur === momentId ? null : momentId));

  const startReplay = () => {
    setReplayMode(true);
    setReplayStyle('dark');
    setDismissed([]);
    if (!playback.playing) playback.toggle();
  };
  const exitReplay = () => {
    playback.reset();
    setReplayMode(false);
    setOpenMoment(null);
    setDismissed([]);
  };

  const when = new Date(activity.startedAt).toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ══════════ design §3e — light activity detail ══════════
          unmounted while the replay is up: guarantees nothing shows behind
          the replay (and frees the detail map + filmstrip during it) */}
      {!replayMode && (
      <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <ScalePressable style={styles.headerButton} onPress={() => router.back()} hitSlop={8}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={13}
              tintColor={Trace.text}
            />
          </ScalePressable>
          <Text style={styles.headerTitle}>Activity</Text>
          <ScalePressable style={styles.headerButton} onPress={confirmDelete} hitSlop={8}>
            <SymbolView
              name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
              size={14}
              tintColor={Trace.text}
            />
          </ScalePressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{TYPE_LABEL[activity.type]}</Text>
            <Text style={styles.subtitle}>
              {when} · {points.length} GPS points
              {activity.type === 'hike' && activity.elevLossM != null
                ? ` · ↓${Math.round(activity.elevLossM)} m descent`
                : ''}
            </Text>
          </View>

          <View style={styles.mapCard}>
            {hasTrack ? (
              <MapLibreMap mapStyle={MAP_STYLES[styleKey]} style={StyleSheet.absoluteFill}>
                <Camera
                  initialViewState={{
                    bounds: bounds!,
                    padding: { top: 40, bottom: 40, left: 40, right: 40 },
                    // tilt into the 3D terrain when the satellite basemap is up
                    pitch: styleKey === 'satellite' ? 50 : 0,
                  }}
                />
                {route && (
                  <GeoJSONSource id="route" data={route}>
                    <Layer
                      id="route-line"
                      type="line"
                      paint={{ 'line-color': Trace.accent, 'line-width': 4.5 }}
                      layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                    />
                  </GeoJSONSource>
                )}
                {momentList.map((m) => (
                  <Marker key={`pin-${m.id}`} id={`moment-pin-${m.id}`} lngLat={[m.lng, m.lat]}>
                    <ScalePressable
                      style={styles.momentPin}
                      onPress={() => toggleMoment(m.id)}
                      hitSlop={6}
                      scaleTo={0.85}>
                      <SymbolView
                        name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                        size={11}
                        tintColor={Trace.accent}
                      />
                    </ScalePressable>
                  </Marker>
                ))}
                {momentList.map((m) => (
                  <Marker
                    key={`card-${m.id}`}
                    id={`moment-card-${m.id}`}
                    lngLat={[m.lng, m.lat]}
                    anchor="bottom"
                    pointerEvents="box-none">
                    <MomentMarker
                      uri={momentPhotoUri(m.photo)}
                      caption={`${formatKm(m.distanceM)} KM · ${formatDuration(m.elapsedS)}`}
                      place={m.place}
                      phase={openMoment === m.id ? 'open' : 'hidden'}
                      onPress={() => toggleMoment(m.id)}
                    />
                  </Marker>
                ))}
              </MapLibreMap>
            ) : (
              <View style={styles.noTrack}>
                <Text style={styles.noTrackText}>Not enough GPS points for a map.</Text>
              </View>
            )}
            {hasTrack && (
              <ScalePressable style={styles.watchReplay} onPress={startReplay} scaleTo={0.92}>
                <SymbolView
                  name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                  size={11}
                  tintColor="#FFFFFF"
                />
                <Text style={styles.watchReplayText}>Watch replay</Text>
              </ScalePressable>
            )}
          </View>

          <View style={styles.statsCard}>
            <Stat value={formatKm(activity.distanceM)} label="KM" />
            <View style={styles.divider} />
            <Stat value={formatDuration(activity.durationS)} label="TIME" />
            <View style={styles.divider} />
            {/* hikes lead with climb; run/ride lead with pace */}
            {activity.type === 'hike' ? (
              <Stat value={`↑${Math.round(activity.elevGainM ?? 0)}`} label="ELEV M" />
            ) : (
              <Stat value={formatPace(activity.distanceM, activity.durationS)} label="PACE /KM" />
            )}
            {activity.steps != null && (
              <>
                <View style={styles.divider} />
                <Stat value={activity.steps.toLocaleString()} label="STEPS" />
              </>
            )}
          </View>

          {momentList.length > 0 && (
            <View style={styles.momentsSection}>
              <View style={styles.momentsHeader}>
                <Text style={styles.momentsTitle}>Moments</Text>
                <Text style={styles.momentsCount}>
                  {momentList.length} pinned to the route
                </Text>
              </View>
              {/* windowed list: a ScrollView mounted (and decoded) every photo
                  at once — with dozens of moments that alone could OOM */}
              <FlatList
                horizontal
                data={momentList}
                keyExtractor={(m) => m.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filmstrip}
                initialNumToRender={5}
                maxToRenderPerBatch={4}
                windowSize={3}
                removeClippedSubviews
                renderItem={({ item: m }) => (
                  <ScalePressable style={styles.filmstripItem} scaleTo={0.93} onPress={startReplay}>
                    <Image
                      source={{ uri: momentPhotoUri(m.photo) }}
                      style={styles.filmstripPhoto}
                      contentFit="cover"
                      transition={120}
                    />
                    <Text style={styles.filmstripCaption}>{formatKm(m.distanceM)} KM</Text>
                  </ScalePressable>
                )}
              />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
      )}

      {/* ══════════ design §3d — cinematic replay on the dark map ══════════ */}
      {replayMode && hasTrack && (
        <Animated.View
          style={styles.replayOverlay}
          entering={FadeIn.duration(260)}
          exiting={FadeOut.duration(200)}>
          <MapLibreMap
            mapStyle={MAP_STYLES[replayStyle]}
            style={StyleSheet.absoluteFill}
            logo={false}>
            <Camera
              ref={cameraRef}
              initialViewState={{
                bounds: bounds!,
                padding: { top: 80, bottom: 160, left: 40, right: 40 },
              }}
            />
            {route && (
              <GeoJSONSource id="replay-route" data={route}>
                <Layer
                  id="replay-route-line"
                  type="line"
                  paint={{ 'line-color': '#3A3D46', 'line-width': 4 }}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                />
              </GeoJSONSource>
            )}
            {route && (
              <GeoJSONSource id="replay-traveled" data={traveled ?? route}>
                <Layer
                  id="replay-traveled-line"
                  type="line"
                  paint={{
                    'line-color': Trace.accent,
                    'line-width': 5,
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
              <View style={[styles.replayDotWrap, { opacity: replaying ? 1 : 0 }]}>
                <View style={styles.replayDot} />
              </View>
            </Marker>
            {momentList.map((m) => (
              <Marker key={`rpin-${m.id}`} id={`replay-pin-${m.id}`} lngLat={[m.lng, m.lat]} pointerEvents="none">
                <View
                  style={[
                    styles.replayPinDot,
                    replaying &&
                      playback.frame!.distanceM >= m.distanceM &&
                      styles.replayPinDotPassed,
                  ]}
                />
              </Marker>
            ))}
            {momentList.map((m) => (
              <Marker
                key={`rcard-${m.id}`}
                id={`replay-card-${m.id}`}
                lngLat={[m.lng, m.lat]}
                anchor="bottom"
                pointerEvents="box-none">
                <MomentMarker
                  uri={momentPhotoUri(m.photo)}
                  caption={`${formatKm(m.distanceM)} KM · ${formatDuration(m.elapsedS)}`}
                  place={m.place}
                  phase={phaseFor(m)}
                  onPress={() => toggleMoment(m.id)}
                />
              </Marker>
            ))}
          </MapLibreMap>

          <SafeAreaView style={styles.replayChrome} pointerEvents="box-none">
            <View pointerEvents="box-none">
              <View style={styles.replayTopRow} pointerEvents="box-none">
                <ScalePressable style={styles.replayGlassButton} onPress={exitReplay} hitSlop={8}>
                  <SymbolView
                    name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
                    size={14}
                    tintColor="#FFFFFF"
                  />
                </ScalePressable>
                <View style={styles.replayTitleChip}>
                  <Text style={styles.replayTitle}>{TYPE_LABEL[activity.type]}</Text>
                  <Text style={styles.replayTitleTag}>REPLAY</Text>
                </View>
                <ScalePressable
                  style={styles.replayGlassButton}
                  onPress={playback.cycleRate}
                  hitSlop={8}>
                  <SymbolView
                    name={{ ios: 'gauge.with.needle', android: 'speed', web: 'speed' }}
                    size={15}
                    tintColor="#FFFFFF"
                  />
                </ScalePressable>
              </View>
              <View style={styles.replaySwitcherRow} pointerEvents="box-none">
                <MapStyleSwitcher
                  value={replayStyle}
                  onSelect={setReplayStyle}
                  onChanged={(key) =>
                    cameraRef.current?.setStop({ pitch: key === 'satellite' ? 50 : 0, duration: 600 })
                  }
                />
              </View>
            </View>

            <View style={styles.replayPanel}>
              <View style={styles.replayControlsRow}>
                <ScalePressable style={styles.playButton} onPress={playback.toggle} scaleTo={0.9}>
                  <SymbolView
                    name={
                      playback.playing
                        ? { ios: 'pause.fill', android: 'pause', web: 'pause' }
                        : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }
                    }
                    size={16}
                    tintColor="#FFFFFF"
                  />
                </ScalePressable>
                <View style={styles.progressColumn}>
                  <View style={styles.progressTrack}>
                    <View
                      style={[styles.progressFill, { width: `${playback.progress * 100}%` }]}
                    />
                    {momentList.map((m) => (
                      <View
                        key={m.id}
                        style={[
                          styles.progressDot,
                          { left: `${playback.progressAtDistance(m.distanceM) * 100}%` },
                        ]}
                      />
                    ))}
                  </View>
                  <View style={styles.progressLabels}>
                    <Text style={styles.progressTime}>
                      {formatDuration(playback.frame?.elapsedS ?? 0)}
                    </Text>
                    <Text style={styles.progressMoments}>
                      {momentList.length > 0
                        ? `${momentList.length} moment${momentList.length === 1 ? '' : 's'}`
                        : ''}
                    </Text>
                    <Text style={styles.progressTime}>{formatDuration(activity.durationS)}</Text>
                  </View>
                </View>
                <ScalePressable style={styles.rateChip} onPress={playback.cycleRate} scaleTo={0.92}>
                  <Text style={styles.rateText}>{playback.rate}×</Text>
                </ScalePressable>
              </View>
            </View>
          </SafeAreaView>
        </Animated.View>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Trace.background },
  page: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 4,
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Trace.border,
  },
  headerTitle: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 14 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 12 },
  titleBlock: { paddingHorizontal: 6, gap: 2 },
  title: {
    color: Trace.text,
    fontFamily: TraceFonts.display,
    fontSize: 24,
    letterSpacing: -0.2,
  },
  subtitle: { color: Trace.textMuted, fontFamily: TraceFonts.body, fontSize: 12.5 },
  mapCard: {
    height: 280,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#ECE9E1',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  noTrack: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noTrackText: { color: Trace.textSecondary, fontFamily: TraceFonts.body, fontSize: 14 },
  watchReplay: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: '#1B1B20',
    boxShadow: '0 6px 16px rgba(27,27,32,0.3)',
  },
  watchReplayText: { color: '#FFFFFF', fontFamily: TraceFonts.display, fontSize: 12 },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  stat: { flex: 1, gap: 2 },
  statValue: {
    color: Trace.text,
    fontFamily: TraceFonts.mono,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: Trace.textMuted,
    fontFamily: TraceFonts.displayMedium,
    fontSize: 10.5,
    letterSpacing: 1.2,
  },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.07)', marginHorizontal: 16 },
  momentsSection: { gap: 9 },
  momentsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 6,
  },
  momentsTitle: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 14 },
  momentsCount: { color: Trace.textMuted, fontFamily: TraceFonts.body, fontSize: 12 },
  filmstrip: { gap: 10 },
  filmstripItem: { alignItems: 'center', gap: 5 },
  filmstripPhoto: {
    width: 86,
    height: 86,
    borderRadius: 14,
    backgroundColor: '#ECE9E1',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  filmstripCaption: {
    color: Trace.textMuted,
    fontFamily: TraceFonts.mono,
    fontSize: 9.5,
    fontVariant: ['tabular-nums'],
  },
  momentPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    boxShadow: '0 2px 8px rgba(27,27,32,0.25)',
  },
  missing: { color: Trace.textSecondary, fontFamily: TraceFonts.body, fontSize: 14, padding: 24 },

  // ── replay overlay (design §3d) ──
  replayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: REPLAY_BG,
  },
  replayChrome: { flex: 1, justifyContent: 'space-between' },
  replayTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  replayGlassButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,23,27,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  replayTitleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(22,23,27,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  replaySwitcherRow: { alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 10 },
  replayTitle: { color: '#FFFFFF', fontFamily: TraceFonts.display, fontSize: 12.5 },
  replayTitleTag: { color: 'rgba(255,255,255,0.5)', fontFamily: TraceFonts.body, fontSize: 11 },
  replayDotWrap: { alignItems: 'center', justifyContent: 'center' },
  replayDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Trace.accent,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    boxShadow: '0 0 14px rgba(252,82,0,0.8)',
  },
  replayPinDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#3A3D46',
    borderWidth: 2,
    borderColor: REPLAY_BG,
  },
  replayPinDotPassed: { backgroundColor: Trace.accent },
  replayPanel: {
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 22,
    backgroundColor: 'rgba(22,23,27,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    boxShadow: '0 12px 34px rgba(0,0,0,0.5)',
    paddingTop: 14,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  replayControlsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Trace.accent,
    boxShadow: '0 0 0 4px rgba(252,82,0,0.18)',
  },
  progressColumn: { flex: 1, gap: 7 },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: Trace.accent },
  progressDot: {
    position: 'absolute',
    top: '50%',
    width: 7,
    height: 7,
    marginTop: -3.5,
    marginLeft: -3.5,
    borderRadius: 3.5,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(252,82,0,0.6)',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTime: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: TraceFonts.mono,
    fontSize: 10.5,
    fontVariant: ['tabular-nums'],
  },
  progressMoments: { color: 'rgba(255,255,255,0.4)', fontFamily: TraceFonts.body, fontSize: 10.5 },
  rateChip: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  rateText: {
    color: '#FFFFFF',
    fontFamily: TraceFonts.mono,
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
});
