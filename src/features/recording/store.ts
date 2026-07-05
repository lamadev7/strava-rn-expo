import { eq, inArray } from 'drizzle-orm';
import * as Location from 'expo-location';
import { create } from 'zustand';

import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';

import {
  acceptPoint,
  elevationGainM,
  toTrackPoint,
  totalDistanceM,
  type ActivityType,
  type TrackPoint,
} from './geo';

/**
 * M2: SQLite is the source of truth (TECH_SPEC §5.1). The store writes every
 * accepted point to track_points and keeps an in-memory copy of the ACTIVE
 * activity's points for the live map trail. History/detail read the DB via
 * useLiveQuery. M3 moves ingestion into a background task — the write path
 * (DB insert per accepted point) is already shaped for that.
 */

export type RecordingStatus = 'idle' | 'recording' | 'paused';

type RecordingState = {
  status: RecordingStatus;
  activityType: ActivityType;
  activityId: string | null;
  startedAt: number | null;
  activeSinceMs: number | null;
  accumulatedS: number;
  points: TrackPoint[];
  distanceM: number;
  permissionDenied: boolean;

  setActivityType: (t: ActivityType) => void;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  deleteActivity: (id: string) => Promise<void>;
  recoverOrphans: () => Promise<void>;
  elapsedS: () => number;
};

let subscription: Location.LocationSubscription | null = null;
let seq = 0;

async function watch(onPoint: (location: Location.LocationObject) => void): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return false;
  subscription?.remove();
  subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,
    },
    onPoint,
  );
  return true;
}

function stopWatching() {
  subscription?.remove();
  subscription = null;
}

export const useRecordingStore = create<RecordingState>((set, get) => {
  const onLocation = (location: Location.LocationObject) => {
    const { status, points, activityType, distanceM, activityId } = get();
    if (status !== 'recording' || !activityId) return;
    const point = toTrackPoint(location);
    const previous = points[points.length - 1];
    if (!acceptPoint(point, previous, activityType)) return;
    const added = previous ? totalDistanceM([previous, point]) : 0;
    set({ points: [...points, point], distanceM: distanceM + added });
    seq += 1;
    db.insert(trackPoints)
      .values({ activityId, seq, ...point })
      .run();
  };

  return {
    status: 'idle',
    activityType: 'run',
    activityId: null,
    startedAt: null,
    activeSinceMs: null,
    accumulatedS: 0,
    points: [],
    distanceM: 0,
    permissionDenied: false,

    setActivityType: (t) => {
      if (get().status === 'idle') set({ activityType: t });
    },

    start: async () => {
      if (get().status !== 'idle') return;
      const granted = await watch(onLocation);
      if (!granted) {
        set({ permissionDenied: true });
        return;
      }
      const startedAt = Date.now();
      const activityId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
      seq = 0;
      await db.insert(activities).values({
        id: activityId,
        type: get().activityType,
        status: 'recording',
        startedAt,
      });
      set({
        status: 'recording',
        permissionDenied: false,
        activityId,
        startedAt,
        activeSinceMs: Date.now(),
        accumulatedS: 0,
        points: [],
        distanceM: 0,
      });
    },

    pause: () => {
      const { status, elapsedS } = get();
      if (status !== 'recording') return;
      stopWatching();
      set({ status: 'paused', accumulatedS: elapsedS(), activeSinceMs: null });
      const id = get().activityId;
      if (id) db.update(activities).set({ status: 'paused' }).where(eq(activities.id, id)).run();
    },

    resume: async () => {
      if (get().status !== 'paused') return;
      const granted = await watch(onLocation);
      if (!granted) {
        set({ permissionDenied: true });
        return;
      }
      set({ status: 'recording', activeSinceMs: Date.now() });
      const id = get().activityId;
      if (id) db.update(activities).set({ status: 'recording' }).where(eq(activities.id, id)).run();
    },

    stop: async () => {
      const { status, activityId, points, distanceM, elapsedS } = get();
      if (status === 'idle' || !activityId) return;
      stopWatching();
      const durationS = Math.round(elapsedS());
      await db
        .update(activities)
        .set({
          status: 'complete',
          endedAt: Date.now(),
          distanceM,
          durationS,
          avgPaceSecPerKm: distanceM > 50 ? durationS / (distanceM / 1000) : null,
          elevGainM: elevationGainM(points),
        })
        .where(eq(activities.id, activityId));
      set({
        status: 'idle',
        activityId: null,
        startedAt: null,
        activeSinceMs: null,
        accumulatedS: 0,
        points: [],
        distanceM: 0,
      });
    },

    deleteActivity: async (id) => {
      await db.delete(activities).where(eq(activities.id, id));
    },

    /**
     * Crash recovery (TECH_SPEC §5.1): finalize activities left in
     * recording/paused by a killed app. Stats recomputed from stored points.
     */
    recoverOrphans: async () => {
      const orphans = await db
        .select()
        .from(activities)
        .where(inArray(activities.status, ['recording', 'paused']));
      for (const orphan of orphans) {
        const pts = await db
          .select()
          .from(trackPoints)
          .where(eq(trackPoints.activityId, orphan.id))
          .orderBy(trackPoints.seq);
        if (pts.length < 2) {
          await db.delete(activities).where(eq(activities.id, orphan.id));
          continue;
        }
        const track: TrackPoint[] = pts;
        const distanceM = totalDistanceM(track);
        const durationS = Math.round((pts[pts.length - 1].timestamp - pts[0].timestamp) / 1000);
        await db
          .update(activities)
          .set({
            status: 'complete',
            endedAt: pts[pts.length - 1].timestamp,
            distanceM,
            durationS,
            avgPaceSecPerKm: distanceM > 50 ? durationS / (distanceM / 1000) : null,
            elevGainM: elevationGainM(track),
          })
          .where(eq(activities.id, orphan.id));
      }
    },

    elapsedS: () => {
      const { accumulatedS, activeSinceMs } = get();
      return accumulatedS + (activeSinceMs !== null ? (Date.now() - activeSinceMs) / 1000 : 0);
    },
  };
});
