import type { LocationObject } from 'expo-location';

import { haversineM, toTrackPoint, type ActivityType, type TrackPoint } from './geo';

/**
 * Precision GPS pipeline (TECH_SPEC §5.3, hardened).
 *
 * Structure: the Kalman filter ALWAYS ingests every plausible fix (smoothing
 * knowledge), but a point is only EMITTED for storage when the *smoothed*
 * position escapes the local noise radius. The two concerns are decoupled:
 *
 *  1. Warmup gate — no anchor until a fix with accuracy ≤ WARMUP_ACCURACY_M
 *     (cold fixes jump hundreds of meters). After WARMUP_TIMEOUT_MS, relax
 *     to the hard limit.
 *  2. Hard gates (reject fix outright): accuracy worse than HARD_ACCURACY_M,
 *     non-monotonic timestamp, implied speed beyond the activity's ceiling.
 *  3. Kalman update — 1D per axis, measurement noise = accuracy², process
 *     noise tuned per activity. Outliers nudge the path; sharp fixes move it.
 *  4. Emission gates — store a point only when:
 *       • the chip's doppler speed (when reported) says we're actually moving, and
 *       • the smoothed position moved ≥ max(EMIT_STEP_M, 0.6 × accuracy)
 *         since the last stored point.
 *     Standing at a red light: the smoothed position hovers inside the noise
 *     radius → nothing is stored → zero phantom distance.
 */

const WARMUP_ACCURACY_M = 15;
const WARMUP_TIMEOUT_MS = 10_000;
const HARD_ACCURACY_M: Record<ActivityType, number> = { run: 25, walk: 25, ride: 35 };
const MAX_SPEED_MS: Record<ActivityType, number> = { run: 12, walk: 12, ride: 25 };
const EMIT_STEP_M = 5;
/** doppler speed below this (m/s) = stationary; GPS chips report this reliably */
const STATIONARY_SPEED_MS = 0.4;
/** smoothed position must itself be moving at least this fast to emit */
const MIN_KALMAN_SPEED_MS = 0.5;
/** EMA blend for the smoothed-velocity estimate */
const SPEED_EMA_ALPHA = 0.4;
/** process noise (m/s): how unpredictably true movement drifts, by type */
const PROCESS_NOISE_MS: Record<ActivityType, number> = { run: 3, walk: 1.5, ride: 6 };

type KalmanState = {
  lat: number;
  lng: number;
  /** position variance in m² */
  variance: number;
  timestamp: number;
};

export class GpsPipeline {
  private kalman: KalmanState | null = null;
  private lastEmitted: { lat: number; lng: number } | null = null;
  private firstSeenAt: number | null = null;
  /** EMA of the smoothed position's own velocity — near zero when parked */
  private kalmanSpeedEma = 0;

  constructor(
    private readonly activityType: ActivityType,
    /** resume from the last stored point after a restart */
    lastStored?: TrackPoint,
  ) {
    if (lastStored) {
      this.kalman = {
        lat: lastStored.lat,
        lng: lastStored.lng,
        variance: Math.max(lastStored.accuracy ?? 10, 5) ** 2,
        timestamp: lastStored.timestamp,
      };
      this.lastEmitted = { lat: lastStored.lat, lng: lastStored.lng };
    }
  }

  /** Returns the smoothed point to store, or null when nothing should be stored. */
  process(location: LocationObject): TrackPoint | null {
    const raw = toTrackPoint(location);
    const accuracy = raw.accuracy ?? 99;

    // 1. Warmup
    if (!this.kalman) {
      if (this.firstSeenAt === null) this.firstSeenAt = raw.timestamp;
      const warmedUp =
        accuracy <= WARMUP_ACCURACY_M ||
        (raw.timestamp - this.firstSeenAt >= WARMUP_TIMEOUT_MS &&
          accuracy <= HARD_ACCURACY_M[this.activityType]);
      if (!warmedUp) return null;
      this.kalman = {
        lat: raw.lat,
        lng: raw.lng,
        variance: Math.max(accuracy, 5) ** 2,
        timestamp: raw.timestamp,
      };
      this.lastEmitted = { lat: raw.lat, lng: raw.lng };
      return { ...raw };
    }

    // 2. Hard gates
    if (accuracy > HARD_ACCURACY_M[this.activityType]) return null;
    const dtS = (raw.timestamp - this.kalman.timestamp) / 1000;
    if (dtS <= 0) return null;
    if (haversineM(this.kalman, raw) / dtS > MAX_SPEED_MS[this.activityType]) return null;

    // 3. Kalman update (predict + correct)
    const q = PROCESS_NOISE_MS[this.activityType];
    const predictedVariance = this.kalman.variance + q * q * dtS;
    const r = Math.max(accuracy, 3) ** 2;
    const gain = predictedVariance / (predictedVariance + r);
    const next: KalmanState = {
      lat: this.kalman.lat + gain * (raw.lat - this.kalman.lat),
      lng: this.kalman.lng + gain * (raw.lng - this.kalman.lng),
      variance: (1 - gain) * predictedVariance,
      timestamp: raw.timestamp,
    };
    const kalmanStepM = haversineM(this.kalman, next);
    this.kalmanSpeedEma =
      SPEED_EMA_ALPHA * (kalmanStepM / dtS) + (1 - SPEED_EMA_ALPHA) * this.kalmanSpeedEma;
    this.kalman = next;

    // 4. Emission gates: doppler says moving, smoothed position is itself
    //    moving, and it escaped the noise radius since the last stored point.
    if (raw.speed !== null && raw.speed >= 0 && raw.speed < STATIONARY_SPEED_MS) return null;
    if (this.kalmanSpeedEma < MIN_KALMAN_SPEED_MS) return null;
    const smoothedStep = this.lastEmitted ? haversineM(this.lastEmitted, this.kalman) : Infinity;
    if (smoothedStep < Math.max(EMIT_STEP_M, 0.6 * accuracy)) return null;

    this.lastEmitted = { lat: this.kalman.lat, lng: this.kalman.lng };
    return { ...raw, lat: this.kalman.lat, lng: this.kalman.lng };
  }
}
