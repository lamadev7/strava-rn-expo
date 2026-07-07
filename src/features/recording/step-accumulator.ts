import type { ActivityType } from './geo';

/**
 * Pure step bookkeeping — no native imports so it runs under the node test
 * runner. The pedometer reports steps-since-subscription; pausing removes the
 * subscription, so totals must accumulate across pause/resume segments.
 */

/** step counting only makes sense on foot */
export function tracksSteps(type: ActivityType): boolean {
  return type === 'hike' || type === 'run';
}

export class StepAccumulator {
  /** steps banked from completed subscription segments */
  private banked = 0;
  /** latest steps-since-subscribe reading of the LIVE segment */
  private live = 0;

  /** reading from the current subscription — monotonic within a segment */
  addReading(stepsSinceSubscribe: number) {
    if (!Number.isFinite(stepsSinceSubscribe) || stepsSinceSubscribe < 0) return;
    this.live = stepsSinceSubscribe;
  }

  /** segment ended (pause/stop): bank the live count */
  endSegment() {
    this.banked += this.live;
    this.live = 0;
  }

  total(): number {
    return this.banked + this.live;
  }

  reset() {
    this.banked = 0;
    this.live = 0;
  }
}
