# Strava 2.0 — Technical Specification

> Version 1.0 — 2026-07-04. Consolidated from planning research (see Obsidian `Tech/wiki/Projects/Strava 2.0/`).
> Status: pre-implementation. Governs milestones M0–M7.

---

## 1. Product Summary

iOS-first mobile fitness tracker (run / ride / walk) built on Expo. Differentiator: **shape-route generation** — the app scans the user's local street network and suggests real, runnable loop routes shaped like geometric figures (circle, oval, square, heart, …), ranked by an honest predicted fit score. After running one, the app overlays actual GPS trail on the intended shape with a similarity score.

Non-goals (v1–v2): social feed, accounts, cloud sync, segments, paid services. Local-first.

## 2. Stack

| Layer | Choice | Version / Notes |
|---|---|---|
| Framework | Expo SDK 57, React Native, React, TypeScript | expo ~57.0, RN 0.86, React 19.2, TS ~6.0 |
| Routing | expo-router | ~57.0 (no longer built on React Navigation since SDK 56) |
| Maps | react-native-maps | Apple Maps provider on iOS — keyless. Subject to the M1 basemap gate (§2.1) |
| Location | expo-location + expo-task-manager | background = dev build only |
| Database | expo-sqlite + Drizzle ORM | WAL mode; `useLiveQuery` for reactive reads |
| Preferences | expo-sqlite/kv-store | replaces AsyncStorage |
| Geometry | @turf/turf, curve-matcher, geojson-path-finder | templates / Fréchet scoring / on-device Dijkstra |
| Charts | victory-native XL (Skia) | Skia bundled in Expo Go since SDK 46 |
| State | zustand | ~5 fields only; SQLite is source of truth |

### 2.1 M1 basemap decision gate

The visual basemap (Apple Maps) and the routing data (OSM via Overpass/ORS) are independent layers. Routes are computed on OSM and drawn as overlays; if the basemap does not render a footpath the route legitimately uses, the route *looks* like it crosses empty ground — a trust problem, not a correctness problem. Mismatch risk is highest outside Apple's detailed-map regions (US/EU major cities).

**Gate, evaluated at M1 in the developer's own running area:**
- Apple basemap renders local footpaths → keep `react-native-maps` for MVP.
- Basemap is bare where OSM is rich → switch to `@maplibre/maplibre-react-native` + OpenFreeMap tiles at M1 (OSM-rendered tiles = same dataset as routing = visual consistency; dev build already required; $0, keyless).
- Regardless of outcome: satellite/hybrid toggle on route-preview so users can verify routes against imagery.

**Workflow**: development build from day 1 (`expo-dev-client`, local `npx expo run:ios`). Never hand-edit `ios/`/`android/` — SDK 57 `expo prebuild` clears and regenerates them; all native config lives in `app.json` config plugins.

Rule (from AGENTS.md): read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before implementing against any Expo API.

## 3. Repository Layout

```
src/
  app/                     # expo-router routes
    (tabs)/
      index.tsx            # Record screen (map + start/stop)
      history.tsx          # Activity list
      shapes.tsx           # Shape scan + suggestions
      profile.tsx          # Totals, settings
    activity/[id].tsx      # Activity detail (charts, overlay)
    route-preview.tsx      # Generated route preview / actions
  features/
    recording/             # state machine, background task, point filter, stats
    activities/            # queries, splits, detail derivations
    shape-routes/          # templates, scan, optimizer, scoring, ORS client
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
  shapeRouteId: text | null,  // fk → shape_routes.id
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

shape_routes: {
  id: text (uuid, pk),
  shape: text,                // template key: 'circle' | 'oval' | 'square' | 'heart' | ...
  targetDistanceM: integer,
  startLat: real, startLng: real,
  geometry: text,             // GeoJSON LineString (JSON string)
  similarityScore: real,      // 0–1, curve-matcher shapeSimilarity
  createdAt: integer,
}

osm_networks: {               // Overpass response cache
  id: text (pk),              // geohash(center) + radius bucket
  centerLat: real, centerLng: real,
  radiusM: integer,
  geojson: text,              // walkable network as GeoJSON FeatureCollection
  fetchedAt: integer,         // TTL ~30 days
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
  distanceInterval: 5,            // meters
  deferredUpdatesInterval: 5000,  // batch delivery ~5 s
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

### 5.6 Permissions (iOS)

- Happy path = **While Using**: recording started in foreground continues in background with `UIBackgroundModes: ["location"]`. **Always is not required** (we never start from background).
- Education sheet before any system prompt.
- Config plugin (app.json): `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes: ["location"]`.
- Denial → banner + Settings deep link; foreground-only mode still functions.

## 6. Shape Route Engine

### 6.1 UX contract (suggestion-first)

User provides **start point + target distance** only. No upfront shape pick, no destination (shapes are closed loops; start = end — A→B open lines cannot form shapes).

```
Scan → ranked "Best for your area" (top 3–5 with predicted %)
     → "All shapes" grid (full library, every shape shows predicted % +
        distance hints; nothing hidden; any shape forceable)
Tap shape → deep fit → route-preview (final % + Shuffle / Save / Run)
```

**Score integrity rule (decision B):** predicted scores come from a *mini deep-fit* — the real optimizer at a small candidate budget — never from standalone heuristics. Same scorer in both passes so predicted ≈ final. Heuristics may only pre-filter hopeless shapes (e.g., area too sparse for stars) and must be labeled "not scanned", never given a fake number.

### 6.2 Shape templates

A template is a parametric closed curve sampled to N points, normalized to unit scale:

```ts
type ShapeTemplate = {
  key: string;                    // 'heart', 'circle', ...
  label: string;
  minRecommendedKm?: number;      // e.g. heart ≈ 4+, star ≈ 8+
  points: (n: number) => Position[];  // n samples along the closed curve
}
```

Library is open-ended (circle, oval, square, heart, triangle, diamond, hexagon, star, …). Adding a shape = adding one template. Custom finger-drawn shapes (V3) reuse the same pipeline.

### 6.3 Street network

- Source: Overpass API — walkable ways within radius ≈ `targetDistance/π + margin` of start.
  Filter: `highway ∈ {footway, path, pedestrian, living_street, residential, service, track, unclassified, tertiary, cycleway}` and `foot != no` and `access != private`.
- Converted to GeoJSON LineStrings → cached in `osm_networks` (TTL 30 days, keyed by geohash + radius bucket).
- Graph: `geojson-path-finder` (Dijkstra) built from cached GeoJSON. Few-thousand edges typical; build < 1 s, each route ~ms.
- Overpass failure → fall back to kumi.systems mirror → else cached areas only + clear "need connection" message.

### 6.4 Fitting algorithm (deep fit)

```
for candidate in (translation grid ±200–500 m) × (rotations, 12 × 30°) × (scale ±20%):
  1. place template at candidate transform, perimeter = target distance
  2. sample 15–40 via-points along template
  3. snap each via-point to nearest graph node
  4. route consecutive pairs with Dijkstra (closed: last → first)
  5. leg detour ratio = routedLegLen / templateLegLen;
     if > 2 → move via-point once, retry; still bad → penalize
  6. score = curveMatcher.shapeSimilarity(routed, template)
             − w · |routedLen − targetLen| / targetLen
keep best; budget: deep fit ~50–200 candidates, mini fit (scan) ~10–20
```

Winner → **one** external call for a clean navigable polyline (§6.5) → persist `shape_routes`.

### 6.5 External routing (polish / MVP)

- **openrouteservice** `foot-walking`, free key: ~2,000 req/day, 40/min, **max 50 waypoints**, round_trip ≤ 100 km.
- MVP (M5): circle/oval via ORS `options.round_trip { length, points, seed }`; returned loop is **re-scored** with curve-matcher (round_trip does not guarantee circularity), retry 2–3 seeds, display real %.
- Fallback router: FOSSGIS Valhalla (`valhalla.openstreetmap.de`), ~1 req/user/s, must send identifying `X-Client-Id` header.
- Budget rule: ≤ 1 external routing call per generated route (optimizer is fully on-device).
- API key ships in the client — acceptable for personal MVP; revisit (proxy) before any public release.

### 6.6 M5 scope cut (decision A)

M5 ships the Shapes tab with **only circle + oval active**; all other tiles greyed "coming soon". No fake scores. Full scan + library activates at M6.

## 7. Follow Mode (M7)

- Planned route rendered dashed; live trail solid.
- Off-route check per accepted GPS point: `turf.pointToLineDistance(current, planned) > 40 m` → "off shape" banner (debounced, 2 consecutive points).
- Post-run overlay: intended vs actual + final `shapeSimilarity` on activity detail. Link via `activities.shapeRouteId`.

## 8. External Services ($0 budget)

| Service | Use | Limit / Policy |
|---|---|---|
| openrouteservice | MVP routing + polish call | ~2,000/day, 40/min, 50 waypoints |
| Overpass API | walk network download | fair use; cache hard; kumi mirror fallback |
| FOSSGIS Valhalla | fallback router | ~1 req/user/s, X-Client-Id required |
| Nominatim | optional address → start point | 1 req/s, identifying UA, cache results |
| OpenFreeMap | vector tiles (MapLibre phase, deferred) | unlimited, keyless |

No backend. Escape hatch if optimizer outgrows the phone: FastAPI + osmnx microservice (Render free tier / Oracle Always Free) — see Obsidian research note, Option B.

## 9. Milestones

| M | Deliverable | Key tech | Exit criterion (field-tested) |
|---|---|---|---|
| M0 | Dev build on iPhone | expo-dev-client, Xcode | hot reload on device |
| M1 | Foreground GPS + map | expo-location, react-native-maps | live position + trail while app open |
| M2 | Recording + SQLite | drizzle, state machine | walk recorded, survives app kill |
| M3 | Background tracking | task-manager, UIBackgroundModes | 30-min locked-screen walk = full track |
| M4 | Detail + charts | victory-native, splits | detail screen ≈ baby Strava |
| M5 | Shapes MVP | ORS round_trip, re-scoring | runnable 5 km loop suggested (circle/oval only) |
| M6 | Full shape engine | Overpass, optimizer, scan | recognizable heart ≥ ~80% in normal grid |
| M7 | Follow mode + overlay | pointToLineDistance | run a shape, see intended-vs-actual |

Allowed resequencing: M5 before M3 if motivation needs an early payoff (shape preview needs no background tracking).

## 10. Testing Strategy

- **Pure functions unit-tested in plain TS** (platform-free): point filter, haversine distance, pace/elevation derivations, template generation, transform math, scoring wrapper, detour-ratio logic.
- **Simulator**: GPX playback for recording-pipeline development.
- **Field tests are exit criteria** for every milestone (real walks/runs; battery measured at M3).
- No UI test framework in v1; UI verified by field use.

## 11. Decision Log

| Date | Decision |
|---|---|
| 2026-07-04 | iOS first; local Xcode dev builds; free Apple ID (7-day re-sign) |
| 2026-07-04 | react-native-maps + Apple Maps (keyless); MapLibre deferred to Android phase |
| 2026-07-04 | Drizzle over Prisma (Prisma has no production RN runtime); zustand over Redux (≈5 fields of state) |
| 2026-07-04 | Tracker-first order (M1–M4 → M5–M6); M5-before-M3 swap allowed |
| 2026-07-04 | Suggestion-first shape UX; shapes are loops; no from→to destination |
| 2026-07-04 | (A) M5 = circle/oval only, rest greyed; no fake scores |
| 2026-07-04 | (B) predicted score = mini deep-fit with real optimizer, never standalone heuristics |
| 2026-07-04 | While-Using permission is the happy path; Always optional |
| 2026-07-04 | `pausesUpdatesAutomatically: false` during active recording |
| 2026-07-04 | M1 basemap gate (§2.1): field-check Apple Maps footpath rendering in own area; switch to MapLibre + OpenFreeMap if bare. Satellite toggle on route-preview either way |

## 12. References

- Planning notes: Obsidian `Tech/wiki/Projects/Strava 2.0/` (Overview, Milestones, Architecture, Risks, User Flows, 2 research notes)
- Expo SDK 57 docs: https://docs.expo.dev/versions/v57.0.0/
- GPS-art paper: https://link.springer.com/article/10.1007/s41095-019-0146-z
- stravart (prior art): https://github.com/dsleo/stravart
- curve-matcher: https://github.com/chanind/curve-matcher
- geojson-path-finder: https://github.com/perliedman/geojson-path-finder
- ORS restrictions: https://openrouteservice.org/restrictions/
