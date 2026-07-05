import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, Trace, TraceFonts } from '@/constants/theme';

type StartMode = 'door' | 'pin';

/**
 * Screen 2a — scan setup. The scan engine ships at M5 (circle/oval via ORS)
 * and M6 (full library); until then the CTA is honest about what's coming.
 * No fake scores, ever (TECH_SPEC §6.1 decision B).
 */
export default function ShapesScreen() {
  const [distanceKm, setDistanceKm] = useState(5.0);
  const [startMode, setStartMode] = useState<StartMode>('door');
  const [scanRequested, setScanRequested] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Shapes</Text>
        <Text style={styles.subtitle}>What can your streets draw?</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>START FROM</Text>
          <View style={styles.segment}>
            <Pressable
              style={[styles.segmentItem, startMode === 'door' && styles.segmentItemActive]}
              onPress={() => setStartMode('door')}>
              <Text style={[styles.segmentText, startMode === 'door' && styles.segmentTextActive]}>
                My door
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentItem, startMode === 'pin' && styles.segmentItemActive]}
              onPress={() => setStartMode('pin')}>
              <Text style={[styles.segmentText, startMode === 'pin' && styles.segmentTextActive]}>
                Drop a pin
              </Text>
            </Pressable>
          </View>
          {startMode === 'pin' && (
            <Text style={styles.hint}>Pin picker arrives with the scan engine.</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.distanceRow}>
            <Text style={styles.cardLabel}>DISTANCE</Text>
            <Text style={styles.distanceValue}>
              {distanceKm.toFixed(1)} <Text style={styles.distanceUnit}>km</Text>
            </Text>
          </View>
          <Slider
            minimumValue={1}
            maximumValue={21}
            step={0.5}
            value={distanceKm}
            onValueChange={setDistanceKm}
            minimumTrackTintColor={Trace.accent}
            maximumTrackTintColor={Trace.border}
            thumbTintColor={Trace.accent}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>1 km</Text>
            <Text style={styles.sliderLabel}>21 km — you animal</Text>
          </View>
          <Text style={styles.hint}>Longer runs unlock fussier shapes — stars need room.</Text>
        </View>

        <Pressable style={styles.scanButton} onPress={() => setScanRequested(true)}>
          <Text style={styles.scanText}>Scan my area</Text>
        </Pressable>

        {scanRequested && (
          <View style={styles.comingSoon}>
            <Text style={styles.comingSoonTitle}>The scanner is in training.</Text>
            <Text style={styles.comingSoonBody}>
              Circle and oval routes arrive first, then the full shape library with honest match
              scores for your streets. Recording works today — go log a run.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Trace.background },
  content: { padding: 20, paddingBottom: BottomTabInset + 24, gap: 16 },
  title: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 34 },
  subtitle: {
    color: Trace.textSecondary,
    fontFamily: TraceFonts.body,
    fontSize: 16,
    marginTop: -8,
    marginBottom: 8,
  },
  card: {
    backgroundColor: Trace.backgroundElement,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Trace.border,
    gap: 12,
  },
  cardLabel: {
    color: Trace.textMuted,
    fontFamily: TraceFonts.displayMedium,
    fontSize: 11,
    letterSpacing: 1.4,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: Trace.background,
    borderRadius: 999,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
  },
  segmentItemActive: { backgroundColor: Trace.backgroundSelected },
  segmentText: { color: Trace.textSecondary, fontFamily: TraceFonts.displayMedium, fontSize: 14 },
  segmentTextActive: { color: Trace.accent },
  distanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  distanceValue: {
    color: Trace.text,
    fontFamily: TraceFonts.monoBold,
    fontSize: 28,
    fontVariant: ['tabular-nums'],
  },
  distanceUnit: { color: Trace.textSecondary, fontFamily: TraceFonts.mono, fontSize: 16 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderLabel: { color: Trace.textMuted, fontFamily: TraceFonts.body, fontSize: 11 },
  hint: { color: Trace.textMuted, fontFamily: TraceFonts.body, fontSize: 12.5 },
  scanButton: {
    backgroundColor: Trace.accent,
    borderRadius: 999,
    paddingVertical: 18,
    alignItems: 'center',
  },
  scanText: {
    color: Trace.onAccent,
    fontFamily: TraceFonts.display,
    fontSize: 16,
    letterSpacing: 0.4,
  },
  comingSoon: {
    backgroundColor: Trace.backgroundElement,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Trace.border,
    gap: 6,
  },
  comingSoonTitle: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 16 },
  comingSoonBody: {
    color: Trace.textSecondary,
    fontFamily: TraceFonts.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
