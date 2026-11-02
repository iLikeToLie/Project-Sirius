# Interference Avoidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map workspace a dependable tool for someone placing several transmitters who must (a) keep their own receivers free of interference from other transmitters and (b) avoid pushing other receivers over their interference limits.

**Architecture:** A new receiver-level assessment layer (`src/lib/interference.ts`) sits on top of the existing per-pair results from `evaluatePairs`. It adds aggregate interference, a protection margin, and a C/I check, without touching the Friis engine. Later phases add per-pair isolation terms (frequency rejection, polarization mismatch). These enter the link budget through `otherLossDb`, the same way terrain diffraction does today. The last phase adds multi-source map layers computed in the existing field worker.

**Tech stack:** TypeScript, React 19, MapLibre GL, Vitest. No new dependencies.

**Branch:** `feature/interference-avoidance`, created from `main` @ `34140db`. Do not merge or push to `main`.

**Read first:** `docs/HANDOFF.md` (code map), `REPOSITORY_BRIEF.md` (calculation rules to preserve), `src/lib/sensors.ts`, `src/lib/activeLink.ts`, `src/lib/state.ts`.

## Global Constraints

- **`src/lib/rf.ts` is not modified.** `git diff main -- src/lib/rf.ts` must be empty at every commit. Its `ScreeningStatus` results stay the raw single-link status. New statuses are produced by the new assessment layer.
- **Calculator tab (`src/App.tsx`) is out of scope.** It keeps one link, `rf.ts` statuses and no protection margin.
- **Parity:** for a scenario with no interferer pairs (e.g. the default one Tx + one Rx), every received power, margin and status is identical to `main`. With all sensors on the default frequency and the same polarization, Phase 3 isolation is exactly 0 dB, so results equal those at the end of Phase 2.
- **Accepted behaviour changes** (Gabriel, 2 Nov): with the default 3 dB protection margin, interferers within 3 dB under a threshold now read **Marginal interference**. Avoidance receivers are judged on **aggregate** interference by default.
- **Schema 6** is introduced in Task 1 and extended in Tasks 8 and 10. Every new field is optional when read and takes its default when missing, so schema 5 files (web 1.7.0–1.8.0) and older load unchanged. There is no release between phases, so the whole branch ships as one schema 6.
- **Unknown elevation:** a pair with `elevationKnown === false` is never summed into aggregate interference or used as a confident limit. Results that leave such pairs out say so ("N paths unknown").
- No API keys and no new network calls. Keep the existing `localStorage` key.
- Use the repo's commands: `corepack pnpm test`, `corepack pnpm build` (runs `tsc -b`). Add a Vitest test for each new pure function before the UI that uses it (TDD).

## Decisions (agreed 2 Nov)

1. **Aggregate interference** is a scenario setting `aggregateInterference: 'objective' | 'always' | 'never'`, default `'objective'`. `'objective'` means on for receivers whose effective objective is avoidance and off for desired receivers. When aggregate is off, a receiver is judged on its worst single interferer, as today.
2. **Protection margin:** a scenario-wide field, default **3 dB**, editable by the user (≥ 0). Each receiver can override it (`protectionMarginDb: 'default' | number`), mirroring `objective: 'default'`.
3. **C/I check on desired links:** each receiver has `requiredCiDb` (default 10 dB, ≥ 0). The interference power it compares against follows decision 1 (aggregate or worst single).
4. **Frequency rejection models:** both are built. A scenario toggle `rejectionModel: 'simple' | 'mask'` (default `'simple'`) switches between them. Each receiver stores both its single ACR value and its stepped mask, so toggling never loses values.
5. **Polarization:** per-sensor polarization with an adjustable cross-polar discrimination (XPD), delivered in Phase 3.
6. **Directional antennas:** not in this plan. Recorded under *Future* in `docs/BACKLOG.md`.

## Shared definitions

These formulas are used across tasks. Implement them once.

- `sumDbm(powers)`: `10·log10(Σ 10^(p/10))`. Returns `-Infinity` for an empty list. Ignores non-finite values.
- For receiver `r`: `T = r.interferenceThresholdDbm`, `M` = effective protection margin, `L = T − M` (the protected limit).
- Interferer pairs of `r`: pairs with `rxId === r.id && !intended`. For an avoidance receiver that is every transmitter.
- Effective interference `I`: `sumDbm` of known interferer powers when aggregate applies, else the maximum single known interferer power. `-Infinity` when there are none.
- Interference status: `I ≥ T` → `'Possible interference'`; `L < I < T` → `'Marginal interference'`; `I ≤ L` → `'Below interference threshold'`. Sitting exactly on the protected limit counts as safe, so a transmitter set to its reported max power (Task 4) reads Below.
- Single-pair verdict (map lines, matrix cells) applies the same rule to that pair's own power.

---

## Phase 1: Engine correctness

### Task 1: Schema 6 fields and settings

**Files:** `src/types.ts`, `src/lib/state.ts`, `src/lib/state.test.ts`, `src/data/defaults.ts`, `src/lib/sensors.ts` (`createSensor`)

- [x] Add to `ScreeningStatus`: `'Marginal interference'` and `'Interfered link'`.
- [x] Add to `Sensor`: `protectionMarginDb: 'default' | number` (default `'default'`) and `requiredCiDb: number` (default `10`).
- [x] Add to `MapScenario`: `protectionMarginDb: number` (default `3`) and `aggregateInterference: 'objective' | 'always' | 'never'` (default `'objective'`).
- [x] Bump `schemaVersion` to `6` in `AppState` and `normalizeState`.
- [x] Update `readSensor` and `readMap`. A missing field takes its default. A present but invalid field (a negative number, an unknown enum value) rejects that sensor or map, matching the current strict style.
- [x] Update `createSensor` and `mapForPlacements` to set the defaults.
- [x] Tests: a schema 5 fixture loads with the defaults. A saved schema 6 file round-trips. A negative `requiredCiDb` or margin is rejected. An unknown `aggregateInterference` is rejected.
- [x] Commit: `Add schema 6 interference settings`.

Verified Task 1: 171 unit tests pass; `corepack pnpm build` passes. Migration, custom settings (including zero), sensor defaults, and invalid input rejection were tested RED then GREEN. `git diff main -- src/lib/rf.ts` is empty. The settings are stored only; assessment behavior starts in Task 2.

### Task 2: Receiver assessment (aggregate, margin, C/I)

Completed: receiver assessment and worst assessed link selection implemented in `src/lib/interference.ts`; severity updated in `sensors.ts`. All named cases plus numeric stability, contributor shares, no-interferer parity, invalid pairs, and receiver isolation covered by 16 new tests. Full suite: 187/187; production build passes; `rf.ts` unchanged. Commit: `Assess receivers for aggregate interference, margin and C/I`.

**Files:** new `src/lib/interference.ts`, new `src/lib/interference.test.ts`

- [ ] Implement:
  ```ts
  export const effectiveMarginDb = (map: MapScenario, rx: Sensor) => number;
  export const usesAggregate = (map: MapScenario, rx: Sensor) => boolean; // per decision 1
  export function sumDbm(powers: number[]): number;
  export function pairVerdict(p: PairResult, rx: Sensor, marginDb: number): 'Possible interference' | 'Marginal interference' | 'Below interference threshold' | 'Invalid input';
  export interface Contributor { txId: string; powerDbm: number; share: number } // share of total mW, 0..1
  export interface LinkAssessment { txId: string; status: ScreeningStatus; ciDb: number } // ciDb = C − I, Infinity when I = -Infinity
  export interface ReceiverAssessment {
    rxId: string; aggregate: boolean; thresholdDbm: number; marginDb: number; limitDbm: number;
    interferenceDbm: number; status: 'Possible interference' | 'Marginal interference' | 'Below interference threshold';
    contributors: Contributor[];   // known interferers, strongest first
    unknownPaths: number;          // interferer pairs left out for unknown elevation
    links: LinkAssessment[];       // desired links, same order as receiverSummary().links
  }
  export function assessReceiver(map: MapScenario, rx: Sensor, pairs: PairResult[]): ReceiverAssessment;
  export function assessAll(map: MapScenario, pairs: PairResult[]): Map<string, ReceiverAssessment>;
  ```
- [ ] C/I rule: a desired link whose `rf.ts` status is `'Acceptable link'` or `'Weak link'` becomes `'Interfered link'` when `C − I < rx.requiredCiDb`. `'No link'` and `'Invalid input'` are left as they are.
- [ ] In `sensors.ts`, update `worstLink` severity: `'No link'` 4, `'Interfered link'` 3, `'Weak link'` 2, `'Invalid input'` 1. It must read the assessed status: either accept `LinkAssessment` statuses, or add `worstAssessedLink(assessment, links)`. Keep the existing tests passing.
- [ ] Tests (each one a named case):
  - Three interferers at −67 dBm, T = −65, M = 3, avoidance receiver → aggregate −62.23 dBm → `'Possible interference'`.
  - Same receiver with `aggregateInterference: 'never'` → I = −67 → `'Marginal interference'`.
  - Same three interferers at a desired receiver with `'objective'` → worst single.
  - With T = −65 and M = 3 (L = −68): an interferer at −68 → `'Below interference threshold'`. At −67.9 → `'Marginal interference'`. At −65 → `'Possible interference'`. The boundaries are as in *Shared definitions*.
  - C/I: C = −60, I = −68, required 10 → `'Interfered link'`. Required 8 → unchanged.
  - An unknown-elevation interferer is left out of the sum and counted in `unknownPaths`.
  - A per-receiver margin override beats the scenario margin.
- [ ] Commit: `Assess receivers for aggregate interference, margin and C/I`.

### Task 3: Use the assessment in the workspace UI

Completed: memoised receiver assessments drive map markers/lines, sensor summaries, desired-link badges, receiver interference details, and the drawer. Added validated scenario/receiver settings, protected-limit markers and aggregate meters. Verified 192 unit tests, production build, the new interference-workspace browser checks, and existing multi-link and link-budget-drawer browser regressions. RF engine and Calculator source unchanged.

**Files:** `src/components/ui.tsx`, `src/components/map/MapWorkspace.tsx`, `SensorListCard.tsx`, `SelectedSensorCard.tsx`, `LinkSettingsCard.tsx`, `RxMeterStack.tsx`, `LinkBudgetDrawer.tsx`, `src/styles.css`

- [x] `statusTone`: `'Marginal interference'` → `'warning'`, `'Interfered link'` → `'danger'`.
- [x] `MapWorkspace`: compute `assessments = assessAll(liveMap, pairs)` once (memoised) and pass it down.
  - Receiver tones use the assessment status and the worst assessed link.
  - Interference lines are drawn for pairs whose `pairVerdict` is Possible or Marginal. When a receiver's assessment is Possible or Marginal under aggregate, lines are also drawn for every contributor with `share ≥ 0.1`. Line tone comes from the verdict.
- [x] `SensorListCard.sensorStatus`: driven by the assessment. Examples: `"OK, marginal"`, `"Interfered"`, `"2 interferers (aggregate)"`.
- [x] `SelectedSensorCard`, receiver Link tab:
  - Show effective I with "aggregate of N" or "worst single".
  - List contributors with their share percentage.
  - Show the limit `T − M` and each link's C/I against its requirement.
  - Add fields: Required C/I (dB) and Protection margin. The margin field has a "Use scenario (3 dB)" checkbox that writes `'default'`.
  - Show the `unknownPaths` note when it is above 0.
- [x] `LinkSettingsCard`: add an **Interference** section with Protection margin (dB, ≥ 0) and an Aggregate interference select ("Avoidance receivers only", "All receivers", "Off"). It needs `map` and `setMap` props, so update the props and the call site. Change the card note to cover the scenario-wide interference settings.
- [x] `RxMeterStack`: for the avoidance meter, add a marker at `T − M` (amber, "Protected limit") beside the threshold marker. When aggregate applies, add a row "Total interference" showing `interferenceDbm`.
- [x] `LinkBudgetDrawer`: the status badge for an avoidance pair uses `pairVerdict`. Add a Metric "Protected margin" = `L − P`.
- [x] Commit: `Show aggregate interference, margin and C/I in the workspace`.

### Task 4: Transmitter power range

Completed: power bounds account for protected thresholds, C/I requirements, aggregate remaining allowance, and served-link minima. The transmitter Link tab identifies the limiting receiver and can set a finite feasible maximum rounded down to 0.1 dBm. Unknown paths and infeasible bounds disable the action. Verified 202 unit tests, production build, and the interference-workspace Chrome checks including actual power updates and disabled actions. Terrain diffraction boundary tested with real pair evaluation.

**Files:** `src/lib/interference.ts` (+ tests), `SelectedSensorCard.tsx`

- [x] Implement `transmitterPowerRange(map, txId, pairs): { maxDbm: number; limitedBy: string | null; limitKind: 'threshold' | 'ci' | null; minDbm: number | null; minFor: string | null; unknownPaths: number }`.
  - **Victims** are receivers `r` for which `txId` is not desired. Let `P_t` = power from t at r, and `others` = `sumDbm` of r's other known interferers (aggregate on) or nothing (aggregate off).
  - **Threshold allowance:** `L` with aggregate off. With aggregate on it is `10·log10(10^(L/10) − 10^(others/10))`, or `-Infinity` when `others ≥ L` (already exceeded by other transmitters).
  - **C/I allowance** (desired receivers with known links): `C_min − requiredCiDb`. With aggregate on, subtract `others` the same way.
  - `headroom_r = min(allowances) − P_t`. `maxDbm = tx.powerDbm + min_r headroom_r`. `limitedBy` = the binding receiver, and `limitKind` says which allowance bound it.
  - **Served receivers** (t is desired): `minDbm = tx.powerDbm + max_s (S_s + F_s − P_t,s)`, so every served link stays Acceptable.
  - No victims gives `maxDbm = Infinity`. No served receivers gives `minDbm = null`.
- [x] Tests:
  - Single victim. `maxDbm` equals current power + `(L − P)`. Setting the Tx to `maxDbm` gives `'Below interference threshold'`, and `maxDbm + 0.01` gives `'Marginal interference'`.
  - Aggregate case where others already exceed `L` → `-Infinity`, with a reason.
  - `minDbm > maxDbm` is reported. The UI shows "No power level satisfies both; move or retune".
  - Power scales linearly in dB with terrain loss present (diffraction does not depend on power).
- [x] UI: Tx card Link tab shows "Power range: −3.2 to 14.6 dBm" and "Limited by R3 (protected limit)", with a button "Set to max" that writes `powerDbm = floor(maxDbm·10)/10`.
- [x] Commit: `Show each transmitter's allowed power range`.

---

## Phase 2: Many sensors, actionable results

### Task 5: Interference matrix

Completed: accessible Tx × Rx matrix with remembered drawer tabs, pair margins, C/I warnings, receiver totals, unknown-path notes and pinned click-through. Verified 209 unit tests, production build, matrix browser interactions and existing drawer regressions.

**Files:** new `src/components/map/InterferenceMatrix.tsx`, `LinkBudgetDrawer.tsx`, `src/styles.css`

- [x] Add two views to the drawer, "Link budget" (today's body) and "Matrix", with a `role="tablist"` like the sensor card. Remember the chosen view with `usePref('drawerView', …)`.
- [x] Grid: rows are transmitters, columns are receivers.
  - Desired cell: link margin `P − (S + F)` in dB, toned by the assessed link status ("C/I" suffix when Interfered).
  - Interferer cell: protected margin `L − P` in dB, toned by `pairVerdict`.
  - Unknown elevation: "—" with a tooltip.
  - Column footer: receiver assessment status and aggregate I.
- [x] Clicking a cell selects the receiver and pins the pair (`onPin({ rxId, txId })`), so the Link budget view shows it.
- [x] Accessible: a real `<table>`, with each cell's `aria-label` giving the full sentence.
- [x] Commit: `Add Tx × Rx interference matrix to the drawer`.

### Task 6: Fix suggestions

Completed: receiver-local power and distance advice for protected-limit and C/I violations, shown below receiver violations and in matrix tooltips. Aggregate residual power, exhausted allowances, incomplete predictions and conservative displayed rounding are covered. Verified 223 unit tests, production build and Chrome interference-workspace regressions.

**Files:** `src/lib/interference.ts` (+ tests), `SelectedSensorCard.tsx`, `InterferenceMatrix.tsx`

- [x] Implement `mitigations(map, assessment, pairs): Mitigation[]`, where `Mitigation = { kind: 'power' | 'distance' | 'frequency' | 'polarization'; txId: string; deltaDb: number; text: string; estimate: boolean }`.
  - **Excess:** `I − L` for an interference violation. For an Interfered link it is `requiredCiDb − ciDb`.
  - **Power:** for the strongest contributor `c`, the reduction needed so that I ≤ L. With aggregate on, `P_c − 10·log10(10^(L/10) − 10^(others_c/10))`. If `others_c ≥ L`, the text says reducing c alone cannot fix it and names the next contributor. Without aggregate, the reduction is `P_c − L`.
  - **Distance:** `d_new = d · 10^(reduction/20)`. In terrain mode set `estimate: true` and add "free-space estimate; terrain may differ".
  - Leave `'frequency'` and `'polarization'` as stubs that return nothing until Task 11.
- [x] Tests: applying the suggested power reduction puts I exactly at L (status Below). The distance doubles for 6.02 dB. The aggregate edge case works where others alone exceed L.
- [x] UI: under a violation in the receiver card, list up to three suggestions. The matrix cell tooltip shows the first one.
- [x] Commit: `Suggest the smallest change that clears each violation`.

### Task 7: Raise the sensor cap

**Files:** `src/lib/sensors.ts`, `SensorListCard.tsx`, `src/lib/sensors.test.ts`, `src/lib/state.test.ts`

- [x] `MAX_SENSORS = 12`. Replace the "Six sensors placed" text with `` `${MAX_SENSORS} sensors placed` ``.
- [x] Measure `evaluatePairs` in terrain mode with 6 Tx × 6 Rx, using a synthetic `groundAt`, with a small script under `scripts/`. Record the timing in the review doc. If it exceeds 50 ms per call, memoise `pairPropagation` per pair key (tx lat/lon/agl, rx lat/lon/agl, frequency, model, terrain flag, elevation version).
- [x] Check that the sensor list and matrix stay usable at 12 sensors (scrolling, no layout overflow) with `scripts/e2e/workspace-layout.mjs` or a new check.
- [x] Commit: `Allow up to 12 sensors`.

---

## Phase 3: Frequency planning and polarization

### Task 8: Per-sensor channel and frequency rejection

**Files:** `src/types.ts`, `src/lib/state.ts` (+ tests), new `src/lib/isolation.ts` (+ tests), `src/lib/sensors.ts`, `src/lib/activeLink.ts`, `MapWorkspace.tsx`, `LinkBudgetDrawer.tsx`, `SelectedSensorCard.tsx`, `LinkSettingsCard.tsx`

- [x] Schema 6 additions:
  - `Sensor.frequencyGhz: 'default' | number` (default `'default'`, a number must be > 0).
  - `Sensor.bandwidthMhz: number` (default `20`, > 0).
  - `Sensor.acrDb: number` (default `30`, ≥ 0).
  - `Sensor.rejectionMask: { offsetMhz: number; rejectionDb: number }[]`, default `[{20,30},{40,45},{60,60}]`. It needs 1–4 steps, offsets > 0 and strictly ascending, rejections ≥ 0 and non-decreasing.
  - `MapScenario.rejectionModel: 'simple' | 'mask'` (default `'simple'`).
- [x] `isolation.ts`:
  ```ts
  export const centreMhz = (s: Sensor, shared: LinkInputs) => 1000 * (s.frequencyGhz === 'default' ? shared.frequencyGhz : s.frequencyGhz);
  export function frequencyRejectionDb(tx: {fMhz:number;bwMhz:number}, rx: {fMhz:number;bwMhz:number;acrDb:number;mask:{offsetMhz:number;rejectionDb:number}[]}, model: 'simple'|'mask'): number;
  ```
  - `overlap = max(0, min(fT+bwT/2, fR+bwR/2) − max(fT−bwT/2, fR−bwR/2))`.
  - If `overlap > 0`: `−10·log10(min(1, overlap / bwT))`, which is 0 dB co-channel. Out-of-band leakage from the non-overlapping part is ignored; note this approximation in the UI help text.
  - If `overlap = 0`, the simple model returns `acrDb`. The mask model takes `Δ = |fT − fR|` and returns the rejection of the last step with `offsetMhz ≤ Δ`, or the first step's rejection when Δ is below every offset.
- [x] In `sensors.ts`, add `pairLinkInputs(map, shared, tx, rx, distanceM): { inputs: LinkInputs; rejectionDb: number; polarizationDb: number }`.
  - It wraps `pairInputs`, sets `inputs.frequencyGhz` to the **transmitter's** centre frequency, and adds `rejectionDb` (and later `polarizationDb`) to `otherLossDb`.
  - Replace every `pairInputs` call site with it: `evaluatePairs`, `activeInputs`, `LinkBudgetDrawer` (line 43), `MapWorkspace` zone and coverage requests (lines 148, 180).
  - `pairPropagation` uses `inputs.frequencyGhz` from the same result.
  - Add `rejectionDb` and `polarizationDb` to `PairResult`.
- [x] Drawer frequency edit: if the active Tx has its own frequency, `applyInputEdit('frequencyGhz')` writes to the Tx. Otherwise it writes to the shared default, as today. Add a test in `activeLink.test.ts`.
- [x] UI:
  - Sensor card "Channel" fields: frequency (with "Use scenario default"), bandwidth, and for receivers the ACR and mask steps (editable list of 1–4 rows).
  - The mask rows show only when `rejectionModel === 'mask'`, and the ACR only when `'simple'`. Both values are kept either way.
  - Add a Rejection model toggle to `LinkSettingsCard` and relabel the frequency control "Default frequency".
  - The drawer shows "Frequency rejection X dB" when it is above 0.
  - A desired Tx on another channel shows "Off-channel for R1 (−X dB)".
- [x] Tests:
  - Co-channel gives 0 dB.
  - Half overlap of equal bandwidths gives 3.01 dB.
  - Narrow Tx fully inside a wide Rx gives 0 dB.
  - Adjacent with the simple model gives `acrDb`.
  - The mask lookup at, between and beyond steps.
  - Switching the model keeps both stored values.
  - Parity: the default scenario with all sensors on `'default'` gives the same powers as before.
- [x] Commit: `Add per-sensor channels with simple and mask rejection models`.

### Task 9: Threshold from noise floor

**Files:** `src/lib/isolation.ts` (+ tests), `SelectedSensorCard.tsx`

- [x] `noiseFloorDbm(bandwidthMhz, noiseFigureDb) = −174 + 10·log10(bandwidthMhz·1e6) + noiseFigureDb`.
- [x] Receiver card: a collapsible "Derive from noise floor" section with Noise figure (default 6 dB) and I/N (default −6 dB) as local UI state, not saved. It shows N and the derived threshold, and a button "Use as interference threshold" writes `interferenceThresholdDbm = N + I/N`.
- [x] Test: 20 MHz, NF 6 → −95.0 dBm. Threshold with I/N −6 → −101.0 dBm.
- [x] Commit: `Derive interference threshold from the noise floor`.

### Task 10: Polarization per sensor

**Files:** `src/types.ts`, `src/lib/state.ts` (+ tests), `src/lib/isolation.ts` (+ tests), `src/lib/sensors.ts`, `SelectedSensorCard.tsx`, `LinkSettingsCard.tsx`, `LinkBudgetDrawer.tsx`

- [x] Schema 6 additions: `Sensor.polarization: 'V' | 'H' | 'RHCP' | 'LHCP'` (default `'V'`) and `MapScenario.crossPolarDiscriminationDb: number` (default `15`, ≥ 0).
- [x] `polarizationMismatchDb(a, b, xpdDb)`: same → 0. V↔H → xpd. RHCP↔LHCP → xpd. Linear↔circular → 3.0103 (`10·log10 2`).
- [x] `pairLinkInputs` adds it to `otherLossDb` and reports `polarizationDb`.
- [x] The existing shared Polarization field stays as an extra loss on every pair. Change its help text to say the per-sensor mismatch is added on top. Add the XPD field to the Interference section of `LinkSettingsCard`, with help text saying XPD falls in cluttered urban paths and 15 dB is a cautious default.
- [x] Tests: the mismatch table, parity with every sensor at `'V'`, and a V Tx to H Rx lowering received power by exactly XPD.
- [x] Commit: `Add per-sensor polarization with cross-polar discrimination`.

### Task 11: Isolation-based fix suggestions

**Files:** `src/lib/interference.ts` (+ tests)

- [x] `'polarization'`: if the excess ≤ XPD and contributor and victim have the same linear (or same circular) polarization, suggest switching the contributor to the orthogonal one.
- [x] `'frequency'`: the smallest centre offset that clears the excess.
  - Simple model: if `acrDb ≥ excess`, the offset is `(bwT + bwR)/2`, otherwise none.
  - Mask model: the first step with `rejectionDb ≥ excess`, offset `max(step.offsetMhz, (bwT+bwR)/2)`.
- [x] Tests for both models and the no-solution case.
- [x] Commit: `Suggest frequency offsets and cross-polarization`.

---

## Phase 4: Multi-transmitter map layers

### Task 12: Multi-source field computation

**Files:** new `src/lib/multiField.ts` (+ tests), `src/lib/coverage.ts`, `src/workers/fieldWorker.ts`, `src/components/useFieldWorker.ts`

- [x] Move the polar-to-raster reprojection out of `coverageZones` into `reprojectPowers(out: CoverageResult, source: {xM,yM}, raster: ScalarGrid): Float64Array`. `coverageZones` keeps its output exactly; its existing tests must pass unchanged.
- [x] `computeMultiField(req: { jobId; raster: ScalarGrid; rayGround: ScalarGrid; origin: LatLon; mode: 'free-space' | 'terrain'; rxAglM: number; sources: { lat; lon; elevationM; inputs: LinkInputs }[]; radials: number }): { jobId; powers: Float32Array[] }`. It returns one raster of received power per source, so combining results stays on the main thread and toggles need no recompute.
  - Free space: `basePower − 20·log10(3D distance)` per cell, with the same base as `computeCoverage`.
  - Terrain: `computeCoverage` per source, then `reprojectPowers`.
  - At most 12 sources. 360 radials, or 180 while dragging.
- [x] Add worker kind `'multi'` and a `useMultiFieldWorker(request, key)` hook following `useCoverageWorker`.
- [x] Tests: a single-source free-space field matches `computeZones`' separation-derived power within 0.01 dB, and source order is kept.
- [x] Commit: `Compute multi-source power fields in the worker`.

### Task 13: Total interference layer

**Files:** `MapWorkspace.tsx`, `CoverageLegend.tsx`, `SensorMap.tsx`, `src/styles.css`

- [x] Layer selector in `CoverageLegend`: **Range** (today's behaviour), **Interference** and **Placement** (Task 14). Remember it with `usePref('coverageLayer', 'range', oneOf(...))`. Hide the range rings when the layer is not Range.
- [x] **Interference:**
  - Reference receiver R is the selected receiver, else the zone receiver, else the first receiver.
  - Sources are every Tx that R does not desire, each with inputs `pairLinkInputs(map, shared, tx, R, 1)` and `rxAglM = R.aglM`.
  - Per cell, combine with `sumDbm` when `usesAggregate(map, R)`, else take the maximum.
  - Bands: ≥ T red, [L, T) amber, below L clear. The Gradient style uses `signalColour` with the avoidance `signalRange`.
  - Legend: "Total interference at R1's settings (aggregate)".
- [x] Commit: `Add total interference map layer`.

### Task 14: Safe placement layer for a transmitter

**Files:** `MapWorkspace.tsx`, `CoverageLegend.tsx`, `SensorMap.tsx`, `src/lib/interference.ts` (+ tests)

- [x] Available when a transmitter t is selected.
  - **Victims V:** receivers that do not desire t. **Served S:** receivers t serves.
  - Each source is a receiver r ∈ V ∪ S at its own position and elevation (ground + agl), with `rxAglM = t.aglM` and inputs `pairLinkInputs(map, shared, t, r, 1)`. Path loss is treated as reciprocal: diffraction is computed from the receiver side, which is an approximation. Say so in the legend help text.
- [x] Per-victim allowance is computed once per victim and does not depend on the cell. It is Task 4's threshold and C/I allowances with t's own contribution left out. Compute it with margin (`L`) and without (`T`).
- [x] Per-cell class (pure function `placementClass(...)`, unit-tested):
  - **Unsafe:** any victim exceeds its no-margin allowance.
  - **Marginal:** within the margin.
  - **Safe:** every victim within its allowance.
  - **Recommended:** Safe, and every served receiver gets ≥ S + F there.
  - **Unknown:** any source ray unknown.
- [x] Colours: Recommended green, Safe light green, Marginal amber, Unsafe red, Unknown the existing hatching. Legend lists the victims and served receivers used.
- [x] Commit: `Add safe placement map layer for transmitters`.

---

## Phase 5: Release and verification

### Task 15: Documentation and version

- [x] `package.json` → `1.9.0`. Add a `VERSION_HISTORY.txt` entry for web 1.9.0: functions, key changes, the accepted behaviour changes from *Global Constraints*, and limitations (reciprocity approximation, in-band-only overlap model, XPD as a fixed value, the Calculator tab unchanged).
- [x] Update `README.md` features, `docs/HANDOFF.md` (code map: `interference.ts`, `isolation.ts`, `multiField.ts`; tests count; branch state) and `docs/BACKLOG.md` (mark items 7a–7k done).
- [x] Commit: `Release notes for web 1.9.0`.

Verified Task 15: 295/295 tests across 30 files pass; production build passes without warnings. RF engine unchanged from main; no source edits in this task. App.tsx version labels and guide remain at 1.8.0 under the explicit scope constraint, recorded in the handoff and release notes. Task 16 remains pending; no push or merge performed.

### Task 16: Whole-branch review

- [ ] `corepack pnpm test` and `corepack pnpm build` pass with no warnings. `git diff main -- src/lib/rf.ts` is empty.
- [ ] Add `scripts/e2e/interference-avoidance.mjs` following the existing e2e scripts, covering the Review Focus cases below in headless Chromium.
- [ ] Write `docs/INTERFERENCE_AVOIDANCE_REVIEW.md` (pattern: `docs/MULTI_LINK_REVIEW.md`), with commands, results per Review Focus item, the Task 7 timing, and screenshots paths.
- [ ] Do not merge or push to `main`.

## Review Focus

1. The default scenario (one Tx, one Rx, desired) gives the same powers and statuses as `main`.
2. Avoidance receiver with three interferers at −67 dBm, T −65, M 3 → Possible interference (aggregate −62.2 dBm). With aggregate set to Off → Marginal interference.
3. A desired receiver with the same interferers under the default setting is judged on the worst single interferer.
4. A desired link with C/I below its requirement reads Interfered link in the card, list, matrix and map tone.
5. A schema 5 file from web 1.8.0 opens with the new defaults. Only interference statuses within 3 dB of a threshold change (to Marginal).
6. With every sensor on the default frequency and V polarization, Phase 3 changes no received power.
7. Setting a transmitter to its reported max power puts the binding receiver exactly at its protected limit.
8. A pair with unknown elevation is left out of aggregate sums and flagged, never shown as a confident value.
9. The rejection model toggle keeps both ACR and mask values on every receiver.
10. With 12 sensors in terrain mode the workspace stays responsive while dragging. Record the timing.
11. The Placement layer marks the transmitter's current position consistently with its card: if the card says it interferes, its cell is Marginal or Unsafe.

## Phase routing

| Phase | Tasks | Effort | Verify before moving on | Escalate to Gabriel when |
| --- | --- | --- | --- | --- |
| 1. Engine correctness | 1–4 | high | `pnpm test -- interference state sensors`; Review Focus 1–5, 7 | Parity case 1 breaks, or the aggregate/margin rules need a different interpretation |
| 2. Many sensors | 5–7 | medium | `pnpm test && pnpm build`; matrix click-through; Task 7 timing | Terrain evaluation with 12 sensors is too slow even with memoisation |
| 3. Frequency and polarization | 8–11 | high | `pnpm test -- isolation`; Review Focus 6, 9 | Any `pairInputs` call site cannot move to `pairLinkInputs` cleanly |
| 4. Map layers | 12–14 | high | `coverageZones` tests unchanged; Review Focus 11 | Worker time per update is over ~1 s at 12 sources |
| 5. Release and review | 15–16 | medium | Every Review Focus item checked by hand | Any item fails |

Run the phases in order: each depends on the one before. Each task ends with its own commit.

## Future (not in this plan)

- **Directional antennas:** azimuth, beamwidth and front-to-back ratio per sensor. Pattern loss would apply per pair and per coverage radial. The web app deliberately left out the workbook v4 antenna patterns, so this needs its own design pass. See `docs/BACKLOG.md`.
