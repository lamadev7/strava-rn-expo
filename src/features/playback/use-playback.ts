import { useEffect, useMemo, useState } from 'react';

import { bearingDeg, haversineM, type TrackPoint } from '../recording/geo';

/**
 * Replay engine for a recorded activity (TECH_SPEC §6 "Next feature").
 *
 * Builds a playback timeline from the stored track points' real timestamps,
 * with idle gaps (pauses, red lights) capped at MAX_GAP_S so replays skip the
 * boring parts. Position between points is linearly interpolated, so the
 * marker glides along the exact recorded path while speed/distance/elapsed
 * reflect the real recording.
 */

const MAX_GAP_S = 5;
export const PLAYBACK_RATES = [4, 10, 30] as const;
/** frame updates capped to ~30 fps — smooth enough, halves render load */
const MIN_FRAME_MS = 33;

export type PlaybackFrame = {
  lngLat: [number, number];
  /** direction of travel, degrees from north */
  bearing: number;
  /** actual speed at this moment (m/s), from the recorded segment */
  speedMs: number;
  /** meters covered so far */
  distanceM: number;
  /** real activity seconds at this position (gaps NOT compressed) */
  elapsedS: number;
  /** index of the last passed track point */
  index: number;
};

export function usePlayback(points: TrackPoint[]) {
  const [playing, setPlaying] = useState(false);
  const [rateIdx, setRateIdx] = useState(1);
  const [t, setT] = useState(0); // seconds on the compressed playback timeline
  const rate = PLAYBACK_RATES[rateIdx];

  const { timeline, cumDist, realElapsed, durationS } = useMemo(() => {
    const timeline: number[] = [0];
    const cumDist: number[] = [0];
    const realElapsed: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const dt = Math.min((points[i].timestamp - points[i - 1].timestamp) / 1000, MAX_GAP_S);
      timeline.push(timeline[i - 1] + Math.max(dt, 0.1));
      cumDist.push(cumDist[i - 1] + haversineM(points[i - 1], points[i]));
      realElapsed.push((points[i].timestamp - points[0].timestamp) / 1000);
    }
    return { timeline, cumDist, realElapsed, durationS: timeline[timeline.length - 1] ?? 0 };
  }, [points]);

  // playback clock
  useEffect(() => {
    if (!playing) return;
    let raf: number;
    let last = performance.now();
    let lastSet = 0;
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * rate;
      last = now;
      if (now - lastSet >= MIN_FRAME_MS) {
        lastSet = now;
        setT((prev) => {
          const next = prev + dt;
          if (next >= durationS) {
            setPlaying(false);
            return durationS;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, durationS]);

  // segment lookup — binary search over the timeline
  const frame: PlaybackFrame | null = useMemo(() => {
    if (points.length < 2) return null;
    let lo = 0;
    let hi = points.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (timeline[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const span = timeline[i + 1] - timeline[i];
    const f = span > 0 ? Math.min(Math.max((t - timeline[i]) / span, 0), 1) : 0;
    const a = points[i];
    const b = points[i + 1];
    const segDist = cumDist[i + 1] - cumDist[i];
    const segRealDt = Math.max((b.timestamp - a.timestamp) / 1000, 0.1);
    return {
      lngLat: [a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f],
      bearing: bearingDeg(a, b),
      speedMs: a.speed ?? segDist / segRealDt,
      distanceM: cumDist[i] + segDist * f,
      elapsedS: realElapsed[i] + (realElapsed[i + 1] - realElapsed[i]) * f,
      index: i,
    };
  }, [points, timeline, cumDist, realElapsed, t]);

  // distance → playback-progress fraction (moment dots on the scrubber)
  const progressAtDistance = (distanceM: number): number => {
    if (durationS <= 0 || cumDist.length < 2) return 0;
    let lo = 0;
    let hi = cumDist.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumDist[mid] <= distanceM) lo = mid;
      else hi = mid - 1;
    }
    const span = cumDist[lo + 1] - cumDist[lo];
    const f = span > 0 ? Math.min(Math.max((distanceM - cumDist[lo]) / span, 0), 1) : 0;
    return (timeline[lo] + (timeline[lo + 1] - timeline[lo]) * f) / durationS;
  };

  return {
    available: points.length > 1,
    playing,
    rate,
    frame,
    progress: durationS > 0 ? t / durationS : 0,
    progressAtDistance,
    atEnd: t >= durationS && durationS > 0,
    toggle: () => {
      if (!playing && t >= durationS) setT(0); // replay from start when finished
      setPlaying((p) => !p);
    },
    cycleRate: () => setRateIdx((i) => (i + 1) % PLAYBACK_RATES.length),
    reset: () => {
      setPlaying(false);
      setT(0);
    },
  };
}
