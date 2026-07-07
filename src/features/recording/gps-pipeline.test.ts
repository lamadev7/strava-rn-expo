import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LocationObject } from 'expo-location';

import { haversineM, totalDistanceM } from './geo';
import { GpsPipeline } from './gps-pipeline';

const BASE = { lat: 27.7172, lng: 85.324 };
/** ~meters → degrees at this latitude */
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((BASE.lat * Math.PI) / 180);

function fix(
  eastM: number,
  northM: number,
  tSeconds: number,
  accuracy = 8,
  speed: number | null = null,
): LocationObject {
  return {
    coords: {
      latitude: BASE.lat + northM / M_PER_DEG_LAT,
      longitude: BASE.lng + eastM / M_PER_DEG_LNG,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed,
    },
    timestamp: 1_700_000_000_000 + tSeconds * 1000,
  };
}

/** deterministic pseudo-noise in [-1, 1] */
const noise = (i: number, salt = 0) => Math.sin(i * 12.9898 + salt * 78.233) % 1;

test('stationary with doppler speed adds zero distance', () => {
  // Real GPS chips report near-zero doppler speed when parked.
  const p = new GpsPipeline('hike');
  const accepted = [];
  for (let i = 0; i < 120; i++) {
    const pt = p.process(fix(7 * noise(i), 7 * noise(i, 1), i, 9, 0.1));
    if (pt) accepted.push(pt);
  }
  const distance = totalDistanceM(accepted);
  assert.ok(distance < 1, `phantom distance while standing still: ${distance.toFixed(1)} m`);
});

test('stationary without doppler (correlated wander) stays near zero', () => {
  // Realistic no-doppler case: position drifts slowly (correlated noise),
  // not white ±7 m jumps every second.
  const p = new GpsPipeline('hike');
  const accepted = [];
  for (let i = 0; i < 120; i++) {
    const east = 8 * Math.sin(i / 25) + 1.5 * noise(i);
    const north = 8 * Math.cos(i / 31) + 1.5 * noise(i, 1);
    const pt = p.process(fix(east, north, i, 9));
    if (pt) accepted.push(pt);
  }
  const distance = totalDistanceM(accepted);
  assert.ok(distance < 25, `phantom distance while standing still: ${distance.toFixed(1)} m`);
});

test('noisy straight-line hike measures close to truth', () => {
  const p = new GpsPipeline('hike');
  const accepted = [];
  // true movement: 1.5 m/s east for 400 s = 600 m, ±5 m noise per fix
  for (let i = 0; i < 400; i++) {
    const pt = p.process(fix(1.5 * i + 5 * noise(i), 5 * noise(i, 2), i, 7));
    if (pt) accepted.push(pt);
  }
  const distance = totalDistanceM(accepted);
  // ±8%: the raw-to-raw speed gate admits slightly more (noisier) fixes than
  // the old kalman-referenced gate, which under-counted at sustained speed
  assert.ok(
    distance > 555 && distance < 650,
    `expected ≈600 m, measured ${distance.toFixed(1)} m`,
  );
});

test('warmup rejects poor cold fixes, anchors on the first sharp one', () => {
  const p = new GpsPipeline('run');
  assert.equal(p.process(fix(200, 0, 0, 60)), null, 'cold 60 m fix must not anchor');
  assert.equal(p.process(fix(150, 0, 1, 40)), null, 'cold 40 m fix must not anchor');
  const anchor = p.process(fix(0, 0, 2, 10));
  assert.ok(anchor, 'sharp 10 m fix anchors');
});

test('teleport spike is rejected', () => {
  const p = new GpsPipeline('run');
  p.process(fix(0, 0, 0, 8));
  assert.equal(p.process(fix(200, 0, 2, 8)), null, '100 m/s jump must be rejected');
  // and a sane follow-up still works
  assert.ok(p.process(fix(10, 0, 4, 8)));
});

test('non-monotonic timestamps are rejected', () => {
  const p = new GpsPipeline('hike');
  p.process(fix(0, 0, 10, 8));
  assert.equal(p.process(fix(6, 0, 9, 8)), null);
});

test('kalman pulls outliers toward the path instead of following them', () => {
  const p = new GpsPipeline('hike');
  const a = p.process(fix(0, 0, 0, 8));
  assert.ok(a);
  p.process(fix(8, 0, 5, 8));
  // a legal-speed but off-course fix (20 m sideways at accuracy 24) gets damped
  const outlier = p.process(fix(16, 20, 10, 24));
  if (outlier) {
    const sideways = haversineM({ lat: outlier.lat, lng: BASE.lng }, BASE);
    assert.ok(sideways < 14, `outlier followed too far sideways: ${sideways.toFixed(1)} m`);
  }
});

test('hike: vehicle-speed fixes are rejected (bus segment)', () => {
  // 8 m/s (29 km/h) — way above any walking gait, below the old 12 m/s gate
  const bus = new GpsPipeline('hike');
  bus.process(fix(0, 0, 0, 8));
  let accepted = 0;
  for (let i = 1; i <= 60; i++) {
    if (bus.process(fix(8 * i, 0, i, 8, 8))) accepted += 1;
  }
  assert.equal(accepted, 0, `bus fixes stored on hike: ${accepted}`);

  // same trace on run is legal (sprint) and records
  const run = new GpsPipeline('run');
  run.process(fix(0, 0, 0, 8));
  let runAccepted = 0;
  for (let i = 1; i <= 60; i++) {
    if (run.process(fix(8 * i, 0, i, 8, 8))) runAccepted += 1;
  }
  assert.ok(runAccepted > 40, `sprint fixes must store on run, got ${runAccepted}`);
});

test('hike: brisk 1.8 m/s pace records full distance', () => {
  const p = new GpsPipeline('hike');
  const accepted = [];
  for (let i = 0; i < 300; i++) {
    const pt = p.process(fix(1.8 * i + 4 * noise(i), 4 * noise(i, 3), i, 7, 1.8));
    if (pt) accepted.push(pt);
  }
  const distance = totalDistanceM(accepted);
  assert.ok(
    distance > 500 && distance < 580,
    `expected ≈540 m, measured ${distance.toFixed(1)} m`,
  );
});

test('run: sprint at 8 m/s passes, 15 m/s teleport rejected', () => {
  const p = new GpsPipeline('run');
  p.process(fix(0, 0, 0, 8));
  assert.equal(p.process(fix(30, 0, 2, 8)), null, '15 m/s must be rejected on run');
  let accepted = 0;
  for (let i = 1; i <= 30; i++) {
    if (p.process(fix(8 * i, 0, i + 2, 8, 8))) accepted += 1;
  }
  assert.ok(accepted > 15, `sprint must store on run, got ${accepted}`);
});

test('ride: 20 m/s descent passes, 30 m/s rejected, 33 m accuracy tolerated', () => {
  const p = new GpsPipeline('ride');
  p.process(fix(0, 0, 0, 8));
  assert.equal(p.process(fix(60, 0, 2, 8)), null, '30 m/s must be rejected on ride');
  let accepted = 0;
  for (let i = 1; i <= 30; i++) {
    // 20 m/s descent with mediocre 33 m accuracy — ride tolerates up to 35 m
    if (p.process(fix(20 * i, 0, i + 2, 33, 20))) accepted += 1;
  }
  assert.ok(accepted > 15, `descent must store on ride, got ${accepted}`);

  // identical accuracy is over hike's 30 m hard limit
  const hikeP = new GpsPipeline('hike');
  hikeP.process(fix(0, 0, 0, 8));
  let hikeAccepted = 0;
  for (let i = 1; i <= 30; i++) {
    if (hikeP.process(fix(1.5 * i, 0, i, 33, 1.5))) hikeAccepted += 1;
  }
  assert.equal(hikeAccepted, 0, `33 m accuracy fixes stored on hike: ${hikeAccepted}`);
});

test('hike: 28 m accuracy (tree cover) still records — run rejects it', () => {
  const hikeP = new GpsPipeline('hike');
  hikeP.process(fix(0, 0, 0, 8));
  let hikeAccepted = 0;
  for (let i = 1; i <= 40; i++) {
    if (hikeP.process(fix(1.5 * i, 0, i, 28, 1.5))) hikeAccepted += 1;
  }
  // emissions are deliberately sparse at poor accuracy (spacing 0.6×28 ≈ 17 m),
  // but the track keeps recording — run would store nothing at all
  assert.ok(hikeAccepted >= 2, `forest-grade fixes must store on hike, got ${hikeAccepted}`);

  const runP = new GpsPipeline('run');
  runP.process(fix(0, 0, 0, 8));
  let runAccepted = 0;
  for (let i = 1; i <= 40; i++) {
    if (runP.process(fix(3 * i, 0, i, 28, 3))) runAccepted += 1;
  }
  assert.equal(runAccepted, 0, `28 m accuracy fixes stored on run: ${runAccepted}`);
});
