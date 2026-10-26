# Link Workspace v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make terrain drive the link (frequency-dependent diffraction over an AW3D30 path profile), add a terrain-shadowed radial coverage map with free-space range rings, restore the link objective (workspace default + per-receiver override) and the frequency-scaled transmit animation, compact the floating cards, and move every Calculator capability into a Link-budget drawer.

**Architecture:**
- **Pipeline:** a dev-time Node script converts the user's AW3D30 GeoTIFFs into bundled Terrarium tiles under `public/dem/`.
- **Pure modules (`src/lib`, test-first):** path profile, Earth curvature, Bullington diffraction, clearance class, and an incremental radial coverage sweep. They feed `calculateLink` (unchanged) through a new `propagationLossDb` term.
- **UI:** the map, worker and cards from 1.5.0 are extended, not replaced.

**Tech Stack:**
- Existing: React 19, TypeScript 5.8, Vite 6, Vitest 3, maplibre-gl 4.7.1.
- New dev dependencies: `geotiff@2.1.3` (GeoTIFF reading) and `pngjs@7.0.0` (PNG encoding), both used only by the script.

**Spec:** `docs/superpowers/specs/2026-10-26-link-workspace-v2-design.md` (builds on `2026-10-26-singapore-map-workspace-design.md`).

## Global Constraints

- **Engine:** `src/lib/rf.ts` and `src/lib/rf.test.ts` stay unchanged. Terrain loss is applied outside `calculateLink` by adding it to `otherLossDb` in the pair inputs. With model `free-space` the results are identical to web 1.5.0.
- **Propagation model:** scenario field `map.propagationModel: 'free-space' | 'terrain'`. New map scenarios default to `'terrain'`; migrated v3 scenarios get `'free-space'`. The schema becomes `schemaVersion: 4`, with the storage key `friis-rf-planner-v3-state` unchanged.
- **Diffraction:** ITU-R P.526 knife edge:
  - J(ν) = 6.9 + 20·log₁₀(√((ν−0.1)²+1) + ν − 0.1) for ν > −0.78, else 0.
  - Bullington equivalent edge.
  - Effective Earth radius k = 4/3 (R = 6 371 008.8 m).
  - Profile spacing ≤ 30 m, and ≤ 512 samples per path.
- **Clearance class:** `'los'` (60 % F1 clear) | `'fresnel'` (ray clear, 60 % F1 intruded) | `'obstructed'` (ray blocked).
- **Objectives:**
  - Workspace `map.defaultObjective: 'desired' | 'avoidance'` (default `'desired'`).
  - Per-receiver `objective: 'default' | 'desired' | 'avoidance'` (default `'default'`).
  - An avoidance receiver has no intended link.
- **Terrain data:**
  - Path: `public/dem/{z}/{x}/{y}.png` (Terrarium), zoom 10–14, bounds `[103.596, 1.1443, 104.4309, 1.4835]`.
  - Manifest: `public/dem/manifest.json` = `{ source, version, bounds, datum: 'EGM96', zooms, cloudFilledShare }`.
  - Attribution: `©JAXA, ALOS World 3D-30m (AW3D30)`.
- **Licensing:** `Map/` and `public/dem/` stay git-ignored until JAXA redistribution terms are confirmed by the user. `pnpm dem:build` regenerates the tiles locally.
- **Animation:** 100–500 px/s, smoothstep over log₁₀(f) from 1 MHz to 100 GHz (port `signalSpeedPxPerSec`, which still exists in `src/lib/viewport.ts`). It pauses when hidden or offscreen and is static under reduced motion. No RF or terrain work runs in the frame.
- **Card widths:** sensor list ≤ 240 px (collapsible to a 48 px rail), selected-sensor card ≤ 320 px with tabs, Link settings as a popover, and the drawer ≤ 40 % of workspace height (collapsible to a 44 px bar).
- **Carried over from the previous plan:** every colour is a token; no `transition: all`; `:focus-visible` on every control.

## Review Focus

1. **A path entirely over sea** (all ground 0): diffraction 0 and class `'los'` when the antennas clear the Earth bulge. Test in Task 2.
2. **A grazing obstacle (ν ≈ 0) at 433 MHz vs 28 GHz:** about 6 dB at both. The higher frequency gives a larger ν for the same positive clearance deficit. Test in Task 2.
3. **Missing DEM tiles in terrain mode:** the pair is flagged `elevationKnown: false` and its diffraction is `NaN`. The status is not shown as a confident link. Test in Task 3.
4. **A receiver switched to avoidance while another receiver names the same transmitter:** only the switched receiver changes; zones follow the selected receiver. Test in Task 3.
5. **Typing a new frequency during a coverage computation:** the stale job is dropped, the new key computes, and there is no backlog. Covered by the existing `useZoneWorker` jobId logic, extended in Task 5.

---

### Task 1: AW3D30 → bundled Terrarium tiles

**Files:**
- Create: `scripts/build-dem.mjs`, `scripts/dem-lib.mjs`
- Test: `scripts/dem-lib.test.mjs`
- Modify: `package.json` (script `"dem:build": "node scripts/build-dem.mjs Map"`; devDependencies `geotiff`, `pngjs`), `.gitignore` (`Map/`, `public/dem/`), `vite.config.ts` (none needed; `public/` is served as-is)

**Interfaces — produces:**
- `encodeTerrarium(m: number): [r, g, b]`
- `mosaicSample(tiles, lat, lon): number` (bilinear; sea mask → 0)
- `public/dem/manifest.json`

- [ ] **Step 1: Write failing tests**
  - `encodeTerrarium` round-trips with `decodeTerrarium` (`src/lib/elevation.ts`) for −10, 0, 20.5 and 163.
  - `mosaicSample` picks the E103 or E104 tile by longitude, and maps sea mask values to 0.
- [ ] **Step 2: Run** `corepack pnpm vitest run scripts/dem-lib.test.mjs`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement.**
  - Unzip to a temp dir, read `_DSM.tif` and `_MSK.tif` with `geotiff`, and treat MSK sea bits as 0 m.
  - Count cloud-filled pixels inside the bounds.
  - Write tiles for z10–14 that intersect the bounds, plus the manifest.
- [ ] **Step 4: Run** the tests, then `corepack pnpm dem:build`. Expected: PASS, and `manifest.json` lists `source: "ALOS AW3D30 v4 (ALPSMLC30)"` with a numeric `cloudFilledShare`.
- [ ] **Step 5: Point the app at the bundled tiles.** In `src/lib/elevation.ts`, `ELEVATION_TILE_URL = import.meta.env.BASE_URL + 'dem/{z}/{x}/{y}.png'`. The `raster-dem` source in `SensorMap.tsx` uses the same URL, with maxzoom 14 and the attribution above. Run `corepack pnpm test && corepack pnpm build`: green.
- [ ] **Step 6: Commit** the scripts, `package.json`, the lockfile, `.gitignore` and `src/lib/elevation.ts`.

### Task 2: Propagation core

**Files:** create `src/lib/propagation.ts`; test `src/lib/propagation.test.ts`.

**Interfaces — produces:**
- `knifeEdgeLossDb(nu: number): number`
- `fresnelRadiusM(d1M: number, d2M: number, wavelengthM: number): number`
- `interface PathProfile { distancesM: Float64Array; groundM: Float64Array }` (ground already includes the Earth bulge)
- `buildProfile(from: LatLon, to: LatLon, groundAt: GroundAt, spacingM = 30): PathProfile | null` (`null` if any sample is unknown)
- `bullingtonLossDb(profile: PathProfile, txElevM: number, rxElevM: number, frequencyGhz: number): { lossDb: number; clearance: 'los' | 'fresnel' | 'obstructed'; worstIndex: number }`

- [ ] **Step 1: Failing tests**
  - `J(0) ≈ 6.03` (±0.01); `J(−1) = 0`; `J(1) ≈ 13.9` (±0.1); `J(2.4) ≈ 20.7` (±0.2).
  - Fresnel radius at d1 = d2 = 500 m and 5.8 GHz ≈ 3.6 m.
  - A flat-sea 5 km path with 10 m antennas gives class `'los'` and loss 0.
  - A 30 m ridge mid-path between 10 m antennas over 2 km gives loss(28 GHz) > loss(433 MHz) > 6 dB and class `'obstructed'`.
  - A ridge just under the ray but inside 60 % F1 gives `'fresnel'`.
  - The Earth bulge at the 25 km midpoint is ≈ 9.2 m.
  - `buildProfile` returns `null` when `groundAt` returns `null` anywhere.
- [ ] **Step 2: Run** `corepack pnpm vitest run src/lib/propagation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per Global Constraints. Bullington uses the maximum slope from Tx and the maximum slope from Rx, and their intersection is the equivalent edge.
- [ ] **Step 4: Run.** Expected: all pass.
- [ ] **Step 5: Commit.**

### Task 3: Objectives, model setting and pair evaluation

**Files:**
- Modify: `src/types.ts` (`Sensor.objective`; `MapScenario.defaultObjective`, `propagationModel`; `schemaVersion: 4`), `src/data/defaults.ts`, `src/lib/sensors.ts`, `src/lib/activeLink.ts`, `src/lib/state.ts`
- Tests: `sensors.test.ts`, `activeLink.test.ts`, `state.test.ts`

**Interfaces:**
- `effectiveObjective(map: MapScenario, rx: Sensor): 'desired' | 'avoidance'`
- `resolveIntendedTx` returns `null` for avoidance receivers.
- `PairResult` gains `{ propagationLossDb: number; clearance: 'los' | 'fresnel' | 'obstructed' | 'unknown' }`.
- `evaluatePairs` adds the terrain loss to `otherLossDb` when `propagationModel === 'terrain'`.
- `activeInputs` mirrors this; `activeElevationKnown` is unchanged.

- [ ] **Step 1: Failing tests**
  - An avoidance receiver has no intended pair, and all its pairs use `'avoidance'`.
  - `'default'` follows `defaultObjective`.
  - Review Focus 4.
  - The free-space model is byte-identical to 1.5.0: the default 500 m link gives −51.187959957979174.
  - Terrain model plus an obstructing ground stub gives power lower by exactly `propagationLossDb`.
  - Review Focus 3.
  - v3 → v4 migration sets `'free-space'` and `defaultObjective 'desired'`, with results unchanged.
- [ ] **Step 2–4:** red, implement, green (`corepack pnpm test`).
- [ ] **Step 5: Commit.**

### Task 4: Radial coverage sweep

**Files:** create `src/lib/coverage.ts`; test `src/lib/coverage.test.ts`; modify `src/workers/fieldWorker.ts` (message `{ kind: 'zones' | 'coverage' }`) and `src/components/useFieldWorker.ts`.

**Interfaces:**
- `interface CoverageRequest { jobId: number; tx: { lat: number; lon: number; elevationM: number }; rxAglM: number; inputs: LinkInputs; maxRangeM: number; radials: number; stepM: number; ground: { origin: LatLon; grid: ScalarGrid } }`
  - The ground grid comes from the main thread, sampled from the bundled DEM.
- `interface CoverageResult { jobId: number; powerDbm: Float32Array /* radials × steps */; radials: number; steps: number; stepM: number; unknown: Uint8Array }`
- `computeCoverage(req): CoverageResult`
  - Incremental Bullington: running maximum obstruction slope along each radial.
  - Each sample costs O(1).
  - Power = `calculateLink` free-space power at that distance minus the diffraction loss.

- [ ] **Step 1: Failing tests**
  - Flat ground: every sample's power equals `calculateLink` at its 3D distance (±0.01 dB). The sensitivity crossing on each radial lies within one step of `flatGroundRadiusM`.
  - A ridge across one sector: samples behind it are lower than in the same range on open radials. Lower at 28 GHz than at 433 MHz.
  - Unknown ground marks samples `unknown`.
  - 720 × 400 completes in under 300 ms in Vitest (performance guard).
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5: Commit.**

### Task 5: Workspace UI — coverage, rings, objective, animation, compact cards

**Files:**
- Modify: `src/components/map/MapWorkspace.tsx`, `SensorMap.tsx`, `SelectedSensorCard.tsx`, `SensorListCard.tsx`, `LinkSettingsCard.tsx`, `src/styles.css`
- Create: `src/components/map/SignalOverlay.tsx`, `src/components/map/CoverageLegend.tsx`

**Behaviour:**
- **Coverage layer:** replaces the zone image when `propagationModel === 'terrain'`. Polar samples are reprojected into the view raster.
  - Bands follow the zone receiver's effective objective (spec Open question 3); a legend toggle "show all bands" displays both.
  - Unknown samples are hatched grey.
  - With `'free-space'` the 1.5.0 zones remain.
- **Free-space rings:** dashed circles (sensitivity blue, required green, interference red) centred on the zone Tx, with distance labels. They are drawn as GeoJSON circles of 128 vertices and stay visible in both models.
- **Toolbar:** "Default objective" segmented control (Desired / Avoidance) and "Model" select (Terrain diffraction / Free space).
- **Receiver card:** an "Objective" select (Workspace default (X) / Desired / Avoidance). The intended-transmitter select is hidden when the effective objective is avoidance.
- **Link results:** show the clearance class and the diffraction loss.
- **`SignalOverlay`:**
  - A canvas over the map that repaints on map `render`.
  - It projects intended-link endpoints with `map.project` and draws packets at `signalSpeedPxPerSec(frequencyGhz)` in the link's status colour.
  - It follows the reduced-motion, visibility and offscreen rules.
- **Compact cards** per Global Constraints:
  - The sensor list collapses to a rail.
  - The selected-sensor card has tabs Sensor / Link / Coverage.
  - Link settings is a popover.
  - Cards fade to 35 % opacity while a sensor is dragged.
  - A "Hide panels" toolbar toggle clears the map.

- [ ] **Step 1: Build.**
- [ ] **Step 2: Verify** with `corepack pnpm test && corepack pnpm build`: green.
- [ ] **Step 3: Browser drive** (Playwright script, as in 1.5.0):
  - default objective toggle;
  - a receiver override changes statuses;
  - terrain coverage appears;
  - rings visible;
  - packets painted;
  - with reduced motion emulated, no animation frame loop;
  - cards collapse;
  - arrow-key nudge does not pan the map;
  - no console errors besides the existing favicon 404.
- [ ] **Step 4: Commit.**

### Task 6: Link-budget drawer (Calculator merge, phase 1)

**Files:** create `src/components/map/LinkBudgetDrawer.tsx` and `PathProfileChart.tsx`; modify `MapWorkspace.tsx`, `styles.css`.

**Behaviour:**
- **Collapsible bottom drawer** for the active pair. It reproduces every Calculator capability:
  - scenario name and the Tx/Rx names;
  - all inputs (writing back through `applyInputEdit`);
  - FSPL, diffraction loss, total losses, received power in dBm and mW, link and interference margins, wavelength;
  - the objective explanation text;
  - the Rx power meter (port `LinkSchematic`'s meter markup and classes from `App.tsx`).
- **Path-profile chart** (Chart.js, already a dependency): ground, Earth bulge, direct ray, 60 % F1 envelope, and a marker at `worstIndex`.
- **Calculator tab:** gets no new features; it is left in place until phase 3 (spec "Calculator merge").

- [ ] **Step 1: Build.**
- [ ] **Step 2: Verify** green.
- [ ] **Step 3: Browser drive:**
  - every Calculator field exists in the drawer, and editing it changes the map result;
  - the path profile draws for an obstructed link;
  - free-space mode values match the Calculator tab.
- [ ] **Step 4: Commit.**

### Task 7: Release notes, handoff refresh

- [ ] **Version and docs:** set version 1.6.0. Update the Guide (model, objectives, coverage, data source and limits), README, `VERSION_HISTORY.txt` and `docs/HANDOFF.md` (status table, decisions, open items).
- [ ] **Verify:** run `corepack pnpm test && corepack pnpm build`: green.
- [ ] **Commit.**
