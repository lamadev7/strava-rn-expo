import assert from 'node:assert/strict';
import { test } from 'node:test';

import { elevationStats, estimateKcal, type TrackPoint } from './geo';

/** track with only altitude varying — smoothing window sees a flat ramp */
function track(alts: (number | null)[]): TrackPoint[] {
  return alts.map((altitude, i) => ({
    lat: 27.7,
    lng: 85.3,
    altitude,
    timestamp: 1_700_000_000_000 + i * 1000,
    speed: 1.5,
    accuracy: 8,
  }));
}

test('steady climb banks the full ascent', () => {
  // 0 → 100 m in 1 m steps; smoothing lags but the total must converge.
  const alts = Array.from({ length: 101 }, (_, i) => i);
  const { gainM, lossM } = elevationStats(track(alts));
  assert.ok(gainM > 95 && gainM <= 100, `expected ≈98 m gain, got ${gainM.toFixed(1)}`);
  assert.equal(lossM, 0);
});

test('out-and-back summit counts gain and loss symmetrically', () => {
  const up = Array.from({ length: 51 }, (_, i) => 2 * i); // 0 → 100
  const down = Array.from({ length: 51 }, (_, i) => 100 - 2 * i); // 100 → 0
  const { gainM, lossM } = elevationStats(track([...up, ...down]));
  // smoothing shaves the summit and the tail; deadband truncates < 3 m more.
  // Bound: within ~10% of truth on both sides, and roughly symmetric.
  assert.ok(gainM > 88 && gainM <= 100, `gain ≈95 expected, got ${gainM.toFixed(1)}`);
  assert.ok(lossM > 88 && lossM <= 100, `loss ≈95 expected, got ${lossM.toFixed(1)}`);
  assert.ok(Math.abs(gainM - lossM) < 8, `asymmetric out-and-back: ↑${gainM} ↓${lossM}`);
});

test('GPS altitude jitter on flat ground adds zero gain', () => {
  // ±2 m sawtooth around 500 m — inside the 3 m deadband after smoothing
  const alts = Array.from({ length: 200 }, (_, i) => 500 + 2 * Math.sin(i / 3));
  const { gainM, lossM } = elevationStats(track(alts));
  assert.equal(gainM, 0, `phantom gain on flat ground: ${gainM.toFixed(1)} m`);
  assert.equal(lossM, 0, `phantom loss on flat ground: ${lossM.toFixed(1)} m`);
});

test('big noise spikes are flattened by smoothing + deadband', () => {
  // flat 500 m with a single +15 m one-fix spike: 5-sample mean spreads it
  // to +3 m ripples; deadband must swallow them
  const alts = Array.from({ length: 60 }, (_, i) => (i === 30 ? 515 : 500));
  const { gainM } = elevationStats(track(alts));
  assert.ok(gainM <= 3.1, `spike leaked into gain: ${gainM.toFixed(1)} m`);
});

test('rolling hills: only the real climbs count', () => {
  // three 20 m hills with flat valleys — expect ≈3×20 up and ≈3×20 down
  const hill = [
    ...Array.from({ length: 21 }, (_, i) => i), // up 0→20
    ...Array.from({ length: 21 }, (_, i) => 20 - i), // down 20→0
    ...Array.from({ length: 10 }, () => 0), // valley floor
  ];
  const { gainM, lossM } = elevationStats(track([...hill, ...hill, ...hill]));
  assert.ok(gainM > 48 && gainM < 62, `expected ≈57 m gain, got ${gainM.toFixed(1)}`);
  assert.ok(lossM > 48 && lossM < 62, `expected ≈57 m loss, got ${lossM.toFixed(1)}`);
});

test('null altitudes are skipped, not treated as zero', () => {
  const alts: (number | null)[] = [500, null, 502, null, 504, 506, null, 510, 512, 514];
  const { gainM, lossM } = elevationStats(track(alts));
  assert.ok(gainM > 5 && gainM < 15, `climb through nulls: ${gainM.toFixed(1)} m`);
  assert.equal(lossM, 0);
});

test('min/max altitude reported from the smoothed series', () => {
  const alts = [100, 100, 100, 100, 100, 150, 150, 150, 150, 150, 80, 80, 80, 80, 80];
  const { minAltM, maxAltM } = elevationStats(track(alts));
  assert.ok(minAltM !== null && minAltM < 100, `min should dip below 100, got ${minAltM}`);
  assert.ok(maxAltM !== null && maxAltM > 130, `max should approach 150, got ${maxAltM}`);
});

test('empty and single-point tracks are safe', () => {
  assert.deepEqual(elevationStats(track([])), { gainM: 0, lossM: 0, minAltM: null, maxAltM: null });
  const single = elevationStats(track([420]));
  assert.equal(single.gainM, 0);
  assert.equal(single.minAltM, 420);
});

test('estimateKcal adds the climb bonus per type', () => {
  // 5 km flat
  assert.equal(estimateKcal(5000, 'hike'), 250);
  assert.equal(estimateKcal(5000, 'run'), 310);
  assert.equal(estimateKcal(5000, 'ride'), 125);
  // + 400 m of climb
  assert.equal(estimateKcal(5000, 'hike', 400), 250 + 180);
  assert.equal(estimateKcal(5000, 'run', 400), 310 + 180);
  assert.equal(estimateKcal(5000, 'ride', 400), 125 + 100);
  // negative gain never subtracts
  assert.equal(estimateKcal(5000, 'hike', -50), 250);
});
