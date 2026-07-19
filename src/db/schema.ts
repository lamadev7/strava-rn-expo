import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** TECH_SPEC §4 — activities + track_points */

export const activities = sqliteTable('activities', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['run', 'ride', 'hike'] }).notNull(),
  status: text('status', { enum: ['recording', 'paused', 'complete', 'discarded'] }).notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  distanceM: real('distance_m').notNull().default(0),
  durationS: integer('duration_s').notNull().default(0),
  avgPaceSecPerKm: real('avg_pace_sec_per_km'),
  /** reverse-geocoded place names for the card title ("Gairidhara → Lazimpat") */
  startPlace: text('start_place'),
  endPlace: text('end_place'),
  elevGainM: real('elev_gain_m'),
  elevLossM: real('elev_loss_m'),
  /** pedometer total for hike/run; null when unavailable or type is ride */
  steps: integer('steps'),
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

export const moments = sqliteTable(
  'moments',
  {
    id: text('id').primaryKey(),
    activityId: text('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    /** filename under <documentDirectory>/moments — container path shifts between installs */
    photo: text('photo').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    distanceM: real('distance_m').notNull(),
    elapsedS: integer('elapsed_s').notNull(),
    timestamp: integer('timestamp').notNull(),
    /** reverse-geocoded place name shown on the replay popup card */
    place: text('place'),
  },
  (t) => [index('moments_activity').on(t.activityId)],
);

export type ActivityRow = typeof activities.$inferSelect;
export type TrackPointRow = typeof trackPoints.$inferSelect;
export type MomentRow = typeof moments.$inferSelect;
