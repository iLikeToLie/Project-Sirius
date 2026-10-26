# Singapore Map Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plan-view Link workspace with a full-bleed Singapore terrain map holding up to six TX/RX sensors. Each receiver is judged against its intended transmitter for communication and against every other transmitter for interference, and the selected transmitter's free-space range zones are drawn on the map.

**Architecture:**
- **Pure modules in `src/lib`, test-first:** projection, Terrarium elevation decoding and sampling, the sensor model, pair evaluation, the active-link mapping and zone classification. They feed the unchanged `calculateLink`.
- **Rendering:** MapLibre GL JS with OneMap Grey raster tiles and a Terrarium `raster-dem` hillshade.
- **Elevation:** the same Terrarium tiles are decoded in the browser for elevation.
- **Zone grids:** computed in the existing web worker and drawn as an image overlay plus outline lines.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 3, `maplibre-gl@4.7.1` (new), lucide-react, pnpm 11.19.0 via `corepack pnpm`.

**Spec:** `docs/superpowers/specs/2026-10-26-singapore-map-workspace-design.md`

## Global Constraints

- **Engine:** `src/lib/rf.ts` is not modified. The existing tests in `src/lib/rf.test.ts` stay byte-identical and green.
- **Storage:** local-storage key stays `friis-rf-planner-v3-state`. Schema becomes `schemaVersion: 3`.
- **Sensors:** `MAX_SENSORS = 6`. Roles are exactly `'tx' | 'rx'`. All sensors share one operating frequency (`inputs.frequencyGhz`) and the shared polarization, obstruction and other losses.
- **Objectives:** the intended pair uses objective `'desired'`; every other pair uses `'avoidance'`. Intended transmitter `'auto'` = the nearest transmitter by 3D separation, ties broken by sensor array order.
- **Basemap:** `https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png`, tile size 256, zoom 11–19, bounds `[103.596, 1.1443, 104.4309, 1.4835]`. Attribution `©OneMap Singapore ODL v1.0`.
- **Elevation:** `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, encoding `terrarium`, max zoom 15. Attribution `Elevation: Terrain Tiles on AWS (Mapzen; SRTM, GMTED, ETOPO1)`.
- **No secrets:** no API key, token or secret anywhere in the build.
- **Colours:** threshold colours sensitivity `var(--blue)`, required level `var(--green)`, interference `var(--red)`. Every colour is a token from `src/styles.css`; there is no `transition: all`, every control has `:focus-visible`, and motion has a reduced-motion fallback.
- **Layout:** desktop-first (spec "Layout B"). At under 1000 px, the cards stack below the map; no further mobile work.
- **Wording:** zone copy must say "free-space boundary at Rx height X m above ground; terrain does not block the signal".
- **Version:** web 1.5.0.

## Review Focus

1. **A sensor dragged onto the sea.** Terrarium returns negative bathymetry there. Expect ground elevation 0 m (the water surface), not a negative value. Test in Task 2.
2. **Deleting a transmitter that receivers name as their intended one.** Expect those receivers to fall back to `'auto'`. Test in Task 3.
3. **Toggling the last transmitter to receiver.** Expect receivers to show "No transmitter", no zones and no crash. Test in Task 3.
4. **Two sensors at the same position.** Distance 0 makes `calculateLink` return `Invalid input`. Expect that status with no exception, including in zone and active-link code. Test in Task 3.
5. **Importing a file with 7 sensors, an unknown role or non-numeric fields.** Expect the import to be rejected with the existing alert and the current state untouched. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/geo.ts` (new) | Lat/lon ↔ local metres on a tangent plane at `SG_REFERENCE` |
| `src/lib/elevation.ts` (new) | Terrarium decode, web-mercator tile/pixel math, bilinear tile sampler |
| `src/lib/sensors.ts` (new) | Sensor creation, role toggle, removal, elevation, separation, intended-Tx resolution, pair evaluation, receiver summaries |
| `src/lib/zones.ts` (new) | Zone classification grid and outlines for one Tx and one zone receiver |
| `src/lib/activeLink.ts` (new) | Active pair, zone receiver choice, Calculator inputs ↔ sensors mapping |
| `src/lib/linkGeometry.ts` (modify) | Add the generic `solveTxAlongBearing`; `solveTxForDistance` delegates to it |
| `src/lib/state.ts`, `src/types.ts`, `src/data/defaults.ts` (modify) | Schema 3, migration, import validation |
| `src/workers/fieldWorker.ts` (modify) | Run `computeZones` |
| `src/components/map/useElevationTiles.ts` (new) | Fetch, decode and cache Terrarium tiles; expose `groundAt` |
| `src/components/map/MapWorkspace.tsx` (new) | The view: map, toolbar, cards, wiring |
| `src/components/map/SensorMap.tsx` (new) | The MapLibre instance, markers, link and zone layers |
| `src/components/map/SensorListCard.tsx`, `SelectedSensorCard.tsx`, `LinkSettingsCard.tsx` (new) | The floating cards |
| `src/App.tsx` (modify) | Nav uses `MapWorkspace`; views read the active-link inputs; Guide copy |
| `src/components/PlacementWorkspace.tsx`, `SignalCanvas.tsx`, `src/lib/viewport.ts` usage | `PlacementWorkspace.tsx` is deleted in Task 6. `viewport.ts` stays: its frequency helpers are reused. `SignalCanvas.tsx` is deleted unless Task 8 reuses it. |

---

### Task 1: Local projection

**Files:**
- Create: `src/lib/geo.ts`
- Test: `src/lib/geo.test.ts`

**Interfaces:**
- Produces:
  - `interface LatLon { lat: number; lon: number }`
  - `const SG_REFERENCE: LatLon = { lat: 1.3521, lon: 103.8198 }`
  - `toLocalM(p: LatLon, ref = SG_REFERENCE): { xM: number; yM: number }` (x east, y north)
  - `toLatLon(p: { xM: number; yM: number }, ref = SG_REFERENCE): LatLon`
  - `offsetLatLon(p: LatLon, dxM: number, dyM: number): LatLon`

- [ ] **Step 1: Write failing tests in `src/lib/geo.test.ts`**
  - `maps the reference to the origin`: `toLocalM(SG_REFERENCE)` equals `{ xM: 0, yM: 0 }`.
  - `round-trips island-scale points`: for `{lat:1.32,lon:103.64}` (Tuas) and `{lat:1.36,lon:103.99}` (Changi), `toLatLon(toLocalM(p))` matches `p` to 9 decimal places.
  - `keeps distance error under 0.5 m across the island`: `Math.hypot` of the local Tuas→Changi difference is within 0.5 m of the haversine distance (R = 6 371 008.8 m) computed in the test.
  - `offsets by metres`: `toLocalM(offsetLatLon(SG_REFERENCE, 100, -50))` ≈ `{100, -50}` to 6 decimal places.
- [ ] **Step 2: Run** `corepack pnpm vitest run src/lib/geo.test.ts`. Expected: FAIL, cannot find module `./geo`.
- [ ] **Step 3: Implement `src/lib/geo.ts`** as an equirectangular tangent plane: `xM = R·cos(lat0)·Δlon`, `yM = R·Δlat` (radians), with R = 6 371 008.8, plus its inverse.
- [ ] **Step 4: Run** the same command. Expected: 4 passed.
- [ ] **Step 5: Commit** `git add src/lib/geo.ts src/lib/geo.test.ts && git commit -m "Add Singapore local tangent-plane projection"`

### Task 2: Terrarium elevation sampling

**Files:**
- Create: `src/lib/elevation.ts`
- Test: `src/lib/elevation.test.ts`

**Interfaces:**
- Consumes: `LatLon` (Task 1).
- Produces:
  - `decodeTerrarium(r: number, g: number, b: number): number`
  - `tilePixel(p: LatLon, z: number): { x: number; y: number; px: number; py: number }` (tile indices plus fractional pixel 0–256)
  - `interface ElevationTile { z: number; x: number; y: number; data: Uint8ClampedArray /* 256×256 RGBA */ }`
  - `type TileLookup = (z: number, x: number, y: number) => ElevationTile | undefined`
  - `type GroundAt = (p: LatLon) => number | null`
  - `createGroundSampler(lookup: TileLookup, z: number): GroundAt`, which bilinearly samples, returns `null` when any needed tile is missing, and clamps the result to `>= 0`
  - `ELEVATION_TILE_URL` and `ELEVATION_ZOOM = 14`

- [ ] **Step 1: Write failing tests**
  - `decodes terrarium pixels`: `(128,0,0) → 0`, `(128,20,0) → 20`, `(127,246,0) → -10`, `(128,0,128) → 0.5`.
  - `locates Singapore at zoom 14`: `tilePixel({lat:1.3521, lon:103.8198}, 14)` has `x === 12916` and `y === 8130`.
  - `interpolates bilinearly`: build a tile at a known `(z,x,y)` whose four pixels around the sample point decode to 10, 20, 30, 40. The tile centre-cross point returns 25 ± 1e-9.
  - `returns null for a missing tile`.
  - `clamps sea bathymetry to the water surface`: a tile decoding to −20 returns `0` (Review Focus 1).
- [ ] **Step 2: Run** `corepack pnpm vitest run src/lib/elevation.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement `src/lib/elevation.ts`** with standard web-mercator tile math. Pixel centres sit at `i + 0.5`. Neighbouring pixels that cross a tile edge fetch the adjacent tile through `lookup`.
- [ ] **Step 4: Run** the same command. Expected: 5 passed.
- [ ] **Step 5: Commit** `git add src/lib/elevation.* && git commit -m "Add Terrarium elevation decoding and bilinear sampler"`

### Task 3: Sensor model and pair evaluation

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/sensors.ts`
- Test: `src/lib/sensors.test.ts`

**Interfaces:**
- Consumes:
  - `LatLon`, `toLocalM` (Task 1) and `GroundAt` (Task 2)
  - `calculateLink`, `LinkResult` (`src/lib/rf.ts`)
  - `LinkInputs` (`src/types.ts`)
- Produces, in `src/types.ts`:
  ```ts
  export type SensorRole = 'tx' | 'rx';
  export interface Sensor {
    id: string; name: string; role: SensorRole; lat: number; lon: number; aglM: number;
    gainDbi: number; cableLossDb: number; powerDbm: number;
    sensitivityDbm: number; fadeMarginTargetDb: number; interferenceThresholdDbm: number;
    intendedTxId: 'auto' | string;
  }
  export interface MapScenario { sensors: Sensor[]; selectedId: string | null; zonesForRxId: 'auto' | string; useTerrainElevation: boolean }
  ```
- Produces, in `src/lib/sensors.ts`:
  - `MAX_SENSORS = 6`
  - `createSensor(existing: Sensor[], role: SensorRole, at: LatLon, defaults: LinkInputs): Sensor`
    - The id is unique (`sensor-<n>`); the name is the next free `T1…T6` or `R1…R6`; `aglM` is 10.
    - Tx fields come from `defaults.transmitPowerDbm/txGainDbi/txLossDb`; Rx fields from `rxGainDbi/rxLossDb/sensitivityDbm/fadeMarginTargetDb/interferenceThresholdDbm`.
    - A sensor's `gainDbi` and `cableLossDb` come from its role's default.
  - `addSensor(sensors: Sensor[], sensor: Sensor): Sensor[]` (unchanged when already at `MAX_SENSORS`)
  - `setRole(sensor: Sensor, role: SensorRole): Sensor`
  - `removeSensor(sensors: Sensor[], id: string): Sensor[]` (receivers that pointed at `id` revert to `'auto'`)
  - `groundOf(s: Sensor, groundAt: GroundAt, useTerrain: boolean): number | null` (`0` when terrain is off)
  - `separationM(a: Sensor, b: Sensor, groundAt: GroundAt, useTerrain: boolean): number` (unknown ground is treated as 0 for the arithmetic)
  - `resolveIntendedTx(scenario: MapScenario, rx: Sensor, groundAt: GroundAt): Sensor | null`
  - `pairInputs(shared: LinkInputs, tx: Sensor, rx: Sensor, distanceM: number): LinkInputs`
  - `interface PairResult { txId: string; rxId: string; intended: boolean; distanceM: number; result: LinkResult; elevationKnown: boolean }`
  - `evaluatePairs(scenario: MapScenario, shared: LinkInputs, groundAt: GroundAt): PairResult[]`
  - `receiverSummary(pairs: PairResult[], rxId: string): { link: PairResult | null; worstInterferer: PairResult | null; interferersAbove: number }`

- [ ] **Step 1: Write failing tests** (use a `flat: GroundAt = () => 0` and a scenario helper):
  - `creates sensors from calculator defaults` (T1 gets power 30 and gain 12 from `DEFAULT_STATE.inputs`; R1 gets gain 15 and sensitivity −85).
  - `names and limits sensors`: names T1, T2, R1; a seventh `addSensor` returns the same array.
  - `keeps role-specific values when toggling`: a Tx toggled to Rx and back keeps `powerDbm`.
  - `resolves auto to the nearest transmitter, ties by order`.
  - `reverts receivers to auto when their transmitter is deleted` (Review Focus 2).
  - `has no intended transmitter when none exist` (Review Focus 3): `resolveIntendedTx` is `null`; `evaluatePairs` is `[]`; `receiverSummary(...).link` is `null`.
  - `judges intended pairs as desired and others as avoidance`: two Tx and one Rx. The intended pair's status is in `{Acceptable link, Weak link, No link}`; the other is in `{Possible interference, Below interference threshold}`.
  - `matches the workbook default for one 500 m link`: Tx and Rx 500 m apart with equal AGL and default inputs give `receivedPowerDbm` ≈ −51.187959957979174 (10 decimal places).
  - `reports invalid input for co-located sensors without throwing` (Review Focus 4).
  - `flags pairs whose ground elevation is unknown`: `groundAt` returns `null` with terrain on, so `elevationKnown === false`.
  - `counts interferers above threshold and picks the worst`.
- [ ] **Step 2: Run** `corepack pnpm vitest run src/lib/sensors.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Add the types and implement `src/lib/sensors.ts`.** `pairInputs` maps: `transmitPowerDbm←tx.powerDbm`, `txGainDbi←tx.gainDbi`, `txLossDb←tx.cableLossDb`, `rxGainDbi←rx.gainDbi`, `rxLossDb←rx.cableLossDb`, and the Rx thresholds; it keeps `shared` frequency and losses, `txId←tx.name`, `rxId←rx.name`.
- [ ] **Step 4: Run** the same command. Expected: 11 passed. Then run `corepack pnpm test`: all green.
- [ ] **Step 5: Commit** `git add src/types.ts src/lib/sensors.* && git commit -m "Add sensor model with per-receiver intended transmitter and pair evaluation"`

### Task 4: Zone classification

**Files:**
- Create: `src/lib/zones.ts`
- Test: `src/lib/zones.test.ts`

**Interfaces:**
- Consumes:
  - `ScalarGrid`, `sampleGrid`, `isolineSegments`, `Segment`, `Bounds` (`contours.ts`)
  - `thresholdSlantRangeM`, `flatGroundRadiusM` (`thresholds.ts`)
- Produces:
  - `interface ZoneRequest { jobId: number; ground: ScalarGrid /* local metres; NaN = unknown */; tx: { xM: number; yM: number; elevationM: number }; rxAglM: number; slant: { sensitivityM: number; requiredM: number; interferenceM: number } }`
  - `const ZONE = { none: 0, weak: 1, acceptable: 2, unknown: 255 } as const`
  - `interface ZoneResult { jobId: number; bounds: Bounds; cols: number; rows: number; cellSizeM: number; classes: Uint8Array; interference: Uint8Array; outlines: { sensitivity: Segment[]; required: Segment[]; interference: Segment[] } }`
    - `classes` and `interference` are per grid node, row-major like `ScalarGrid`.
  - `computeZones(req: ZoneRequest): ZoneResult`

- [ ] **Step 1: Write failing tests**
  - `classifies nodes by separation`: on a flat grid, a node closer than `requiredM` is `acceptable`, one between `requiredM` and `sensitivityM` is `weak`, and one beyond is `none`.
  - `marks the interference area`: `interference[i] === 1` exactly where separation ≤ `interferenceM`.
  - `matches the analytic circle on flat ground`: every `outlines.required` endpoint is within one cell of `flatGroundRadiusM(requiredM, tx.elevationM - rxAglM)` from Tx. Use the slant ranges of `DEFAULT_STATE.inputs` from `thresholdSlantRangeM`.
  - `leaves unknown ground unknown`: NaN ground nodes are `ZONE.unknown` with interference `0`, and no outline passes through them.
  - `handles unavailable slant ranges`: NaN slant gives empty outlines and every class `none`, with no throw.
- [ ] **Step 2: Run** `corepack pnpm vitest run src/lib/zones.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement `computeZones`.** Compute the 3D separation grid `hypot(x−tx.xM, y−tx.yM, ground+rxAglM−tx.elevationM)`, then classify, then take isolines at the three slant ranges.
- [ ] **Step 4: Run** the same command. Expected: 5 passed.
- [ ] **Step 5: Commit** `git add src/lib/zones.* && git commit -m "Add range-zone classification for a transmitter and its zone receiver"`

### Task 5: Active link and generic solver

**Files:**
- Modify: `src/lib/linkGeometry.ts`
- Create: `src/lib/activeLink.ts`
- Test: `src/lib/activeLink.test.ts` (`src/lib/linkGeometry.test.ts` stays unchanged and green)

**Interfaces:**
- Consumes: Tasks 1–3 and `SolveResult` (`linkGeometry.ts`).
- Produces:
  - `solveTxAlongBearing(input: { tx: { xM: number; yM: number; aglM: number }; rx: { xM: number; yM: number; aglM: number }; groundAt: (xM: number, yM: number) => number; flat: boolean }, distanceM: number): SolveResult`
    - It holds the logic now inside `findTxRadialDistances` and `solveTxForDistance`. Both existing functions become thin wrappers over it.
  - `activePair(scenario: MapScenario, groundAt: GroundAt): { tx: Sensor; rx: Sensor } | null`
    - A selected Rx gives its intended Tx.
    - A selected Tx gives its nearest receiver that resolves to it.
    - Otherwise, the first Rx in order and its intended Tx.
    - `null` when no pair exists.
  - `zoneReceiver(scenario: MapScenario, txId: string, groundAt: GroundAt): { rx: Sensor; reason: 'linked' | 'nearest' } | null`
    - `zonesForRxId` is honoured when it names a receiver linked to `txId`.
    - Otherwise, the nearest linked receiver.
    - Otherwise, the nearest receiver (`'nearest'`).
    - `null` with no receivers.
  - `activeInputs(state: AppState, groundAt: GroundAt): LinkInputs` (the pair inputs with its 3D separation, or `state.inputs` when there is no pair)
  - `applyInputEdit<K extends keyof LinkInputs>(state: AppState, key: K, value: LinkInputs[K], groundAt: GroundAt): { ok: true; state: AppState } | { ok: false; reason: string }`
    - Sensor-owned keys map to the active pair's sensors (inverse of `pairInputs`).
    - `txId` and `rxId` rename the sensors.
    - Shared keys write `state.inputs`.
    - `distanceM` moves Tx with `solveTxAlongBearing` in local metres and writes back its lat/lon.

- [ ] **Step 1: Write failing tests**
  - `picks the active pair from the selection`: the three selection cases plus `null`.
  - `chooses the zone receiver`: the picker honoured, linked-nearest, fallback `'nearest'`, and none.
  - `exposes the active pair as calculator inputs`.
  - `writes calculator edits back to sensors and shared settings`: `txGainDbi` changes the Tx sensor; `frequencyGhz` changes `state.inputs`.
  - `moves Tx to a typed separation, keeping Rx fixed`: 1000 m on flat ground gives an `activeInputs(...).distanceM` that is ≈ 1000 to 6 decimal places.
  - `rejects an impossible separation with the solver's reason`.
  - `keeps the plan-view solver behaviour`: run the existing `linkGeometry.test.ts` unchanged.
- [ ] **Step 2: Run** `corepack pnpm vitest run src/lib/activeLink.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Refactor `linkGeometry.ts`, then implement `activeLink.ts`** to the signatures above.
- [ ] **Step 4: Run** `corepack pnpm test`. Expected: all suites pass, including the unchanged `linkGeometry.test.ts` and `rf.test.ts`.
- [ ] **Step 5: Commit** `git add src/lib/linkGeometry.ts src/lib/activeLink.* && git commit -m "Map the selected sensors to the calculator's active link"`

### Task 6: Schema 3, migration and App wiring

**Files:**
- Modify: `src/types.ts` (AppState: `schemaVersion: 3`, `map: MapScenario`, remove `workspace`), `src/data/defaults.ts`, `src/lib/state.ts`, `src/lib/state.test.ts`, `src/App.tsx`
- Delete: `src/components/PlacementWorkspace.tsx`
- Test: `src/lib/state.test.ts`

**Interfaces:**
- Consumes: `Sensor`, `MapScenario`, `createSensor` (Task 3); `offsetLatLon`, `SG_REFERENCE` (Task 1); `activeInputs`, `applyInputEdit` (Task 5).
- Produces:
  - `DEFAULT_STATE.map`: T1 at `offsetLatLon(SG_REFERENCE, 250, 0)` and R1 at `offsetLatLon(SG_REFERENCE, -250, 0)`, AGL 10, `selectedId: null`, `zonesForRxId: 'auto'`, `useTerrainElevation: true`.
  - `normalizeState(saved?: Partial<AppState> | unknown): AppState` (existing name, new schema).
  - `validateImport(raw: unknown): AppState | null` (`null` = reject).
  - `withWorkspace` is removed; `App.tsx` uses `applyInputEdit`.

- [ ] **Step 1: Update `state.test.ts` with failing tests**
  - `migrates a 1.4.0 workspace without changing its result`: a v2 state with `workspace.tx (300,400,agl 12)`, `rx (0,0,agl 10)` and synthetic terrain enabled. After `normalizeState`:
    - there are 2 sensors and `useTerrainElevation === false`,
    - each sensor's `aglM` equals its old total elevation (ground + AGL),
    - `activeInputs(...).distanceM` equals the old `separation3dM(workspace)` to 9 decimal places.
  - `migrates pre-1.4.0 scenarios through flat geometry` (legacy distance 1234.5 m is preserved).
  - `rejects imports with more than six sensors, unknown roles or non-numeric fields` (Review Focus 5): `validateImport` returns `null`.
  - `accepts a valid v3 scenario round trip`.
  - Keep the existing default-state and terrain-number tests, adjusted to the new shape.
- [ ] **Step 2: Run** `corepack pnpm vitest run src/lib/state.test.ts`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement the migration and validation in `state.ts`, and wire `App.tsx`.**
  - The Calculator, sweeps and placement table receive `activeInputs(state, groundAt)`, with `groundAt = () => null` until Task 7 provides the hook.
  - The Calculator's `setInput` and its separation field call `applyInputEdit`.
  - `importJson` uses `validateImport`.
  - Remove the `workspace` nav entry until Task 8 adds `MapWorkspace`.
  - Delete `PlacementWorkspace.tsx`.
- [ ] **Step 4: Run** `corepack pnpm test && corepack pnpm build`. Expected: all tests pass; `tsc -b` and `vite build` succeed.
- [ ] **Step 5: Commit** `git add -A src && git commit -m "Move scenarios to schema 3 sensors with lossless 1.4.0 migration"`

### Task 7: Elevation tiles in the browser and zone worker

**Files:**
- Create: `src/components/map/useElevationTiles.ts`
- Modify: `src/workers/fieldWorker.ts`, `src/components/useFieldWorker.ts` (generalise the request and result types to `ZoneRequest`/`ZoneResult`; remove `computeFields` usage there)

**Interfaces:**
- Consumes: `createGroundSampler`, `ELEVATION_TILE_URL`, `ELEVATION_ZOOM`, `tilePixel`, `ElevationTile` (Task 2); `computeZones` (Task 4).
- Produces:
  - `useElevationTiles(): { groundAt: GroundAt; ensure(points: LatLon[], z?: number): void; version: number; status: 'idle' | 'loading' | 'ready' | 'offline' }`
    - It fetches tiles with `fetch` → `createImageBitmap` → `OffscreenCanvas.getImageData`.
    - It caches tiles by `z/x/y`, bumps `version` when tiles arrive, and sets `status: 'offline'` after any fetch failure.
    - `groundAt` samples at `ELEVATION_ZOOM`.
  - `useZoneWorker(request: Omit<ZoneRequest,'jobId'> | null): { result: ZoneResult | null; refining: boolean }` (the existing hook, renamed and retyped)

- [ ] **Step 1: Build the hook and worker change.** There are no DOM unit tests in this repo (the precedent is ledger ruling "React components have no unit tests"); the pure parts it uses are covered by Tasks 2 and 4.
- [ ] **Step 2: Verify** with `corepack pnpm test && corepack pnpm build`. Expected: green, and the build output lists a `fieldWorker-*.js` chunk.
- [ ] **Step 3: Commit** `git add src/components src/workers && git commit -m "Load Terrarium elevation tiles and compute zones in the worker"`

### Task 8: Map workspace UI (Layout B)

**Files:**
- Create: `src/components/map/MapWorkspace.tsx`, `SensorMap.tsx`, `SensorListCard.tsx`, `SelectedSensorCard.tsx`, `LinkSettingsCard.tsx`
- Modify: `src/App.tsx` (nav `['workspace', RadioTower, 'Link workspace']` → `<MapWorkspace state setState />`; the elevation hook lives in `App` so the Calculator gets the real `groundAt`), `src/styles.css`, `package.json` (add `maplibre-gl` exactly `4.7.1`)

**Interfaces:**
- Consumes: everything above; `StatusBadge`, `statusTone`, `CommitField`, `NumberField`, `Metric` (`src/components/ui.tsx`); `formatFrequency`, `parseFrequency`, `frequencyFromSlider`, `sliderFromFrequency` (`src/lib/viewport.ts`).
- Produces: the user-facing view below. No new library API.

Behaviour to build (from the spec, "Layout B" and "Links on the map"):
- **`SensorMap`:**
  - `maplibregl.Map` with an inline style: the OneMap raster source/layer, Terrarium `raster-dem` plus a `hillshade` layer, and `maxBounds` = the Global Constraints bounds padded by 0.05°. Attribution uses both strings.
  - Sensors are `maplibregl.Marker({ draggable: true })` with a focusable element (`role="button"`, `tabindex=0`, aria-label with name, role and status). Arrow keys move 1 m, Shift+arrow 10 m, via `offsetLatLon`. `dragend` commits.
  - Links are a GeoJSON source: intended links are solid lines in their status token; interference pairs (power ≥ threshold) are dashed `var(--red)`. Unselected lines are dimmed.
  - Zones are an `image` source updated from a canvas painted from `ZoneResult.classes`/`interference` (acceptable green, weak amber, interference red hatch), plus outline lines in the threshold colours.
  - The zone grid covers the current view, at 14 px per cell while dragging and 5 px per cell at rest.
- **`SensorListCard` (top left):** rows show name, a role badge and status (Rx: link status + "N interferers"; Tx: "serves N"). Clicking a row selects it. There is a delete button per row and "+ Sensor" (disabled at 6). A new sensor is placed at the map centre with role `rx` if there is already a transmitter, otherwise `tx`.
- **`SelectedSensorCard` (top right):**
  - name, TX/RX segmented toggle, latitude/longitude `CommitField`s, height above ground, and read-only ground and total elevation ("elevation unavailable" when `null`)
  - the role's fields
  - for Rx: an intended-transmitter `<select>` (`auto (nearest: T2)` plus transmitters)
  - for Tx: a "Zones for" `<select>` when 2+ linked receivers, and "using nearest receiver R2" when the fallback applies
  - results via `receiverSummary` / served lists
  - the legend with the required free-space copy
- **Top bar:** Fit all sensors, zoom ±, "Link settings" toggles `LinkSettingsCard` (frequency slider and text, polarization/obstruction/other losses), the Use terrain elevation switch, and an offline notice when `status === 'offline'`.

- [ ] **Step 1: Add the dependency** with `corepack pnpm add maplibre-gl@4.7.1`. Expected: `package.json` shows `"maplibre-gl": "4.7.1"`.
- [ ] **Step 2: Build the components and CSS.** Import `maplibre-gl/dist/maplibre-gl.css` once in `SensorMap.tsx`.
- [ ] **Step 3: Verify** with `corepack pnpm test && corepack pnpm build`. Expected: green.
- [ ] **Step 4: Browser check** (script outside the repo, as in the 1.4.0 run):
  - Use `playwright-core` with `channel: 'chrome'`. Route `**/onemap.gov.sg/**` to a 256×256 grey PNG and `**/elevation-tiles-prod/**` to a PNG of RGB (128,20,0), which decodes to 20 m.
  - Drive at 1440×900:
    - open Link workspace, and expect 2 markers and no console errors;
    - drag T1, and the R1 status and power update;
    - add a sensor, toggle it to Tx, set R1's intended Tx to it, and the link line moves;
    - select a Tx, and the zone image source updates;
    - toggle terrain off and on, and ground elevation shows 0 then 20.0 m;
    - add sensors until "+ Sensor" is disabled at 6;
    - the Calculator tab shows the active pair.
  - Expected: every assertion passes; screenshots are reviewed by eye.
- [ ] **Step 5: Commit** `git add package.json pnpm-lock.yaml src && git commit -m "Add Singapore map workspace with six TX/RX sensors and range zones"`

### Task 9: Release notes and Guide

**Files:**
- Modify: `package.json` (`"version": "1.5.0"`), `src/App.tsx` (version chips `WEB 1.5.0`, Guide "Link workspace" section rewritten for map, sensors, intended transmitter, zones and limits), `README.md`, `VERSION_HISTORY.txt` (new "Web Version 1.5.0" entry in the existing format, dated the release day)

- [ ] **Step 0: Check the live sources.** Run `curl -sI https://www.onemap.gov.sg/maps/tiles/Grey/15/25843/16261.png` and `curl -sI https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/12916/8130.png`. Expected: both `HTTP/… 200` with `content-type: image/png`. Read OneMap's current API terms and record the outcome in the final report; this is the spec's "Open before release" item, and only the user can accept the terms.
- [ ] **Step 1: Update the copy.** It must state: OneMap and elevation attributions, internet required for the map, free-space only, a shared frequency, at most 6 sensors, and that 1.4.0 scenarios open with terrain elevation off and unchanged results.
- [ ] **Step 2: Verify** with `corepack pnpm test && corepack pnpm build`. Expected: green.
- [ ] **Step 3: Commit** `git add -A package.json README.md VERSION_HISTORY.txt src/App.tsx && git commit -m "Release notes for web 1.5.0 Singapore map workspace"`
