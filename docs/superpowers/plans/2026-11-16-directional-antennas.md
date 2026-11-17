# Directional antennas: implementation plan (web 1.12.0)

Design: `docs/superpowers/specs/2026-11-16-directional-antennas-design.md`. Branch: `claude/practical-turing-nywbaj` (from `main` at `4d347ec`, web 1.11.0).

Rules for every task: do not change `src/lib/rf.ts` or `src/App.tsx`; keep all existing tests passing; `corepack pnpm test` and `corepack pnpm build` must pass at the end of each task; follow the existing code style (dense TypeScript, short doc comments).

## Execution and model split

| Task | Agent | Why |
|---|---|---|
| 1. Core model | Sonnet subagent | Types, schema migration and pair maths: moderate, cross-file |
| 2. Fields and layers | Sonnet subagent | Coverage sweep, multi-field, zones, layer wiring: the most intricate |
| 3. UI | Sonnet subagent | Card, marker wedge, drawer metric |
| 4. Docs and version | Haiku subagent | Mechanical edits to known files |
| 5. Browser script | Haiku subagent | Follows existing `scripts/e2e/*.mjs` patterns |
| 6. Review and verification | Opus (lead) | Whole-branch review, tests, build, browser scripts |

Order: 1 → (2 ∥ 3, disjoint files) → (4 ∥ 5) → 6.

## Task 1: core model

Files: `src/types.ts`, new `src/lib/antenna.ts` (+ `antenna.test.ts`), `src/lib/state.ts` (+ tests), `src/lib/sensors.ts` (+ tests).

1. `AntennaPattern` type and `Sensor.antenna`; `AppState.schemaVersion: 8`.
2. `antenna.ts`: `DEFAULT_ANTENNA`, `normAzimuth`, `bearingDeg(from, to)` (via `toLocalM`), `offAxisDeg(azimuth, bearing)` in [0,180], `patternLossDb(antenna, bearingDeg)` (0 for omni), `pairPatternLoss(tx, rx)` → `{ txDb, rxDb, txOffDeg, rxOffDeg, totalDb }`, `isAntennaPattern`.
3. `state.ts`: read/validate/migrate `antenna` (absent → default; invalid → reject sensor); schema 8 everywhere it says 7.
4. `sensors.ts`: `createSensor` gives the default antenna. `pairLinkInputs(map, shared, tx, rx, distanceM, opts = { pattern: true })` adds `pattern.totalDb` to `otherLossDb` only when `opts.pattern` and returns `pattern`. `PairResult.pattern` added; `evaluatePairs` fills it.
5. Tests for each.

## Task 2: fields and layers

Files: `src/lib/coverage.ts`, `src/lib/multiField.ts`, `src/lib/zones.ts` (free-space zones), `src/lib/interferenceLayer.ts`, the coverage/zone request code in `src/components/map/MapWorkspace.tsx`, their tests.

1. `CoverageRequest.patterns?: { source?: AntennaPattern; cell?: AntennaPattern }`; per radial loss `patternLossDb(source, θ) + patternLossDb(cell, θ+180)` subtracted from every step's power.
2. Multi-field sources carry `patterns`; terrain branch passes them to `computeCoverage`; free-space branch applies them per cell; `sourceSignature` includes them.
3. Free-space zones (`zones.ts`, and how MapWorkspace builds the zone request from slant ranges): apply the Tx pattern per cell (equivalent to scaling the slant range by `10^(-loss/20)`); receiver assumed aimed at the Tx.
4. `interferenceSources`: call `pairLinkInputs(…, { pattern: false })`; `patterns = { source: tx.antenna, cell: rx.antenna }`.
5. `placementPlan`: `pairLinkInputs(…, { pattern: false })`; `patterns = { source: rx.antenna, cell: tx.antenna }`.
6. Coverage map request in MapWorkspace: `pattern: false`, `patterns = { source: zoneTx.antenna }`; include antenna fields in the request keys.
7. Tests: radial loss, rotation changes keys, a back-facing sector lowers the interference field behind it by FBR, placement uses both ends.

## Task 3: UI

Files: `src/components/map/SelectedSensorCard.tsx`, `src/components/map/SensorMap.tsx`, `src/components/map/LinkBudgetDrawer.tsx`, `src/styles.css`, `src/components/map/interferenceUi.test.tsx` (or a new UI test).

1. Card: Antenna select (Omni/Sector) with accessible names; Sector fields Azimuth/Beamwidth/Front-to-back; "Aim at" select (other sensors; receiver's desired Tx first) that sets the azimuth via `bearingDeg`.
2. Marker: for Sector, an SVG wedge (3 dB beamwidth, ~34 px radius) inside the marker element, rotated by `azimuth − map bearing`; updates on change and on map rotate. Omni unchanged.
3. Drawer: "Antenna pattern loss" metric with off-axis note; include in total losses (it already is via `otherLossDb` once Task 1 lands; make the breakdown show it separately like polarization).
4. Ring labels say "boresight" for a Sector Tx.
5. Tests: SSR render shows the controls; selecting Sector reveals fields.

## Task 4: docs and version

`package.json` 1.12.0; `VERSION_HISTORY.txt` entry; `README.md` headline; `docs/HANDOFF.md` (1.11.0 now merged via PR #14 and on `main`; 1.12.0 on this branch; schema 8; new decision rows: assistant call on coverage-map receiver assumption); `docs/BACKLOG.md` item 8 state; design spec section 9.

## Task 5: browser script

`scripts/e2e/directional-antennas.mjs` modelled on `scripts/e2e/interference-layer.mjs`.

## Task 6: review and verification (lead)

Full unit suite, build, all browser scripts against `vite preview`, whole-diff review, then commit and push. Hub refresh (meta, decisions D9/D10 answered, log entry). PR only when the user asks.
