import type { LocationObject } from 'expo-location';

export type TrackPoint = {
  lat: number;
  lng: number;
  altitude: number | null;
  timestamp: number;
  speed: number | null;
  accuracy: number | null;
};

export type ActivityType = 'run' | 'ride' | 'hike';

export function toTrackPoint(location: LocationObject): TrackPoint {
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    altitude: location.coords.altitude,
    timestamp: location.timestamp,
    speed: location.coords.speed,
    accuracy: location.coords.accuracy,
  };
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** initial bearing a→b in degrees [0, 360), 0 = north */
export function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function totalDistanceM(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return total;
}

export type ElevationStats = {
  gainM: number;
  lossM: number;
  minAltM: number | null;
  maxAltM: number | null;
};

/**
 * Elevation gain/loss with smoothing + hysteresis (TECH_SPEC §5.4, hardened
 * for hikes). GPS altitude wanders ±5–15 m; summing every positive smoothed
 * delta inflates gain badly on long flat stretches. Two defenses:
 *
 *  1. 5-sample trailing mean flattens per-fix jitter.
 *  2. Deadband accumulation: altitude must move ≥ thresholdM away from the
 *     last banked anchor before the move counts — oscillation inside the
 *     band contributes nothing, real climbs bank chunk by chunk. Worst-case
 *     truncation error is < thresholdM per sustained climb/descent.
 */
export function elevationStats(points: TrackPoint[], thresholdM = 3): ElevationStats {
  const alts = points.map((p) => p.altitude).filter((a): a is number => a !== null);
  if (alts.length < 2) {
    const only = alts.length === 1 ? alts[0] : null;
    return { gainM: 0, lossM: 0, minAltM: only, maxAltM: only };
  }
  const window = 5;
  const smoothed = alts.map((_, i) => {
    const slice = alts.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
  let gain = 0;
  let loss = 0;
  let anchor = smoothed[0];
  let min = smoothed[0];
  let max = smoothed[0];
  for (let i = 1; i < smoothed.length; i++) {
    const v = smoothed[i];
    if (v < min) min = v;
    if (v > max) max = v;
    const d = v - anchor;
    if (d >= thresholdM) {
      gain += d;
      anchor = v;
    } else if (d <= -thresholdM) {
      loss += -d;
      anchor = v;
    }
  }
  return { gainM: gain, lossM: loss, minAltM: min, maxAltM: max };
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** e.g. 6'02" per km; em dash when not enough movement yet */
export function formatPace(distanceM: number, durationS: number): string {
  if (distanceM < 50 || durationS <= 0) return `—'——"`;
  const secPerKm = durationS / (distanceM / 1000);
  if (!Number.isFinite(secPerKm) || secPerKm > 59 * 60) return `—'——"`;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export function formatKm(distanceM: number): string {
  return (distanceM / 1000).toFixed(2);
}

/** rough energy estimate — flat MET-style factor per km, plus a climb bonus */
const KCAL_PER_KM: Record<ActivityType, number> = { run: 62, ride: 25, hike: 50 };
/** extra kcal per meter climbed (~70 kg body): lifting work dominates on foot */
const KCAL_PER_CLIMB_M: Record<ActivityType, number> = { run: 0.45, ride: 0.25, hike: 0.45 };

export function estimateKcal(distanceM: number, type: ActivityType, elevGainM = 0): number {
  const climb = Math.max(0, elevGainM) * KCAL_PER_CLIMB_M[type];
  return Math.round((distanceM / 1000) * KCAL_PER_KM[type] + climb);
}
