import { desc, eq, sql } from 'drizzle-orm';
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { db } from '@/db/client';
import { activities, trackPoints } from '@/db/schema';

import { haversineM, type TrackPoint } from './geo';
import { GpsPipeline } from './gps-pipeline';

export const RECORDING_TASK = 'trace-recording';

/**
 * TECH_SPEC §5.1/§5.2 — the ingest path must not depend on React being alive.
 * This task is a pure DB writer: batch in → precision pipeline → append
 * track_points → bump activities.distance_m. The UI is a reader (useLiveQuery).
 *
 * The pipeline instance survives across batches while the JS runtime lives;
 * after a process restart it re-seeds from the last stored point.
 */
let pipeline: GpsPipeline | null = null;
let pipelineActivityId: string | null = null;

TaskManager.defineTask<{ locations: LocationObject[] }>(RECORDING_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;

  const [active] = await db
    .select()
    .from(activities)
    .where(eq(activities.status, 'recording'))
    .orderBy(desc(activities.startedAt))
    .limit(1);
  if (!active) return;

  const [lastRow] = await db
    .select()
    .from(trackPoints)
    .where(eq(trackPoints.activityId, active.id))
    .orderBy(desc(trackPoints.seq))
    .limit(1);

  if (pipelineActivityId !== active.id || !pipeline) {
    pipeline = new GpsPipeline(active.type, lastRow ?? undefined);
    pipelineActivityId = active.id;
  }

  let previous: TrackPoint | undefined = lastRow ?? undefined;
  let seq = lastRow?.seq ?? 0;
  let addedM = 0;
  const rows = [];

  for (const location of data.locations) {
    const point = pipeline.process(location);
    if (!point) continue;
    if (previous) addedM += haversineM(previous, point);
    seq += 1;
    rows.push({ activityId: active.id, seq, ...point });
    previous = point;
  }

  if (rows.length === 0) return;
  await db.insert(trackPoints).values(rows);
  await db
    .update(activities)
    .set({ distanceM: sql`${activities.distanceM} + ${addedM}` })
    .where(eq(activities.id, active.id));
});
