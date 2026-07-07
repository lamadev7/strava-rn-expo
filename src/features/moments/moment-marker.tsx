import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ScalePressable } from '@/components/scale-pressable';
import { Trace, TraceFonts } from '@/constants/theme';

/**
 * Moment popup on the map — motion spec (design §3f):
 * pop 0 → 1 with gentle overshoot · 380 ms · cubic-bezier(.34, 1.4, .64, 1),
 * settle to a 23% photo-chip · 300 ms ease-in-out · tap to reopen.
 * Scale originates at the pin tail (bottom center).
 */

export type MomentPhase = 'hidden' | 'open' | 'chip';

const CARD_W = 118;
const CARD_H = 152;
const POP = Easing.bezier(0.34, 1.4, 0.64, 1);
const SETTLE = Easing.inOut(Easing.ease);
const CHIP_SCALE = 0.23;

export function MomentMarker({
  uri,
  caption,
  phase,
  onPress,
}: {
  uri: string;
  caption: string;
  phase: MomentPhase;
  onPress?: () => void;
}) {
  const scale = useSharedValue(0);

  useEffect(() => {
    if (phase === 'open') {
      scale.value = withTiming(1, { duration: 380, easing: POP });
    } else if (phase === 'chip') {
      scale.value = withTiming(CHIP_SCALE, { duration: 300, easing: SETTLE });
    } else {
      scale.value = withTiming(0, { duration: 160, easing: SETTLE });
    }
  }, [phase, scale]);

  const animatedStyle = useAnimatedStyle(() => {
    const s = scale.value;
    return {
      opacity: s > 0.01 ? 1 : 0,
      // fake a bottom-center transform origin so the card grows out of the pin
      transform: [{ translateY: ((1 - s) * CARD_H) / 2 }, { scale: s }],
    };
  });
  // caption is unreadable at chip scale — design settles to a photo-only chip
  const captionStyle = useAnimatedStyle(() => ({ opacity: scale.value > 0.6 ? 1 : 0 }));

  return (
    <Animated.View style={[styles.wrap, animatedStyle]} pointerEvents={phase === 'hidden' ? 'none' : 'auto'}>
      <ScalePressable style={styles.card} onPress={onPress} scaleTo={0.95} disabled={!onPress}>
        <Image source={{ uri }} style={styles.photo} contentFit="cover" transition={120} />
        <Animated.Text style={[styles.caption, captionStyle]} numberOfLines={1}>
          {caption}
        </Animated.Text>
      </ScalePressable>
      <View style={styles.tail} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: CARD_W, height: CARD_H, alignItems: 'center' },
  card: {
    width: CARD_W,
    backgroundColor: Trace.backgroundElement,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Trace.border,
    padding: 6,
    paddingBottom: 8,
    gap: 5,
    alignItems: 'center',
  },
  photo: { width: CARD_W - 12, height: CARD_W - 12, borderRadius: 11 },
  caption: {
    fontFamily: TraceFonts.mono,
    fontSize: 9.5,
    color: Trace.textMuted,
    fontVariant: ['tabular-nums'],
  },
  tail: {
    width: 14,
    height: 14,
    marginTop: -8,
    borderRadius: 2,
    backgroundColor: Trace.backgroundElement,
    transform: [{ rotate: '45deg' }],
  },
});
