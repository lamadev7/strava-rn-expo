import * as MediaLibrary from 'expo-media-library';
import { useEffect, useState } from 'react';

import type { ActivityRow, TrackPointRow } from '@/db/schema';
import { haversineM } from '@/features/recording/geo';

/**
 * Photos taken with ANY camera during an activity's time window, pulled live
 * from the photo library and pinned onto the route — nothing copied, nothing
 * stored. Position prefers the photo's own EXIF GPS (true location); falls
 * back to where you were on the path at that timestamp. Path distance (for
 * replay pop order) always comes from the timestamp-matched track point.
 *
 * A per-activity time-window query touches a handful of assets, so live
 * reading is cheap here — unlike the whole-roll scan, which stays cached.
 */

export type GalleryMoment = {
  id: string;
  uri: string;
  lat: number;
  lng: number;
  distanceM: number;
  elapsedS: number;
};

/** module-level cache: asset id → resolved moment; photo metadata is immutable */
const cache = new Map<string, GalleryMoment | null>();

export function useGalleryMoments(
  activity: Pick<ActivityRow, 'id' | 'startedAt' | 'endedAt'> | undefined,
  points: TrackPointRow[],
): GalleryMoment[] {
  const [items, setItems] = useState<GalleryMoment[]>([]);
  const activityId = activity?.id;
  const startedAt = activity?.startedAt;
  const endedAt = activity?.endedAt;
  const havePoints = points.length > 1;

  useEffect(() => {
    if (!activityId || !startedAt || !endedAt || !havePoints) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const perm = await MediaLibrary.getPermissionsAsync();
        if (!perm.granted) return; // never prompt from a detail screen — the photo map owns the permission ask

        const assets = await new MediaLibrary.Query()
          .eq(MediaLibrary.AssetField.MEDIA_TYPE, MediaLibrary.MediaType.IMAGE)
          .gte(MediaLibrary.AssetField.CREATION_TIME, startedAt)
          .lte(MediaLibrary.AssetField.CREATION_TIME, endedAt)
          .orderBy(MediaLibrary.AssetField.CREATION_TIME)
          .limit(100)
          .exe();

        // cumulative path distance per point, for timestamp → distance mapping
        const cum: number[] = [0];
        for (let i = 1; i < points.length; i++) {
          cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]));
        }
        const atTimestamp = (ts: number) => {
          let idx = 0;
          while (idx < points.length - 1 && points[idx + 1].timestamp <= ts) idx++;
          return { point: points[idx], distanceM: cum[idx] };
        };

        const found: GalleryMoment[] = [];
        for (const asset of assets) {
          if (cancelled) return;
          const cached = cache.get(asset.id);
          if (cached !== undefined) {
            if (cached) found.push(cached);
            continue;
          }
          try {
            const ts = (await asset.getCreationTime()) ?? startedAt;
            const loc = await asset.getLocation().catch(() => null);
            const uri = await asset.getUri();
            const onPath = atTimestamp(ts);
            const moment: GalleryMoment = {
              id: asset.id,
              uri,
              // EXIF GPS = true shot location; fallback = where you were on the path
              lat: loc?.latitude ?? onPath.point.lat,
              lng: loc?.longitude ?? onPath.point.lng,
              distanceM: onPath.distanceM,
              elapsedS: Math.max(0, Math.round((ts - startedAt) / 1000)),
            };
            cache.set(asset.id, moment);
            found.push(moment);
          } catch {
            cache.set(asset.id, null); // unreadable (iCloud offload) — skip quietly
          }
        }
        if (!cancelled) setItems(found);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activityId, startedAt, endedAt, havePoints, points]);

  return items;
}
