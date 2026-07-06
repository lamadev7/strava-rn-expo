import { Marker, useCurrentPosition } from '@maplibre/maplibre-react-native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Trace } from '@/constants/theme';

const SIZE = 140;

/**
 * Pre-baked Apple-Maps-style flashlight cone (apex at center, points up) —
 * per-pixel alpha gradient, strongest at the dot, fading outward with soft
 * edges. Regenerate with scripts/gen-heading-beam.js if the accent changes.
 */
const BEAM = require('@/assets/images/heading-beam.png');

/**
 * Glowing user-location puck with a realtime compass beam.
 *
 * Rendered as a React Native view via Marker (not map style layers) so the
 * whole thing is one accent color, the glow can breathe with Reanimated, and
 * the beam rotates with a plain view transform driven by the magnetometer
 * (watchHeadingAsync) — GPS course only updates while moving; the compass
 * follows where the device FACES, even standing still.
 *
 * Note: beam rotation is screen-space, correct because the app never rotates
 * the map (camera bearing stays 0 / north-up).
 */
export function HeadingPuck() {
  const position = useCurrentPosition();
  const [hasHeading, setHasHeading] = useState(false);

  /** continuous angle (can exceed 360°) so 359°→1° sweeps 2°, not -358° */
  const rotation = useSharedValue(0);
  const continuous = useRef(0);
  const lastMod = useRef<number | null>(null);

  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.set(
      withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, false),
    );
  }, [pulse]);

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      try {
        const s = await Location.watchHeadingAsync((h) => {
          // iOS reports trueHeading -1 until calibrated; fall back to magnetic
          const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (lastMod.current === null) {
            lastMod.current = value;
            continuous.current = value;
            rotation.set(value);
            setHasHeading(true);
            return;
          }
          const delta = ((value - lastMod.current + 540) % 360) - 180;
          if (Math.abs(delta) < 2) return; // ignore sub-2° jitter
          lastMod.current = value;
          continuous.current += delta;
          rotation.set(withTiming(continuous.current, { duration: 200 }));
        });
        if (cancelled) s.remove();
        else sub = s;
      } catch {
        // no magnetometer / permission — puck renders without the beam
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [rotation]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.get(), [0, 0.5, 1], [0.35, 0.08, 0.35]),
    transform: [{ scale: interpolate(pulse.get(), [0, 0.5, 1], [1, 1.45, 1]) }],
  }));
  const beamStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  if (!position?.coords) return null;

  return (
    <Marker
      id="trace-user-puck"
      lngLat={[position.coords.longitude, position.coords.latitude]}
      pointerEvents="none">
      <View style={styles.wrap}>
        <Animated.View style={[styles.glow, glowStyle]} />
        {hasHeading && (
          <Animated.View style={[styles.beamWrap, beamStyle]}>
            <Image source={BEAM} style={styles.beamImage} contentFit="contain" />
          </Animated.View>
        )}
        <View style={styles.dot} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Trace.accent,
  },
  beamWrap: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
  },
  beamImage: { width: SIZE, height: SIZE },
  // Apple-Maps-style dot: solid accent fill, crisp white border
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Trace.accent,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },
});
