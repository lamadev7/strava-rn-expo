import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';

import { StepAccumulator } from './step-accumulator';

export { StepAccumulator, tracksSteps } from './step-accumulator';

/**
 * Step counting for walk/run recordings.
 *
 * Pure bookkeeping lives in step-accumulator.ts (unit-tested); this file
 * owns the native pedometer subscription lifecycle.
 *
 * Platform caveats (expo-sensors):
 *  - watchStepCount delivers NOTHING while the app is backgrounded.
 *  - iOS can backfill: getStepCountAsync(start, end) queries CoreMotion
 *    history (≤ 7 days), so the final stored total is authoritative there.
 *  - Android has no backfill; background steps during a recording are lost.
 */

export class PedometerSession {
  private accumulator = new StepAccumulator();
  private subscription: { remove(): void } | null = null;
  private available = false;
  private startedAt: number | null = null;

  /**
   * begin a recording — requests permission, subscribes when supported.
   * Returns whether steps will be tracked.
   */
  async start(startedAt: number, onUpdate: (steps: number) => void): Promise<boolean> {
    this.startedAt = startedAt;
    this.accumulator.reset();
    try {
      this.available = await Pedometer.isAvailableAsync();
      if (!this.available) return false;
      const perm = await Pedometer.requestPermissionsAsync();
      if (!perm.granted) {
        this.available = false;
        return false;
      }
      this.subscribe(onUpdate);
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  private subscribe(onUpdate: (steps: number) => void) {
    this.subscription?.remove();
    this.subscription = Pedometer.watchStepCount(({ steps }) => {
      this.accumulator.addReading(steps);
      onUpdate(this.accumulator.total());
    });
  }

  /** pause: stop the segment, keep the banked total */
  pause() {
    this.subscription?.remove();
    this.subscription = null;
    this.accumulator.endSegment();
  }

  resume(onUpdate: (steps: number) => void) {
    if (!this.available) return;
    this.subscribe(onUpdate);
  }

  /**
   * finish: returns the step total to persist, or null when unsupported.
   * On iOS the CoreMotion history query replaces the live tally — it also
   * covers spans where the app was backgrounded and delivery was suspended.
   */
  async stop(endedAt: number): Promise<number | null> {
    this.subscription?.remove();
    this.subscription = null;
    this.accumulator.endSegment();
    if (!this.available || this.startedAt === null) return null;
    if (Platform.OS === 'ios') {
      try {
        const result = await Pedometer.getStepCountAsync(
          new Date(this.startedAt),
          new Date(endedAt),
        );
        if (result && Number.isFinite(result.steps) && result.steps >= 0) {
          return result.steps;
        }
      } catch {
        // fall through to the live tally
      }
    }
    return this.accumulator.total();
  }
}
