import { eq, isNull, and } from 'drizzle-orm';
import * as Location from 'expo-location';

import { db } from '@/db/client';
import { activities, trackPoints, type ActivityRow } from '@/db/schema';

/**
 * Card titles from the route's endpoints — "Gairidhara → Lazimpat" — via the
 * OS reverse geocoder (no API key, no quota policy). Names are stored on the
 * activity row once; failures stay NULL and the UI falls back to type + time.
 */

function pickName(geo: Location.LocationGeocodedAddress | undefined): string | null {
  if (!geo) return null;
  // street-level first — districts ("Kathmandu Valley") are too broad for a card title
  return geo.street ?? geo.name ?? geo.district ?? geo.city ?? null;
}

async function placeAt(lat: number, lng: number): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return pickName(results[0]);
  } catch {
    return null; // offline / geocoder unavailable — retried on a later launch
  }
}

/** "A → B", "A loop" when both ends resolve to the same place, null when unresolved */
export function composeTitle(startPlace: string | null, endPlace: string | null): string | null {
  if (!startPlace && !endPlace) return null;
  if (startPlace && endPlace) {
    return startPlace === endPlace ? `${startPlace} loop` : `${startPlace} → ${endPlace}`;
  }
  return startPlace ?? endPlace;
}

/** geocode one activity's endpoints and store them; no-op when it has no track */
export async function labelActivity(activityId: string): Promise<void> {
  const pts = await db
    .select({ lat: trackPoints.lat, lng: trackPoints.lng })
    .from(trackPoints)
    .where(eq(trackPoints.activityId, activityId))
    .orderBy(trackPoints.seq);
  if (pts.length < 2) return;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const startPlace = await placeAt(first.lat, first.lng);
  const endPlace = await placeAt(last.lat, last.lng);
  if (!startPlace && !endPlace) return; // keep NULL so a later launch retries
  await db.update(activities).set({ startPlace, endPlace }).where(eq(activities.id, activityId));
}

/**
 * Backfill titles for completed activities recorded before this feature (or
 * whose geocode failed). Sequential and bounded per launch — gentle on the
 * OS geocoder and on app-start time.
 */
export async function backfillPlaces(maxPerLaunch = 20): Promise<void> {
  const missing: Pick<ActivityRow, 'id'>[] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.status, 'complete'), isNull(activities.startPlace)))
    .limit(maxPerLaunch);
  for (const row of missing) {
    await labelActivity(row.id);
  }
}
