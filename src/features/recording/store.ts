import * as Location from 'expo-location';
import { create } from 'zustand';

import { acceptPoint, toTrackPoint, totalDistanceM, type ActivityType, type TrackPoint } from './geo';

/**
 * M1 scope: foreground recording, in-memory session storage.
 * M2 replaces `completed` with SQLite (TECH_SPEC §4/§5); M3 moves ingestion
 * into an expo-task-manager background task. The invariant to preserve then:
 * writers append points, the UI only reads.
 */

export type CompletedActivity = {
  id: string;
  type: ActivityType;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  durationS: number;
  points: TrackPoint[];
};

export type RecordingStatus = 'idle' | 'recording' | 'paused';

type RecordingState = {
  status: RecordingStatus;
  activityType: ActivityType;
  startedAt: number | null;
  /** moving-time accumulator: excludes paused stretches */
  activeSinceMs: number | null;
  accumulatedS: number;
  points: TrackPoint[];
  distanceM: number;
  completed: CompletedActivity[];
  permissionDenied: boolean;

  setActivityType: (t: ActivityType) => void;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  stop: () => void;
  discard: () => void;
  deleteActivity: (id: string) => void;
  elapsedS: () => number;
};

let subscription: Location.LocationSubscription | null = null;

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
    const { status, points, activityType, distanceM } = get();
    if (status !== 'recording') return;
    const point = toTrackPoint(location);
    const previous = points[points.length - 1];
    if (!acceptPoint(point, previous, activityType)) return;
    const added = previous ? totalDistanceM([previous, point]) : 0;
    set({ points: [...points, point], distanceM: distanceM + added });
  };

  return {
    status: 'idle',
    activityType: 'run',
    startedAt: null,
    activeSinceMs: null,
    accumulatedS: 0,
    points: [],
    distanceM: 0,
    completed: [],
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
      set({
        status: 'recording',
        permissionDenied: false,
        startedAt: Date.now(),
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
    },

    resume: async () => {
      if (get().status !== 'paused') return;
      const granted = await watch(onLocation);
      if (!granted) {
        set({ permissionDenied: true });
        return;
      }
      set({ status: 'recording', activeSinceMs: Date.now() });
    },

    stop: () => {
      const { status, startedAt, activityType, points, distanceM, completed, elapsedS } = get();
      if (status === 'idle' || startedAt === null) return;
      stopWatching();
      const activity: CompletedActivity = {
        id: `${startedAt}`,
        type: activityType,
        startedAt,
        endedAt: Date.now(),
        distanceM,
        durationS: elapsedS(),
        points,
      };
      set({
        status: 'idle',
        startedAt: null,
        activeSinceMs: null,
        accumulatedS: 0,
        points: [],
        distanceM: 0,
        completed: [activity, ...completed],
      });
    },

    deleteActivity: (id) => {
      set({ completed: get().completed.filter((a) => a.id !== id) });
    },

    discard: () => {
      stopWatching();
      set({
        status: 'idle',
        startedAt: null,
        activeSinceMs: null,
        accumulatedS: 0,
        points: [],
        distanceM: 0,
      });
    },

    elapsedS: () => {
      const { accumulatedS, activeSinceMs } = get();
      return accumulatedS + (activeSinceMs !== null ? (Date.now() - activeSinceMs) / 1000 : 0);
    },
  };
});
