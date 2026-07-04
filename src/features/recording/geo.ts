import type { LocationObject } from 'expo-location';

export type TrackPoint = {
  lat: number;
  lng: number;
  altitude: number | null;
  timestamp: number;
  speed: number | null;
  accuracy: number | null;
};

export type ActivityType = 'run' | 'ride' | 'walk';

/** TECH_SPEC §5.3 — garbage GPS filter thresholds */
const MAX_ACCURACY_M = 30;
const MAX_SPEED_MS: Record<ActivityType, number> = { run: 12, walk: 12, ride: 25 };

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

/** TECH_SPEC §5.3 — reject noisy or physically impossible points */
export function acceptPoint(
  point: TrackPoint,
  previous: TrackPoint | undefined,
  activityType: ActivityType,
): boolean {
  if (point.accuracy !== null && point.accuracy > MAX_ACCURACY_M) return false;
  if (!previous) return true;
  if (point.timestamp <= previous.timestamp) return false;
  const dt = (point.timestamp - previous.timestamp) / 1000;
  const impliedSpeed = haversineM(previous, point) / dt;
  return impliedSpeed <= MAX_SPEED_MS[activityType];
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

export function totalDistanceM(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return total;
}

/** Σ positive altitude deltas over a smoothed series (TECH_SPEC §5.4) */
export function elevationGainM(points: TrackPoint[]): number {
  const alts = points.map((p) => p.altitude).filter((a): a is number => a !== null);
  if (alts.length < 2) return 0;
  const window = 5;
  const smoothed = alts.map((_, i) => {
    const slice = alts.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
  let gain = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const d = smoothed[i] - smoothed[i - 1];
    if (d > 0) gain += d;
  }
  return gain;
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
