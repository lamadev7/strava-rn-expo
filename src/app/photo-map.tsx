import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScalePressable } from '@/components/scale-pressable';
import { Trace, TraceFonts } from '@/constants/theme';
import { db } from '@/db/client';
import { photoPins } from '@/db/schema';
import { MAP_STYLES, useMapStyle } from '@/features/settings/map-style';

/**
 * Photo Map — scans the camera roll for photos with EXIF GPS and maps each
 * as a dot, streaming onto the map as the scan progresses. Save persists the
 * pins (coordinates only, never image data) so the main Record map shows
 * them. Photos without location tags are counted and skipped.
 */

type Pin = { id: string; lat: number; lng: number; timestamp: number };
type ScanState = 'idle' | 'scanning' | 'done' | 'denied' | 'saved';

const BATCH = 100;

export default function PhotoMapScreen() {
  const router = useRouter();
  const styleKey = useMapStyle((s) => s.styleKey);
  const [scan, setScan] = useState<ScanState>('idle');
  const [scanned, setScanned] = useState(0);
  const [pins, setPins] = useState<Pin[]>([]);
  const [saving, setSaving] = useState(false);
  const cancelRef = useRef(false);

  const analyze = async () => {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) {
      setScan('denied');
      return;
    }
    setScan('scanning');
    setScanned(0);
    setPins([]);
    cancelRef.current = false;

    let total = 0;
    const found: Pin[] = [];
    try {
      // page through the camera roll; each asset's GPS tag is read individually
      for (let offset = 0; ; offset += BATCH) {
        if (cancelRef.current) return;
        const page = await new MediaLibrary.Query()
          .eq(MediaLibrary.AssetField.MEDIA_TYPE, MediaLibrary.MediaType.IMAGE)
          .orderBy(MediaLibrary.AssetField.CREATION_TIME)
          .offset(offset)
          .limit(BATCH)
          .exe();
        if (page.length === 0) break;
        for (const asset of page) {
          if (cancelRef.current) return;
          total += 1;
          try {
            const loc = await asset.getLocation();
            if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
              const timestamp = (await asset.getCreationTime().catch(() => null)) ?? 0;
              found.push({ id: asset.id, lat: loc.latitude, lng: loc.longitude, timestamp });
            }
          } catch {
            // unreadable asset (iCloud offload etc.) — skip
          }
          if (total % 20 === 0) {
            setScanned(total);
            setPins([...found]); // stream dots onto the map as we go
          }
        }
        if (page.length < BATCH) break;
      }
    } finally {
      setScanned(total);
      setPins([...found]);
      setScan('done');
    }
  };

  const save = async () => {
    if (!pins.length || saving) return;
    setSaving(true);
    try {
      for (let i = 0; i < pins.length; i += 200) {
        await db
          .insert(photoPins)
          .values(pins.slice(i, i + 200))
          .onConflictDoNothing();
      }
      setScan('saved');
    } finally {
      setSaving(false);
    }
  };

  const dots: GeoJSON.FeatureCollection | null = pins.length
    ? {
        type: 'FeatureCollection',
        features: pins.map((p) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        })),
      }
    : null;

  // fit camera to found pins (updates as the scan streams)
  const lngs = pins.map((p) => p.lng);
  const lats = pins.map((p) => p.lat);
  const bounds: [number, number, number, number] | null =
    pins.length > 1
      ? [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
      : null;

  return (
    <View style={styles.container}>
      <MapLibreMap mapStyle={MAP_STYLES[styleKey]} style={StyleSheet.absoluteFill}>
        {bounds ? (
          <Camera
            bounds={bounds}
            padding={{ top: 120, bottom: 200, left: 50, right: 50 }}
            duration={600}
          />
        ) : (
          <Camera initialViewState={{ zoom: 1.5 }} />
        )}
        {dots && (
          <GeoJSONSource id="photo-dots" data={dots}>
            <Layer
              id="photo-dots-circles"
              type="circle"
              paint={{
                'circle-radius': 4,
                'circle-color': Trace.tierGreat,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#0E120C',
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="box-none">
          <ScalePressable style={styles.headerButton} onPress={() => router.back()} hitSlop={8}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={13}
              tintColor={Trace.text}
            />
          </ScalePressable>
          <Text style={styles.headerTitle}>Photo Map</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          {scan === 'scanning' && (
            <Animated.Text entering={FadeInDown.duration(200)} style={styles.progress}>
              {scanned.toLocaleString()} photos scanned · {pins.length.toLocaleString()} with location
            </Animated.Text>
          )}
          {(scan === 'done' || scan === 'saved') && (
            <Animated.Text entering={FadeInDown.duration(200)} style={styles.progress}>
              {pins.length.toLocaleString()} of {scanned.toLocaleString()} photos have a location
              {scan === 'saved' ? ' · saved ✓' : ''}
            </Animated.Text>
          )}
          {scan === 'denied' && (
            <Text style={styles.progress}>
              Photo access denied — allow it in Settings to map your shots.
            </Text>
          )}

          {scan === 'idle' || scan === 'denied' ? (
            <ScalePressable style={styles.primaryButton} onPress={analyze}>
              <Text style={styles.primaryText}>Analyze my photos</Text>
            </ScalePressable>
          ) : scan === 'scanning' ? (
            <ScalePressable
              style={styles.secondaryButton}
              onPress={() => {
                cancelRef.current = true;
                setScan('done');
              }}>
              <Text style={styles.secondaryText}>Stop</Text>
            </ScalePressable>
          ) : scan === 'done' && pins.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(150)}>
              <ScalePressable style={styles.primaryButton} onPress={save} disabled={saving}>
                <Text style={styles.primaryText}>
                  {saving ? 'Saving…' : `Save ${pins.length.toLocaleString()} pins to my map`}
                </Text>
              </ScalePressable>
            </Animated.View>
          ) : scan === 'saved' ? (
            <ScalePressable style={styles.secondaryButton} onPress={() => router.back()}>
              <Text style={styles.secondaryText}>Done — see them on the map</Text>
            </ScalePressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Trace.background },
  overlay: { flex: 1, justifyContent: 'space-between' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: `${Trace.backgroundElement}E6`,
    borderWidth: 1,
    borderColor: Trace.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 16 },
  bottom: { padding: 20, gap: 12, alignItems: 'center' },
  progress: {
    color: Trace.textSecondary,
    fontFamily: TraceFonts.mono,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
    backgroundColor: `${Trace.backgroundElement}E6`,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  primaryButton: {
    backgroundColor: Trace.accent,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 16,
  },
  primaryText: { color: Trace.onAccent, fontFamily: TraceFonts.display, fontSize: 15 },
  secondaryButton: {
    backgroundColor: `${Trace.backgroundElement}F0`,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: Trace.border,
  },
  secondaryText: { color: Trace.text, fontFamily: TraceFonts.display, fontSize: 15 },
});
