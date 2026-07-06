# Strava 2.0 — Technical Specification

> Version 1.0 — 2026-07-04. Consolidated from planning research (see Obsidian `Tech/wiki/Projects/Strava 2.0/`).
> Status: pre-implementation. Governs milestones M0–M7.

---

## 1. Product Summary

iOS-first mobile fitness tracker (run / ride / walk) built on Expo: precise GPS recording, background tracking, activity history and detail charts. A differentiator feature slot is reserved and will be specified later (the former shape-route generation feature was removed 2026-07-06).

Non-goals (v1–v2): social feed, accounts, cloud sync, segments, paid services. Local-first.

## 2. Stack

| Layer | Choice | Version / Notes |
|---|---|---|
| Framework | Expo SDK 57, React Native, React, TypeScript | expo ~57.0, RN 0.86, React 19.2, TS ~6.0 |
| Routing | expo-router | ~57.0 (no longer built on React Navigation since SDK 56) |
| Maps | @maplibre/maplibre-react-native | OpenFreeMap vector tiles — keyless (M1 basemap gate resolved, §2.1) |
| Location | expo-location + expo-task-manager | background = dev build only |
| Database | expo-sqlite + Drizzle ORM | WAL mode; `useLiveQuery` for reactive reads |
| Preferences | expo-sqlite/kv-store | replaces AsyncStorage |
| Geometry | @turf/turf | polyline simplify, geo utils |
| Charts | victory-native XL (Skia) | Skia bundled in Expo Go since SDK 46 |
| State | zustand | ~5 fields only; SQLite is source of truth |

### 2.1 Basemaps (M1 gate resolved; satellite added 2026-07-07)

`@maplibre/maplibre-react-native` renders one of three styles, picked via the segmented switcher (top-right on map screens, `components/map-style-switcher.tsx`):

| Key | Source | Notes |
|---|---|---|
| `dark` | OpenFreeMap `styles/dark` | default; Trace aesthetic |
| `liberty` | OpenFreeMap `styles/liberty` | detailed OSM (POIs, names) |
| `satellite` | Esri World Imagery raster + AWS Terrarium `raster-dem` | inline style JSON in `features/settings/map-style.ts`; MapLibre `terrain` (exaggeration 1.15) = 3D terrain; camera auto-pitches 50° on entry. Keyless/free with attribution. DEM maxzoom 15. No free photorealistic 3D buildings exist (Google 3D Tiles paid, Apple MapKit-only). |

**Workflow**: development build from day 1 (`expo-dev-client`, local `npx expo run:ios`). Never hand-edit `ios/`/`android/` — SDK 57 `expo prebuild` clears and regenerates them; all native config lives in `app.json` config plugins.

Rule (from AGENTS.md): read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before implementing against any Expo API.

## 3. Repository Layout

```
src/
  app/                     # expo-router routes
    (tabs)/
      index.tsx            # Record screen (map + start/stop)
      history.tsx          # Activity list
      profile.tsx          # Totals, settings
    activity/[id].tsx      # Activity detail (charts)
  features/
    recording/             # state machine, background task, point filter, stats
    activities/            # queries, splits, detail derivations
    map/                   # map components, polyline layers, camera follow
  db/                      # drizzle schema + migrations
  lib/                     # geo utils, formatters, constants
docs/
  TECH_SPEC.md             # this file
```

## 4. Data Model (Drizzle / SQLite)

Draft schema — finalize at M2.

```ts
// db/schema.ts (draft)
activities: {
  id: text (uuid, pk),
  type: text enum 'run' | 'ride' | 'walk',
  status: text enum 'recording' | 'paused' | 'complete' | 'discarded',
  startedAt: integer (epoch ms),
  endedAt: integer | null,
  distanceM: real,            // computed at stop; live value derived from points
  durationS: integer,         // moving time
  avgPaceSecPerKm: real | null,
  elevGainM: real | null,
}

track_points: {
  id: integer (pk autoincrement),
  activityId: text (fk, indexed),
  seq: integer,               // monotonic per activity
  lat: real, lng: real,
  altitude: real | null,
  timestamp: integer (epoch ms),
  speed: real | null,         // m/s from GPS
  accuracy: real | null,      // meters
}
```

Notes:
- SQLite opened with WAL (`PRAGMA journal_mode=WAL`) — background task writes while UI reads.
- 1-hour run @ 1 pt/s ≈ 3,600 `track_points` rows — trivial for SQLite.
- Index: `track_points(activityId, seq)`.

## 5. Recording Pipeline

### 5.1 Invariant

**SQLite is the source of truth; the UI is a pure reader.** The background task must never depend on React being alive. App killed mid-run → relaunch finds `activities.status = 'recording'` → offer resume/finish. Nothing lost.

### 5.2 Background task

```
TaskManager.defineTask(RECORDING_TASK, handler)   // module top level — REQUIRED
Location.startLocationUpdatesAsync(RECORDING_TASK, {
  accuracy: Accuracy.BestForNavigation,
  activityType: ActivityType.Fitness,
  timeInterval: 1000,             // Android: ~1 Hz
  distanceInterval: 0,            // iOS: continuous fixes — batching/deferral makes the live trail lag (fixed 2026-07-06)
  pausesUpdatesAutomatically: false,  // iOS can otherwise silently stop mid-run
  showsBackgroundLocationIndicator: true,
  // Android (later): foregroundService { notificationTitle, notificationBody }
})
```

Handler: receive batch → filter (§5.3) → single transaction insert into `track_points`.

### 5.3 Precision pipeline (hardened 2026-07-05 — `gps-pipeline.ts`, unit-tested)

Stage order (Kalman always ingests; emission is a separate decision):
1. **Warmup gate** — no anchor until a fix with accuracy ≤ 15 m (cold fixes jump wildly); after 10 s relax to the hard limit.
2. **Hard gates** — reject: accuracy > 25 m (run/walk) / 35 m (ride); non-monotonic timestamp; implied speed > 12 m/s (run/walk) / 25 m/s (ride).
3. **Kalman update** — 1D per axis; measurement noise = accuracy²; process noise 1.5/3/6 m/s (walk/run/ride). Outliers nudge the path, sharp fixes move it.
4. **Emission gates** — store a point only when ALL hold:
   - doppler speed (when reported) ≥ 0.4 m/s — chip-level stationary detection;
   - smoothed-velocity EMA ≥ 0.5 m/s — the Kalman position itself is moving;
   - smoothed step since last stored point ≥ max(5 m, 0.6 × accuracy).

Result: standing still stores nothing (zero phantom distance); straight-line distance within ~5% of truth under ±5 m noise (see `gps-pipeline.test.ts`, `npm test`).

### 5.4 Derived stats

- **Distance**: Σ haversine(pᵢ, pᵢ₊₁) over accepted points.
- **Pace**: rolling window (~30 s) over distance deltas; avg pace = movingTime / km.
- **Elevation gain**: Σ positive altitude deltas after smoothing (moving average, window ~5) — raw GPS altitude too noisy.
- **Moving time**: exclude gaps where speed < 0.5 m/s for > 10 s (auto-pause detection, display-only in v1).

### 5.5 Live UI

- `useLiveQuery` on `track_points` for the active activity → polyline + stats.
- Throttle map polyline updates to ~1/s; `turf.simplify` for render when > 1,000 points.
- **User puck** (`features/map/heading-puck.tsx`): RN view on a MapLibre `Marker` — accent dot (white border), pulsing glow (Reanimated `withRepeat`), and a pre-baked gradient flashlight cone (`assets/images/heading-beam.png`, regenerate via `scripts/gen-heading-beam.js`) rotated by the magnetometer (`watchHeadingAsync`) so it tracks device FACING while stationary (GPS course only updates when moving). Rotation is screen-space — valid only while camera bearing stays 0 (north-up); subtract map bearing if that ever changes.
- **Map children invariant**: never conditionally mount/unmount Layers, Sources, or Markers inside the map — MapLibre RN freezes each `id` per component instance and reshuffled siblings throw `` `id` cannot be changed ``. Keep them mounted; hide via opacity.
- Press feedback app-wide via `components/scale-pressable.tsx` (spring scale); screen-state transitions use Reanimated entering/exiting + `LinearTransition`.

### 5.6 Permissions (iOS)

- Happy path = **While Using**: recording started in foreground continues in background with `UIBackgroundModes: ["location"]`. **Always is not required** (we never start from background).
- Education sheet before any system prompt.
- Config plugin (app.json): `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes: ["location"]`.
- Denial → banner + Settings deep link; foreground-only mode still functions.

## 6. Activity Replay (shipped 2026-07-06)

Replay a completed activity as an animated marker gliding along the recorded path. No schema change — replays are derived entirely from `track_points` (lat/lng/timestamp/speed).

- Engine: `features/playback/use-playback.ts` — playback timeline from real timestamps with idle gaps capped at 5 s (pauses skipped), linear interpolation between points, binary-search segment lookup, RAF clock throttled to ~30 fps.
- Rates: 4× / 10× / 30× (cycle button).
- Live readouts during replay: current speed (km/h, from recorded doppler speed with segment-distance fallback), distance covered, real elapsed time.
- Map: full route dims to 25%, traveled portion draws at full accent, marker is an accent dot with white border. Traveled-line source and marker stay mounted permanently (opacity-toggled) — conditionally mounting map children trips MapLibre's frozen-id invariant.

(The former shape-route generation feature was removed 2026-07-06 before implementation started; replay took its slot.)

## 7. (removed)

Removed with the shape feature — section number kept so cross-references stay stable.

## 8. External Services ($0 budget)

| Service | Use | Limit / Policy |
|---|---|---|
| OpenFreeMap | vector tiles for MapLibre | unlimited, keyless |

No backend.

## 9. Milestones

| M | Deliverable | Key tech | Exit criterion (field-tested) |
|---|---|---|---|
| M0 | Dev build on iPhone | expo-dev-client, Xcode | hot reload on device |
| M1 | Foreground GPS + map | expo-location, react-native-maps | live position + trail while app open |
| M2 | Recording + SQLite | drizzle, state machine | walk recorded, survives app kill |
| M3 | Background tracking | task-manager, UIBackgroundModes | 30-min locked-screen walk = full track |
| M4 | Detail + charts | victory-native, splits | detail screen ≈ baby Strava |
| M5+ | Next feature (TBD) | — | reserved; former shape milestones (M5–M7) removed 2026-07-06 |

## 10. Testing Strategy

- **Pure functions unit-tested in plain TS** (platform-free): point filter, haversine distance, pace/elevation derivations.
- **Simulator**: GPX playback for recording-pipeline development.
- **Field tests are exit criteria** for every milestone (real walks/runs; battery measured at M3).
- No UI test framework in v1; UI verified by field use.

## 11. Decision Log

| Date | Decision |
|---|---|
| 2026-07-04 | iOS first; local Xcode dev builds; free Apple ID (7-day re-sign) |
| 2026-07-04 | react-native-maps + Apple Maps (keyless); MapLibre deferred to Android phase |
| 2026-07-04 | Drizzle over Prisma (Prisma has no production RN runtime); zustand over Redux (≈5 fields of state) |
| 2026-07-04 | Tracker-first order (M1–M4 first) |
| 2026-07-04 | While-Using permission is the happy path; Always optional |
| 2026-07-04 | `pausesUpdatesAutomatically: false` during active recording |
| 2026-07-04 | M1 basemap gate (§2.1): resolved — MapLibre + OpenFreeMap |
| 2026-07-06 | Continuous ~1 Hz location delivery while recording (no deferred batching); camera follows via easeTo preserving user zoom |
| 2026-07-06 | Shape-route feature removed entirely (code, tabs, schema plans, docs) before implementation; Activity Replay took the slot (§6) |
| 2026-07-06 | User puck = RN Marker view (not map layers): compass beam via watchHeadingAsync, pulsing glow via Reanimated; map layers proved untintable/uncrashable-only-with-care (frozen-id invariant, §5.5) |
| 2026-07-07 | Satellite 3D basemap: Esri imagery + Terrarium DEM, free/keyless; segmented style switcher top-right replaces cycle button |

## 12. References

- Planning notes: Obsidian `Tech/wiki/Projects/Strava 2.0/` (Overview, Milestones, Architecture, Risks, User Flows, 2 research notes)
- Expo SDK 57 docs: https://docs.expo.dev/versions/v57.0.0/
