import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** TECH_SPEC §4 — M2 scope: activities + track_points (shape_routes/osm_networks arrive at M5/M6) */

export const activities = sqliteTable('activities', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['run', 'ride', 'walk'] }).notNull(),
  status: text('status', { enum: ['recording', 'paused', 'complete', 'discarded'] }).notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  distanceM: real('distance_m').notNull().default(0),
  durationS: integer('duration_s').notNull().default(0),
  avgPaceSecPerKm: real('avg_pace_sec_per_km'),
  elevGainM: real('elev_gain_m'),
});

export const trackPoints = sqliteTable(
  'track_points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    altitude: real('altitude'),
    timestamp: integer('timestamp').notNull(),
    speed: real('speed'),
    accuracy: real('accuracy'),
  },
  (t) => [index('track_points_activity_seq').on(t.activityId, t.seq)],
);

export type ActivityRow = typeof activities.$inferSelect;
export type TrackPointRow = typeof trackPoints.$inferSelect;
