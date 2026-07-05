import { eq, inArray } from 'drizzle-orm';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';
import { Trace } from '@/constants/theme';

import { RECORDING_TASK } from './background-task';
import { elevationGainM, totalDistanceM, type ActivityType, type TrackPoint } from './geo';

/**
 * M3: ingestion happens in the background task (background-task.ts) via
 * startLocationUpdatesAsync — works with screen off / app backgrounded.
 * This store only drives the state machine + timers. The UI reads points
 * and distance from SQLite via useLiveQuery.
 */

export type RecordingStatus = 'idle' | 'recording' | 'paused';

type RecordingState = {
  status: RecordingStatus;
  activityType: ActivityType;
  activityId: string | null;
  startedAt: number | null;
  activeSinceMs: number | null;
  accumulatedS: number;
  permissionDenied: boolean;

  setActivityType: (t: ActivityType) => void;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  deleteActivity: (id: string) => Promise<void>;
  recoverOrphans: () => Promise<void>;
  elapsedS: () => number;
};

async function startUpdates(): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;
  // Android requires background permission for startLocationUpdatesAsync;
  // iOS While-Using suffices when started in foreground (TECH_SPEC §5.6).
  if (Platform.OS === 'android') {
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') return false;
  }
  await Location.startLocationUpdatesAsync(RECORDING_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.ActivityType.Fitness,
    distanceInterval: 5,
    deferredUpdatesInterval: 5000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Trace is recording',
      notificationBody: 'Drawing your route — tap to return.',
      notificationColor: Trace.accent,
    },
  });
  return true;
}

async function stopUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(RECORDING_TASK)) {
    await Location.stopLocationUpdatesAsync(RECORDING_TASK);
  }
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  status: 'idle',
  activityType: 'run',
  activityId: null,
  startedAt: null,
  activeSinceMs: null,
  accumulatedS: 0,
  permissionDenied: false,

  setActivityType: (t) => {
    if (get().status === 'idle') set({ activityType: t });
  },

  start: async () => {
    if (get().status !== 'idle') return;
    const startedAt = Date.now();
    const activityId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(activities).values({
      id: activityId,
      type: get().activityType,
      status: 'recording',
      startedAt,
    });
    let started = false;
    try {
      started = await startUpdates();
    } catch {
      started = false;
    }
    if (!started) {
      await db.delete(activities).where(eq(activities.id, activityId));
      set({ permissionDenied: true });
      return;
    }
    set({
      status: 'recording',
      permissionDenied: false,
      activityId,
      startedAt,
      activeSinceMs: Date.now(),
      accumulatedS: 0,
    });
  },

  pause: async () => {
    const { status, elapsedS, activityId } = get();
    if (status !== 'recording') return;
    await stopUpdates();
    set({ status: 'paused', accumulatedS: elapsedS(), activeSinceMs: null });
    if (activityId)
      await db.update(activities).set({ status: 'paused' }).where(eq(activities.id, activityId));
  },

  resume: async () => {
    const { status, activityId } = get();
    if (status !== 'paused' || !activityId) return;
    // status back to recording BEFORE updates restart so the task finds the row
    await db.update(activities).set({ status: 'recording' }).where(eq(activities.id, activityId));
    let started = false;
    try {
      started = await startUpdates();
    } catch {
      started = false;
    }
    if (!started) {
      await db.update(activities).set({ status: 'paused' }).where(eq(activities.id, activityId));
      set({ permissionDenied: true });
      return;
    }
    set({ status: 'recording', activeSinceMs: Date.now() });
  },

  stop: async () => {
    const { status, activityId, elapsedS } = get();
    if (status === 'idle' || !activityId) return;
    await stopUpdates();
    const durationS = Math.round(elapsedS());
    const pts = await db
      .select()
      .from(trackPoints)
      .where(eq(trackPoints.activityId, activityId))
      .orderBy(trackPoints.seq);
    const track: TrackPoint[] = pts;
    const distanceM = totalDistanceM(track);
    await db
      .update(activities)
      .set({
        status: 'complete',
        endedAt: Date.now(),
        distanceM,
        durationS,
        avgPaceSecPerKm: distanceM > 50 ? durationS / (distanceM / 1000) : null,
        elevGainM: elevationGainM(track),
      })
      .where(eq(activities.id, activityId));
    set({
      status: 'idle',
      activityId: null,
      startedAt: null,
      activeSinceMs: null,
      accumulatedS: 0,
    });
  },

  deleteActivity: async (id) => {
    await db.delete(activities).where(eq(activities.id, id));
  },

  /**
   * Crash recovery (TECH_SPEC §5.1): finalize activities left in
   * recording/paused by a killed app; also stop any dangling task.
   */
  recoverOrphans: async () => {
    await stopUpdates().catch(() => {});
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
}));
