import { desc, eq } from 'drizzle-orm';
import { create } from 'zustand';

import { db } from '@/db/client';
import { activities, moments, trackPoints } from '@/db/schema';

import { labelMoment } from '../recording/places';
import { useRecordingStore } from '../recording/store';
import { storeMomentPhoto } from './photos';

/**
 * Moments — photos pinned to the exact GPS point where they were taken
 * mid-activity, replayed later as popups along the route (design §3a–3f).
 */

type PinnedToast = { distanceM: number; at: number };

type MomentsState = {
  /** last pinned moment, drives the record-screen toast (design §3c) */
  justPinned: PinnedToast | null;
  /** copy the captured photo into app storage and pin it to the latest GPS point */
  pinMoment: (photoUri: string) => Promise<boolean>;
  clearToast: () => void;
};

export const useMomentsStore = create<MomentsState>((set) => ({
  justPinned: null,

  pinMoment: async (photoUri) => {
    const { activityId, elapsedS } = useRecordingStore.getState();
    if (!activityId) return false;

    const [lastPoint] = await db
      .select()
      .from(trackPoints)
      .where(eq(trackPoints.activityId, activityId))
      .orderBy(desc(trackPoints.seq))
      .limit(1);
    if (!lastPoint) return false; // no GPS fix yet — nothing to pin to

    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId));

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const photo = `${id}.jpg`;
    await storeMomentPhoto(photoUri, photo);

    const distanceM = activity?.distanceM ?? 0;
    await db.insert(moments).values({
      id,
      activityId,
      photo,
      lat: lastPoint.lat,
      lng: lastPoint.lng,
      distanceM,
      elapsedS: Math.round(elapsedS()),
      timestamp: Date.now(),
    });
    set({ justPinned: { distanceM, at: Date.now() } });
    // fire-and-forget: place name for the replay popup card; launch-time
    // backfill retries any that fail (offline captures etc.)
    labelMoment(id, lastPoint.lat, lastPoint.lng).catch(() => {});
    return true;
  },

  clearToast: () => set({ justPinned: null }),
}));
