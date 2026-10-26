# Codex Brief: Link Workspace v1.6.0 (Terrain Diffraction & Calculator Merge Phase 1)

## Execution Settings

- **Model:** claude-opus (Codex best practices assumed)
- **Branch:** `feature/link-workspace-terrain`
- **Approach:** Execute the 7-task implementation plan using superpowers:executing-plans **natively** (not as a subagent).
- **Verification:** Use code-review and test-driven development skills after each task. Commit atomically per task.
- **No changes to:** `src/lib/rf.ts` (propagation engine stays as-is).

## High-Level Goal

v1.5.0 (Singapore map, 6 sensors, free-space zones) is done. **v1.6.0 adds:**
1. **Terrain diffraction** (ITU-R P.526 Bullington) over user-provided AW3D30 DEM tiles
2. **Radial coverage map** (terrain-shadowed, frequency-aware)
3. **Objectives system** (workspace default + per-receiver override)
4. **Link-budget drawer** (Calculator merge phase 1)
5. **Compact cards** & frequency-scaled signal animation

**Schema:** v3 → v4. **Propagation model:** free-space (default, byte-identical to v1.5.0) or terrain (new).

## Before You Start

**Read these in order:**
1. `REPOSITORY_BRIEF.md` — RF maths baseline
2. `docs/superpowers/specs/2026-10-26-singapore-map-workspace-design.md` — v1.5.0 (for context)
3. `docs/superpowers/specs/2026-10-26-link-workspace-v2-design.md` — **the detailed v1.6.0 spec** (80+ lines; critical)
4. `docs/superpowers/plans/2026-10-26-link-workspace-v2.md` — **this is the execution plan** (step-by-step; use it directly)

**Prerequisites:**
- Node ≥ 22, pnpm (via corepack). Run `corepack pnpm install && corepack pnpm test` to verify baseline (91 tests green).
- **AW3D30 GeoTIFF zips:** Must place `N001E103.zip` and `N001E104.zip` in `Map/` (user provides; not in git). Task 1 requires these.

## The 7 Tasks (Atomic, Test-First)

### Task 1: AW3D30 → Terrarium Tiles
Build Node scripts to convert GeoTIFFs to bundled Terrarium tiles under `public/dem/`.
- **Files:** `scripts/{build-dem,dem-lib}.mjs`, `scripts/dem-lib.test.mjs`
- **Key functions:** `encodeTerrarium(m): [r,g,b]`, `mosaicSample(tiles, lat, lon): number`
- **Output:** `public/dem/{z}/{x}/{y}.png` (z10–14), `public/dem/manifest.json`

### Task 2: Propagation Core
Knife-edge diffraction & Bullington algorithm. Pure module, test-first.
- **Create:** `src/lib/propagation.{ts,test.ts}`
- **Functions:** `knifeEdgeLossDb(nu)`, `buildProfile(from, to, groundAt)`, `bullingtonLossDb(profile, txElev, rxElev, freq)`
- **Clearance classes:** `'los'` | `'fresnel'` | `'obstructed'`

### Task 3: Objectives & Pair Evaluation
Add objectives system (workspace default + per-receiver override) and terrain diffraction integration.
- **Modify:** `src/types.ts`, `src/lib/{sensors,activeLink,state}.ts` + tests
- **New:** `Sensor.objective`, `MapScenario.{defaultObjective, propagationModel}`, schema v3→v4
- **Constraint:** Free-space mode byte-identical to v1.5.0.

### Task 4: Radial Coverage Sweep
Incremental Bullington diffraction along radials. O(1) per sample.
- **Create:** `src/lib/coverage.{ts,test.ts}`
- **Modify:** `src/workers/fieldWorker.ts`, `src/components/useFieldWorker.ts`
- **Perf:** 720 × 400 samples under 300 ms.

### Task 5: Workspace UI
Coverage layer, free-space rings, objective toggles, animation, compact cards.
- **Modify:** `MapWorkspace.tsx`, `SensorMap.tsx`, `SelectedSensorCard.tsx`, others
- **Create:** `SignalOverlay.tsx`, `CoverageLegend.tsx`
- **Features:** coverage/rings, objective default toggle, per-receiver override, animation, collapsible panels, tabbed cards

### Task 6: Link-Budget Drawer
Collapsible drawer for active pair, every Calculator field + path profile chart.
- **Create:** `LinkBudgetDrawer.tsx`, `PathProfileChart.tsx`
- **Includes:** scenario name, all inputs (writable), losses, power, margins, Rx meter, path profile chart (Chart.js)

### Task 7: Release Notes & Handoff
Version 1.6.0, update docs, verify green.

---

## Key Architecture Rules

1. **`src/lib/rf.ts` untouched.** Terrain loss added outside `calculateLink` via `otherLossDb`.
2. **Pure-module, test-first approach** for Tasks 1, 2, 4 (reduce debugging surface).
3. **Worker pattern:** Coverage job queued by jobId; stale jobs dropped on frequency change.
4. **Elevation URL:** `import.meta.env.BASE_URL + 'dem/{z}/{x}/{y}.png'` (Terrarium format).

## Critical Review Checkpoints

The spec names five non-obvious test cases (Review Focus 1–5 in the plan):

1. **Sea-level paths:** zero diffraction, 'los' clearance when antennas clear Earth bulge
2. **Grazing obstacle:** ~6 dB loss at 433 MHz and 28 GHz; frequency affects Fresnel zone
3. **Missing DEM:** pair flagged `elevationKnown: false`, diffraction is NaN, not shown as confident
4. **Objective switching:** only the switched receiver changes; zones follow selected receiver
5. **Frequency changes during coverage:** stale job dropped, new key computed, no backlog

---

## Status: Tasks 1–4 Complete, 5–7 Remaining

**Completed (Codex):**
- ✅ Task 1: AW3D30 → Terrarium Tiles — DEM build script, 854 tiles generated, tests pass
- ✅ Task 2: Propagation Core — knife-edge diffraction & Bullington algorithm, tests pass
- ✅ Task 3: Objectives & Pair Evaluation — schema v3→v4, objectives system, tests pass
- ✅ Task 4: Radial Coverage Sweep — incremental coverage computation, tests pass
- **Test status:** 120 tests passing, production build passes

**Blocked in Codex (sandbox restrictions):**
- 🚫 Task 5: Workspace UI — partially implemented, needs browser verification (localhost/Chromium blocked)
- 🚫 Task 6: Link-Budget Drawer — not started
- 🚫 Task 7: Release Notes & Handoff — not started

**Blocker:** Sandbox environment cannot:
- Bind to localhost for dev server (`EPERM` on port 5199)
- Execute Chromium for browser tests
- Create git commits

## Next Steps for Continuation

### Option A: Local Execution (Recommended)
Start from the completed checkpoint. Tasks 5–7 require:
1. Local dev server: `corepack pnpm dev` (port 5173, or configure in `vite.config.ts`)
2. Browser testing: Run `scripts/e2e/drive-map.mjs` (Playwright + installed Chrome)
3. Final commits and merge to `main`

### Option B: Unrestricted Environment
Continue in Codex or Claude Code session with:
- Localhost binding allowed
- Chromium/browser execution enabled
- Git write permissions
- Resume from checkpoint: `codex resume 01a178b0-0318-7b43-be19-0df65e791018`

## Execution Instructions (for Tasks 5–7)

Run each task atomically using superpowers:executing-plans (or manually in your IDE):

1. **Task 5:** Workspace UI — coverage layer, rings, objective toggles, animation, compact cards
2. **Task 6:** Link-Budget Drawer — Calculator merge phase 1
3. **Task 7:** Release Notes — version 1.6.0, update docs, verify green

After all 7 tasks: merge to `main` and cut release 1.6.0.

---

## Files to Read First (in order)

1. `REPOSITORY_BRIEF.md` — baseline RF maths & rules
2. `docs/superpowers/specs/2026-10-26-singapore-map-workspace-design.md` — v1.5.0 context
3. `docs/superpowers/specs/2026-10-26-link-workspace-v2-design.md` — detailed spec (critical reading)
4. `docs/superpowers/plans/2026-10-26-link-workspace-v2.md` — execution checklist (use directly)

---

## Acceptance

- All 7 tasks completed with test coverage and browser validation.
- `corepack pnpm test && corepack pnpm build` → 100% green.
- No breaking changes to RF engine, state shape, or localStorage key.
- Version bumped to 1.6.0.
- `docs/HANDOFF.md` refreshed (status table, decisions, environment setup).
