import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ScalePressable } from '@/components/scale-pressable';
import { Trace } from '@/constants/theme';
import { useMapStyle, type MapStyleKey } from '@/features/settings/map-style';

const SEG_W = 42;
const SEG_H = 32;
const PAD = 3;

const OPTIONS: { key: MapStyleKey; icon: SymbolViewProps['name'] }[] = [
  { key: 'dark', icon: { ios: 'moon.fill', android: 'dark_mode', web: 'dark_mode' } },
  { key: 'liberty', icon: { ios: 'sun.max.fill', android: 'light_mode', web: 'light_mode' } },
  { key: 'satellite', icon: { ios: 'globe.americas.fill', android: 'public', web: 'public' } },
];

/**
 * Segmented basemap switcher — the active segment is a sliding accent pill
 * (springs between positions), inactive segments are ghost icons.
 */
export function MapStyleSwitcher({ onChanged }: { onChanged?: (key: MapStyleKey) => void }) {
  const styleKey = useMapStyle((s) => s.styleKey);
  const setStyle = useMapStyle((s) => s.setStyle);
  const activeIdx = OPTIONS.findIndex((o) => o.key === styleKey);

  const x = useSharedValue(activeIdx * SEG_W);
  useEffect(() => {
    x.set(withSpring(activeIdx * SEG_W, { damping: 18, stiffness: 260 }));
  }, [activeIdx, x]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.activePill, pillStyle]} />
      {OPTIONS.map(({ key, icon }, i) => (
        <ScalePressable
          key={key}
          style={styles.segment}
          scaleTo={0.9}
          hitSlop={4}
          onPress={() => {
            if (key === styleKey) return;
            setStyle(key);
            onChanged?.(key);
          }}>
          <SymbolView
            name={icon}
            size={15}
            tintColor={i === activeIdx ? Trace.onAccent : Trace.textSecondary}
          />
        </ScalePressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: PAD,
    borderRadius: (SEG_H + PAD * 2) / 2,
    backgroundColor: `${Trace.backgroundElement}E6`,
    borderWidth: 1,
    borderColor: Trace.border,
  },
  activePill: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    width: SEG_W,
    height: SEG_H,
    borderRadius: SEG_H / 2,
    backgroundColor: Trace.accent,
  },
  segment: {
    width: SEG_W,
    height: SEG_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
