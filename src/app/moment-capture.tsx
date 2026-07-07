import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, Marker } from '@maplibre/maplibre-react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScalePressable } from '@/components/scale-pressable';
import { TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';
import { useMomentsStore } from '@/features/moments/store';
import { formatDuration, formatKm } from '@/features/recording/geo';
import { useRecordingStore } from '@/features/recording/store';
import { MAP_STYLES } from '@/features/settings/map-style';

/**
 * Moment capture (design §3b) — mid-run camera. The viewfinder knows where
 * you are: the photo is pinned to the latest accepted GPS point and pops up
 * at that spot in the activity replay.
 *
 * This screen intentionally uses the design mock's exact palette (signal
 * orange on near-black glass) rather than the app-wide Trace tokens.
 */

const ORANGE = '#FC5200';
const SCREEN_BG = '#101013';
const GLASS = 'rgba(16,16,19,0.7)';
const GLASS_BORDER = 'rgba(255,255,255,0.12)';

export default function MomentCaptureScreen() {
  const router = useRouter();
  // SafeAreaView reports zero insets inside a fullScreenModal — use the hook
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const status = useRecordingStore((s) => s.status);
  const activityId = useRecordingStore((s) => s.activityId);
  const pinMoment = useMomentsStore((s) => s.pinMoment);
  const { elapsedS } = useRecordingStore.getState();

  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState(false);

  const { data: activityRows } = useLiveQuery(
    db.select().from(activities).where(eq(activities.id, activityId ?? '')),
    [activityId],
  );
  const { data: pointRows } = useLiveQuery(
    db
      .select()
      .from(trackPoints)
      .where(eq(trackPoints.activityId, activityId ?? ''))
      .orderBy(trackPoints.seq),
    [activityId],
  );
  const distanceM = activityRows?.[0]?.distanceM ?? 0;
  const points = pointRows ?? [];
  const lastPoint = points[points.length - 1];

  // 1 Hz clock so the elapsed-time chip ticks while framing the shot
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // only reachable mid-activity; bail out if recording ended underneath us
  const active = status === 'recording' || status === 'paused';
  useEffect(() => {
    if (!active && router.canGoBack()) router.back();
  }, [active, router]);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  const capture = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync();
      if (photo?.uri) {
        const pinned = await pinMoment(photo.uri);
        if (pinned) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
          return;
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      {permission.granted && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash ? 'on' : 'off'}
          onCameraReady={() => setReady(true)}
        />
      )}
      {/* design §3b scrim: darkens status bar and control zones only */}
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
        locations={[0, 0.22, 0.62, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View
        style={[
          styles.overlay,
          { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 16) },
        ]}
        pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <ScalePressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={15}
              tintColor="#FFFFFF"
            />
          </ScalePressable>
          <View style={styles.statusChip}>
            <PulseDot />
            <Text style={styles.statusText}>
              {formatDuration(elapsedS())} · {formatKm(distanceM)} km
            </Text>
          </View>
          <View style={styles.topSpacer} />
        </View>

        {!permission.granted ? (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionTitle}>Camera access needed</Text>
            <Text style={styles.permissionBody}>
              Moments pin a photo to the exact spot on your route.
            </Text>
            <ScalePressable
              style={styles.permissionButton}
              onPress={() =>
                permission.canAskAgain ? requestPermission() : Linking.openSettings()
              }>
              <Text style={styles.permissionButtonText}>
                {permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
              </Text>
            </ScalePressable>
          </View>
        ) : (
          <View pointerEvents="box-none" style={styles.bottom}>
            <Animated.View style={styles.hintCard} entering={FadeInDown.duration(280)}>
              <View style={styles.thumb} pointerEvents="none">
                {lastPoint ? (
                  <MapLibreMap
                    mapStyle={MAP_STYLES.dark}
                    style={StyleSheet.absoluteFill}
                    attribution={false}
                    logo={false}
                    compass={false}>
                    <Camera
                      initialViewState={{ center: [lastPoint.lng, lastPoint.lat], zoom: 13.5 }}
                    />
                    {points.length > 1 && (
                      <GeoJSONSource
                        id="thumb-trail"
                        data={{
                          type: 'Feature',
                          properties: {},
                          geometry: {
                            type: 'LineString',
                            coordinates: points.map((p) => [p.lng, p.lat]),
                          },
                        }}>
                        <Layer
                          id="thumb-trail-line"
                          type="line"
                          paint={{ 'line-color': ORANGE, 'line-width': 2.6 }}
                          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                        />
                      </GeoJSONSource>
                    )}
                    <Marker id="thumb-pin" lngLat={[lastPoint.lng, lastPoint.lat]}>
                      <View style={styles.thumbPin} />
                    </Marker>
                  </MapLibreMap>
                ) : null}
              </View>
              <View style={styles.hintTextWrap}>
                <Text style={styles.hintTitle}>Pins to this point</Text>
                <Text style={styles.hintBody}>Shows up here when you replay the run</Text>
              </View>
            </Animated.View>

            <View style={styles.shutterRow}>
              <ScalePressable
                style={styles.sideButton}
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
                scaleTo={0.9}>
                <SymbolView
                  name={{
                    ios: 'arrow.triangle.2.circlepath',
                    android: 'flip_camera_android',
                    web: 'flip_camera_android',
                  }}
                  size={18}
                  tintColor="#FFFFFF"
                />
              </ScalePressable>
              <ScalePressable
                style={[styles.shutter, (!ready || busy) && styles.shutterDisabled]}
                onPress={capture}
                scaleTo={0.88}>
                <View style={styles.shutterInner} />
              </ScalePressable>
              {/* design's star slot — doubles as the flash toggle */}
              <ScalePressable
                style={styles.sideButton}
                onPress={() => setFlash((f) => !f)}
                scaleTo={0.9}>
                <SymbolView
                  name={
                    flash
                      ? { ios: 'star.fill', android: 'star', web: 'star' }
                      : { ios: 'star', android: 'star_outline', web: 'star_outline' }
                  }
                  size={18}
                  tintColor={flash ? ORANGE : '#FFFFFF'}
                />
              </ScalePressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** design tmPulse — the recording dot breathes: scale .55 → 1.5 while fading */
function PulseDot() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.ease) }), -1);
  }, [p]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.55 + p.value * 0.95 }],
    opacity: 0.6 * (1 - p.value),
  }));
  return (
    <View style={styles.dotWrap}>
      <Animated.View style={[styles.dotPulse, pulseStyle]} />
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SCREEN_BG },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  topSpacer: { width: 36 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  dotWrap: { width: 7, height: 7, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ORANGE },
  dotPulse: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: ORANGE,
  },
  statusText: {
    color: '#FFFFFF',
    fontFamily: TraceFonts.mono,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  permissionBox: {
    alignItems: 'center',
    gap: 10,
    padding: 32,
    marginBottom: 120,
  },
  permissionTitle: { color: '#FFFFFF', fontFamily: TraceFonts.display, fontSize: 17 },
  permissionBody: {
    color: 'rgba(255,255,255,0.6)',
    fontFamily: TraceFonts.body,
    fontSize: 13,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 6,
    backgroundColor: ORANGE,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  permissionButtonText: { color: '#FFFFFF', fontFamily: TraceFonts.display, fontSize: 14 },
  bottom: { gap: 32, paddingBottom: 18 },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'center',
    padding: 10,
    paddingRight: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(16,16,19,0.72)',
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1D1E23',
  },
  thumbPin: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ORANGE,
    borderWidth: 1.6,
    borderColor: SCREEN_BG,
  },
  hintTextWrap: { gap: 2 },
  hintTitle: { color: '#FFFFFF', fontFamily: TraceFonts.display, fontSize: 13 },
  hintBody: { color: 'rgba(255,255,255,0.6)', fontFamily: TraceFonts.body, fontSize: 11.5 },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
  },
  sideButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  shutter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 0 4px rgba(252,82,0,0.35)',
  },
  shutterDisabled: { opacity: 0.5 },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: ORANGE },
});
