import { asc, eq, inArray } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useRef, useState } from 'react';

import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';

/**
 * Every completed activity's route as one FeatureCollection for the Record
 * map ("where have I been"). Perf shape:
 *  - useLiveQuery watches only the COMPLETE-activity id list (cheap); the
 *    24k-row point fetch runs once per membership change, NOT per GPS tick —
 *    recording bumps activities.distance_m constantly, which invalidates the
 *    live query, so we gate the heavy fetch on the ids actually changing.
 *  - each path is stride-downsampled to ≤ MAX_POINTS_PER_PATH vertices;
 *    background context doesn't need 5 m fidelity.
 */

const MAX_POINTS_PER_PATH = 400;

export function usePastPaths(excludeActivityId: string | null): GeoJSON.FeatureCollection | null {
  const { data: idRows } = useLiveQuery(
    db.select({ id: activities.id }).from(activities).where(eq(activities.status, 'complete')),
  );
  const ids = (idRows ?? [])
    .map((r) => r.id)
    .filter((id) => id !== excludeActivityId)
    .sort()
    .join('|');

  const [collection, setCollection] = useState<GeoJSON.FeatureCollection | null>(null);
  const lastIds = useRef<string | null>(null);

  useEffect(() => {
    if (ids === lastIds.current) return;
    lastIds.current = ids;
    if (!ids) {
      setCollection(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const idList = ids.split('|');
      const rows = await db
        .select({
          activityId: trackPoints.activityId,
          lat: trackPoints.lat,
          lng: trackPoints.lng,
        })
        .from(trackPoints)
        .where(inArray(trackPoints.activityId, idList))
        .orderBy(asc(trackPoints.activityId), asc(trackPoints.seq));
      if (cancelled) return;

      const byActivity = new Map<string, [number, number][]>();
      for (const row of rows) {
        let coords = byActivity.get(row.activityId);
        if (!coords) {
          coords = [];
          byActivity.set(row.activityId, coords);
        }
        coords.push([row.lng, row.lat]);
      }

      const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      for (const coords of byActivity.values()) {
        if (coords.length < 2) continue;
        const stride = Math.max(1, Math.ceil(coords.length / MAX_POINTS_PER_PATH));
        const sampled = coords.filter((_, i) => i % stride === 0);
        const last = coords[coords.length - 1];
        if (sampled[sampled.length - 1] !== last) sampled.push(last);
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: sampled },
        });
      }
      setCollection(features.length ? { type: 'FeatureCollection', features } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  return collection;
}
