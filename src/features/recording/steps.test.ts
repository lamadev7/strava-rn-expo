import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StepAccumulator, tracksSteps } from './step-accumulator';

test('tracksSteps: hike and run count steps, ride does not', () => {
  assert.equal(tracksSteps('hike'), true);
  assert.equal(tracksSteps('run'), true);
  assert.equal(tracksSteps('ride'), false);
});

test('readings within one segment are cumulative, not additive', () => {
  const acc = new StepAccumulator();
  acc.addReading(10);
  acc.addReading(25);
  acc.addReading(40); // pedometer reports steps-since-subscribe
  assert.equal(acc.total(), 40);
});

test('pause/resume banks each segment and sums across them', () => {
  const acc = new StepAccumulator();
  acc.addReading(120);
  acc.endSegment(); // pause at 120
  assert.equal(acc.total(), 120);
  acc.addReading(30); // new subscription counts from zero
  assert.equal(acc.total(), 150);
  acc.endSegment(); // stop
  assert.equal(acc.total(), 150);
});

test('multiple pause cycles keep accumulating', () => {
  const acc = new StepAccumulator();
  for (const segment of [100, 200, 50]) {
    acc.addReading(segment);
    acc.endSegment();
  }
  assert.equal(acc.total(), 350);
});

test('ending an empty segment adds nothing', () => {
  const acc = new StepAccumulator();
  acc.endSegment();
  acc.endSegment();
  assert.equal(acc.total(), 0);
});

test('garbage readings are ignored', () => {
  const acc = new StepAccumulator();
  acc.addReading(80);
  acc.addReading(-5);
  acc.addReading(NaN);
  acc.addReading(Infinity);
  assert.equal(acc.total(), 80);
});

test('reset clears banked and live counts', () => {
  const acc = new StepAccumulator();
  acc.addReading(500);
  acc.endSegment();
  acc.addReading(20);
  acc.reset();
  assert.equal(acc.total(), 0);
  acc.addReading(7);
  assert.equal(acc.total(), 7);
});
