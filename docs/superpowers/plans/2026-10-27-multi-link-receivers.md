# Multi-transmitter receivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A receiver can take desired communication from several transmitters at once, and its Rx meter shows one bar per desired transmitter, sorted best to worst.

**Architecture:** Replace each receiver's single `intendedTxId` with `desiredTxIds: 'auto' | string[]`. `'auto'` keeps today's behaviour (the nearest transmitter). An explicit list is the set of desired transmitters. Pair evaluation keeps its `intended` flag, now meaning "desired", so the map, the coverage zones and the interference logic need few changes. The schema moves to version 5 with a migration from version 4.

**Tech Stack:** TypeScript, React 19, MapLibre GL, Vitest. No new dependencies.

**Spec:** `docs/BACKLOG.md`, item 3, and the decision recorded there: one bar per desired transmitter, sorted best to worst. Base code: `origin/main` (a04bc24). The local branch `feature/link-workspace-terrain` is older and must not be used as the base.

## Global Constraints

- Free-space results for every existing single-link scenario stay unchanged. The engine in `src/lib/rf.ts` is not modified.
- Scenario files from schema 4 (web 1.6.0) and earlier open with the same links and results. Their `intendedTxId` value becomes a one-item list, or `'auto'`.
- At most 6 sensors (`MAX_SENSORS`), so at most 5 transmitters for one receiver.
- The Calculator tab (`src/App.tsx`) keeps one link and its single meter. It is not changed.
- No API keys, no new network calls.

## Decisions (agreed 27 Oct)

1. **Empty list means auto.** Unticking the last desired transmitter returns the receiver to `'auto'`. It never means "no link". Avoidance is the only way to have no desired link.
2. **Drawer link.** The Link budget drawer shows the strongest desired link of the selected receiver. Its meter lists all desired links.
3. **Order is by received power, not distance.** Ties are broken by transmitter name, so the order is stable.

## Review Focus

1. A saved 1.6.0 file whose receiver names a transmitter that no longer exists opens with that receiver on `'auto'`, with no crash.
2. Unticking the last desired transmitter returns the receiver to `'auto'`, not to an empty meter.
3. A desired transmitter whose ground elevation is unknown (terrain on, tile missing) is flagged unknown in its meter row. It is not shown as a confident value.
4. A receiver switched to avoidance keeps its desired list, so switching back restores it. Its meter shows no desired rows.
5. A desired transmitter that is changed to a receiver is removed from every receiver's list. A list that becomes empty returns to `'auto'`.
6. Two desired transmitters with equal received power keep a stable order (by name).

---

## Model routing

**Claude planner:** Haiku 5.5, running this session. Availability: confirmed (current session). The plan is complete; no change of planner is needed.

**Codex availability:** the local runtime lists these models as visible (`codex debug models`, codex-cli 0.164.0): `gpt-6-luna`, `gpt-6-sol`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, and others. The plugin `openai-codex/codex` 1.0.6 accepts `--model <model>` and `--effort none|minimal|low|medium|high|xhigh`. It does **not** accept `max` or `ultra` through `/codex:rescue`, so those are not used below. Plugin-side acceptance of each model slug is not yet tested; run the first phase and check it starts.

**Codex per phase:**

| Phase | Model | Effort | Why | Verify | Escalate |
| --- | --- | --- | --- | --- | --- |
| 1. Data model and migration (Tasks 1-2) | `gpt-6-luna` (confirmed in runtime) | `medium` | Mostly a rename and a bounded migration with clear tests | `pnpm test -- state` passes; saved schema 4 files load with the same links | Migration tests fail twice after focused fixes |
| 2. Pair evaluation and active link (Tasks 3-4) | `gpt-6.1-sol` (confirmed in runtime) | `high` | Desired-set semantics, sort order and zone logic interact across modules | `pnpm test -- sensors` and `pnpm test -- activeLink` pass; free-space parity tests unchanged | Free-space parity breaks, or two focused attempts fail to fix the sort or the active pair |
| 3. Sensor card picker and Rx meter (Tasks 5-6) | `gpt-6-sol` (confirmed in runtime) | `medium` | Bounded UI change over the helpers from phase 2 | `pnpm test && pnpm build`; drawer e2e script or manual check of each row | Meter scale or markers wrong for a multi-link case |
| 4. Whole-branch review and verification (Task 7) | `gpt-6.1-sol` (confirmed in runtime) | `high` | Substantive review of the full change against the Review Focus list | Each Review Focus item checked by hand; `pnpm test` and `pnpm build` pass | Any Review Focus item fails |

Run the phases in order: each depends on the types and helpers of the one before. Each phase ends with its own commits, as the plan's tasks specify.

## Completion status (27 Oct, Codex CLI)

Tasks 1–7 are implemented and verified in `.claude/worktrees/multi-link-receivers` on `feature/multi-link-receivers`. See `docs/MULTI_LINK_REVIEW.md` for reproducible commands, all six browser review cases, Phase 1 test audit, and review decisions. `CODEX_BRIEF.md` now points to this completed task; the terrain brief below it is historical.

- Tasks 1–2: `77093ce`; Tasks 3–4: `43eb669`.
- Task 5: `0495955`, multi-select transmitter picker.
- Task 6: `c0dfd3f`, stacked Rx meters, unknown rows, shared scale and name-based tie ordering.
- Task 7: 145 tests pass; typecheck and production build pass; existing drawer regression and new six-case multi-link browser regression pass. Whole-branch self-review completed because no subagent reviewer tool is available.
- The Phase 1 audit found four added state tests: auto defaults, legacy migration, missing-ID fallback, deduplication.
- The optional shared-input argument to `activePair` is retained; every production caller passes current inputs. No RF engine or Calculator component changes.
- Existing phase commits are preserved; Tasks 5 and 6 have individual commits.

**Outstanding implementation tasks:** none.

**Before merge:** independent review is recommended. This session performed a self-review. The existing large-chunk build warning remains; no merge, push, or release has been performed.

## Environment notes (Codex CLI)

- Use the existing `node_modules` symlink to `../v2-ui/node_modules`; do not replace it with an install.
- Run `node_modules/.bin/vitest run --configLoader runner`, `node_modules/.bin/tsc -b` and `node_modules/.bin/vite build` directly.
- Preview, headless browser launch and shared git-index writes require sandbox approval. Normal escalation completed them successfully; these are no longer unperformed checks.
- Browser overrides and fixture provenance are recorded in `docs/MULTI_LINK_REVIEW.md`.
- Do not edit `src/lib/rf.ts`, and do not commit `docs/BACKLOG.md`, this plan, or `node_modules`.

---

### Task 1: Data model and schema 5

**Files:**
- Modify: `src/types.ts` (`Sensor.intendedTxId` → `desiredTxIds`; `AppState.schemaVersion: 4` → `5`)
- Modify: `src/data/defaults.ts:40` (default `desiredTxIds: 'auto'`; `schemaVersion` 5)
- Modify: `src/lib/activeLink.test.ts:34` and `src/lib/sensors.test.ts` (use the new field)
- Test: `src/lib/state.test.ts:21,29` (expect version 5)

**Interfaces:**
- Produces: `Sensor.desiredTxIds: 'auto' | string[]`; `AppState.schemaVersion: 5`. No other task starts before this one compiles.

- [ ] **Step 1: Write the failing test**

In `src/lib/state.test.ts`, change the two `schemaVersion` expectations from `4` to `5`, and add:

```ts
it('defaults new receivers to auto', () => {
  expect(DEFAULT_STATE.map.sensors.every((s) => s.desiredTxIds === 'auto' || s.role === 'tx')).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- state`
Expected: FAIL (version 4 is still the value; `desiredTxIds` is not defined).

- [ ] **Step 3: Rename the field and bump the version**

In `src/types.ts`, replace `intendedTxId: 'auto' | string;` with `desiredTxIds: 'auto' | string[];` and `schemaVersion: 4;` with `schemaVersion: 5;`. In `src/data/defaults.ts:40`, set `desiredTxIds: 'auto' as const`. Update the references listed above to the new name; the logic is still the single-transmitter logic at this point.

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm test && pnpm exec tsc -b`
Expected: PASS. Type errors in `sensors.ts`, `state.ts`, `SelectedSensorCard.tsx`, and `activeLink.ts` are expected until Tasks 2 to 5 land; if they appear, convert the single value to a one-item list at the call site and note it in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/data/defaults.ts src/lib src/components
git commit -m "Rename receiver intended transmitter to desired list, schema 5"
```

---

### Task 2: Migration from schema 4 and saved files

**Files:**
- Modify: `src/lib/state.ts` (`readSensor`, `readMap`)
- Test: `src/lib/state.test.ts`

**Interfaces:**
- Consumes: `Sensor.desiredTxIds` (Task 1).
- Produces: `normalizeState` and `validateImport` accept a sensor with either `desiredTxIds` (schema 5) or `intendedTxId` (schema 4 and earlier, string).

- [ ] **Step 1: Write the failing tests**

```ts
it('migrates a saved intendedTxId string to a one-item list', () => {
  const state = normalizeState(v4WithReceiver({ intendedTxId: 'sensor-1' }));
  expect(state.map.sensors.find((s) => s.role === 'rx')?.desiredTxIds).toEqual(['sensor-1']);
});

it('drops unknown transmitters and falls back to auto when nothing is left', () => {
  const state = normalizeState(v5WithReceiver({ desiredTxIds: ['missing-id'] }));
  expect(state.map.sensors.find((s) => s.role === 'rx')?.desiredTxIds).toBe('auto');
});

it('removes duplicate ids', () => {
  const state = normalizeState(v5WithReceiver({ desiredTxIds: ['sensor-1', 'sensor-1'] }));
  expect(state.map.sensors.find((s) => s.role === 'rx')?.desiredTxIds).toEqual(['sensor-1']);
});
```

`v4WithReceiver` and `v5WithReceiver` are small helpers that build a saved state with one transmitter `sensor-1` and one receiver, using the existing `base()` helper in that file. Write them next to `v2` at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- state`
Expected: FAIL on all three.

- [ ] **Step 3: Implement the migration**

In `readSensor`, accept `desiredTxIds` as `'auto'` or a string array, and accept the legacy `intendedTxId` string as `'auto'` or `[id]`. Write a small `readDesired(value)` helper that returns `'auto' | string[]`. In `readMap`, after the id set is built, filter each list to ids that exist and are transmitters, dedupe, and return `'auto'` if the result is empty. Keep the existing strict rule: a malformed value still rejects the sensor.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state.ts src/lib/state.test.ts
git commit -m "Migrate receiver transmitter links to desired lists"
```

---

### Task 3: Pair evaluation over a desired set

**Files:**
- Modify: `src/lib/sensors.ts` (`resolveIntendedTx` → `resolveDesiredTxs`; `changeRole`; `removeSensor`; `evaluatePairs`; `receiverSummary`)
- Test: `src/lib/sensors.test.ts`

**Interfaces:**
- Consumes: `Sensor.desiredTxIds` (Task 1).
- Produces:
  - `resolveDesiredTxs(scenario: MapScenario, rx: Sensor, groundAt: GroundAt): Sensor[]`: empty for avoidance; the nearest transmitter for `'auto'`; otherwise the listed transmitters that still exist, in sensor order.
  - `receiverSummary(pairs: PairResult[], rxId: string): { links: PairResult[]; worstInterferer: PairResult | null; interferersAbove: number }`, where `links` is the desired pairs sorted by `result.receivedPowerDbm` descending, ties by `txId`.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns every listed transmitter for a receiver, in sensor order', () => {
  const rx = { ...R1, desiredTxIds: [T2.id, T1.id] };
  expect(resolveDesiredTxs(scenario([T1, T2, rx]), rx, flat).map((s) => s.name)).toEqual(['T1', 'T2']);
});

it('returns one nearest transmitter for auto and none for avoidance', () => {
  expect(resolveDesiredTxs(scenario([T1, T2, R1]), R1, flat)).toHaveLength(1);
  expect(resolveDesiredTxs(scenario([T1, T2, { ...R1, objective: 'avoidance' }]), { ...R1, objective: 'avoidance' }, flat)).toEqual([]);
});

it('marks every listed transmitter as desired and the others as interference', () => {
  const pairs = evaluatePairs(scenario([T1, T2, { ...R1, desiredTxIds: [T1.id, T2.id] }]), DEFAULT_INPUTS, flat);
  expect(pairs.filter((p) => p.rxId === R1.id && p.intended)).toHaveLength(2);
});

it('sorts desired links by received power, best first, ties by name', () => {
  const summary = receiverSummary(pairsWithPowers(R1.id, [['T2', -70], ['T1', -70], ['T3', -60]]), R1.id);
  expect(summary.links.map((p) => p.txId)).toEqual(['T3', 'T1', 'T2']);
});

it('drops a transmitter from every list when it becomes a receiver', () => {
  const after = changeRole(sensorsWithLinks, T1.id, 'rx');
  expect(after.find((s) => s.id === R1.id)?.desiredTxIds).toBe('auto');
});
```

`pairsWithPowers` builds `PairResult[]` with the given received powers, using the existing `calculateLink` fixture pattern in `sensors.test.ts`. `sensorsWithLinks` is a receiver whose list is `[T1.id, T2.id]`; put it with the other fixtures.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- sensors`
Expected: FAIL (the functions do not exist yet).

- [ ] **Step 3: Implement**

Rename `resolveIntendedTx` to `resolveDesiredTxs` and return the array. Update the `intended` set in `evaluatePairs` to use `resolveDesiredTxs(...).some((d) => d.id === tx.id)`. Keep `calculateLink(inputs, intended ? 'desired' : 'avoidance')` unchanged. In `changeRole` and `removeSensor`, filter the id out of each list and return `'auto'` when the list becomes empty. In `receiverSummary`, return `links` (desired pairs sorted as specified) in place of `link`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- sensors`
Expected: PASS. Existing free-space parity tests must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sensors.ts src/lib/sensors.test.ts
git commit -m "Evaluate receivers against a desired transmitter set"
```

---

### Task 4: Active link and coverage zones

**Files:**
- Modify: `src/lib/activeLink.ts` (`activePair`, `servedBy`, `zoneReceiver`)
- Test: `src/lib/activeLink.test.ts`

**Interfaces:**
- Consumes: `resolveDesiredTxs`, `receiverSummary` (Task 3).
- Produces: `activePair(map, groundAt)` returns the selected receiver's strongest desired pair (decision 2). Its signature does not change, so the Calculator tab and the drawer keep working.

- [ ] **Step 1: Write the failing tests**

```ts
it('uses the strongest desired transmitter for the selected receiver', () => {
  const map = mapWith({ selectedId: R1.id, sensors: [T1, T2, { ...R1, desiredTxIds: [T1.id, T2.id] }] });
  expect(activePair(map, flat)?.tx.id).toBe(strongestOf(map, R1.id).txId);
});

it('serves a transmitter to every receiver that lists it', () => {
  const map = mapWith({ sensors: [T1, T2, R1, R2].map(withList) });
  expect(zoneReceiver(map, T1.id, flat)).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- activeLink`
Expected: FAIL.

- [ ] **Step 3: Implement**

Change `servedBy` to test membership in `resolveDesiredTxs`. In `activePair`, for a selected receiver take the first entry of `resolveDesiredTxs` sorted by received power, falling back to the nearest transmitter as today. Because the active pair's strength needs the power, compute it with `calculateLink` on each candidate pair, using the same inputs `evaluatePairs` uses. Keep the function signature. Update `zoneReceiver` only where it reads the single link.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- activeLink`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/activeLink.ts src/lib/activeLink.test.ts
git commit -m "Pick the strongest desired link for the active pair"
```

---

### Task 5: Sensor card, transmitter picker

**Files:**
- Modify: `src/components/map/SelectedSensorCard.tsx` (the intended transmitter `<select>` at about lines 75-82; the results block at about lines 96-108)
- Modify: `src/components/map/SensorListCard.tsx` (any reference to the single link)

**Interfaces:**
- Consumes: `receiverSummary(...).links` (Task 3), `Sensor.desiredTxIds` (Task 1).

- [x] **Step 1: Write the failing test**

Add a unit test for a small pure helper, `toggleDesired(current: 'auto' | string[], txId: string, allTxIds: string[]): 'auto' | string[]`, in `src/lib/sensors.ts`:

```ts
it('returns to auto when the last desired transmitter is unticked', () => {
  expect(toggleDesired([T1.id], T1.id, [T1.id, T2.id])).toBe('auto');
});

it('adds a transmitter in sensor order', () => {
  expect(toggleDesired([T2.id], T1.id, [T1.id, T2.id])).toEqual([T1.id, T2.id]);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- sensors`
Expected: FAIL.

- [x] **Step 3: Implement the helper and the picker**

Implement `toggleDesired` in `sensors.ts`. In the card, replace the `<select>` with a checkbox list titled "Desired transmitters": an "Auto (nearest)" checkbox first, then one checkbox per transmitter. Ticking "Auto" sets `'auto'`. Ticking a transmitter calls `toggleDesired`. The results block lists each desired link (from `summary.links`), one line each, in meter order.

- [x] **Step 4: Run the tests and build**

Run: `pnpm test && pnpm build`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/components/map/SelectedSensorCard.tsx src/components/map/SensorListCard.tsx src/lib/sensors.ts src/lib/sensors.test.ts
git commit -m "Let receivers pick several desired transmitters"
```

---

### Task 6: Rx meter, one bar per desired transmitter

**Files:**
- Modify: `src/components/map/LinkBudgetDrawer.tsx` (the meter block at about lines 88-97)
- Create: `src/components/map/RxMeterStack.tsx` (one meter row per desired link)
- Modify: `src/styles.css` (spacing for stacked rows only; reuse `.power-meter`, `.meter-*`)
- Test: `src/lib/sensors.test.ts` (sort order is covered in Task 3)

**Interfaces:**
- Consumes: `receiverSummary(...).links` (Task 3).
- Produces: `RxMeterStack({ links, sensitivityDbm, objective, referenceDbm, scaleMin, scaleMax })`. Each row has the same markers as today's meter (sensitivity, required or threshold) and the same scale across rows.

- [x] **Step 1: Write the failing test**

Add a pure helper `meterScale(links: PairResult[], inputs: LinkInputs): { scaleMin: number; scaleMax: number }` to `RxMeterStack.tsx` (exported), and test that it covers every link's power plus the sensitivity and reference:

```ts
it('uses one scale that covers every desired link', () => {
  const scale = meterScale(linksAt([-90, -60]), inputsAt(-85));
  expect(scale.scaleMin).toBeLessThanOrEqual(-100);
  expect(scale.scaleMax).toBeGreaterThanOrEqual(-50);
});
```

Put the test in `src/lib/sensors.test.ts` if the helper lives in `sensors.ts`; otherwise add `src/components/map/RxMeterStack.test.tsx` only if the project already has component tests. Check first with `git ls-files 'src/components/**/*.test.*'`.

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL.

- [x] **Step 3: Implement**

`RxMeterStack` renders one `power-meter` block per link, in the order given, each with its own title (transmitter name and dBm value), bar and scale. The scale comes from `meterScale`. If `links` is empty and the objective is desired, show "No desired transmitter". If the objective is avoidance, show "Avoidance: no desired link". A row whose pair has unknown elevation shows the same note the drawer shows today. In `LinkBudgetDrawer`, replace the single meter block with `<RxMeterStack … />`. Keep the top summary line of the drawer on the strongest link.

- [x] **Step 4: Run the tests and build, then check in a browser**

Run: `pnpm test && pnpm build`
Expected: PASS. Then run the existing e2e drawer script (`scripts/e2e/link-budget-drawer.mjs`) against the built site and check that it still passes. If the script requires a browser that is not installed, note that in the commit and check the drawer by hand.

- [x] **Step 5: Commit**

```bash
git add src/components/map/RxMeterStack.tsx src/components/map/LinkBudgetDrawer.tsx src/styles.css src/lib/sensors.ts src/lib/sensors.test.ts
git commit -m "Show one Rx meter bar per desired transmitter"
```

---

### Task 7: Verification and review

- [x] **Step 1:** Run `pnpm test`. Expected: every test passes; the count is at least the baseline on `origin/main` plus the new tests.
- [x] **Step 2:** Run `pnpm build`. Expected: no type or build errors.
- [x] **Step 3:** Load a saved 1.6.0 scenario JSON (export one from `origin/main` first) and check that it opens with the same results as before the change.
- [x] **Step 4:** Check each Review Focus item by hand in the browser: a missing transmitter, unticking the last one, unknown elevation, avoidance then desired, role swap, equal power.
- [x] **Step 5:** Whole-branch self-review completed (no subagent tool); independent review recommended before merge. No PR opened.

---

## Notes for the executor

- Create the working branch from `origin/main` in a new worktree (`superpowers:using-git-worktrees`). Do not start from the local `feature/link-workspace-terrain`.
- The backlog items 2, 4 and 5 are separate. Item 5 is partly covered by Task 6, but the drawer-placement details are in `docs/BACKLOG.md`.

---

## Follow-up tasks from `docs/BACKLOG.md` (27 Oct)

These are added to the plan so they are tracked with the branch. Each one follows the backlog item of the same number, which holds the full detail. Items 1 and 4 to 6 are not started. Items 2 and 3 are partly or fully covered below.

### Task 8: Hide range rings in terrain mode (backlog 2)

- [ ] **Step 1: Browser check.** Toggle Model between Terrain diffraction and Free space. The dashed rings must be hidden in terrain mode and shown in free-space mode. The legend and the sensor card note must match the mode.
- [ ] **Step 2: Commit** the working-tree change (`MapWorkspace.tsx`, `CoverageLegend.tsx`, `SelectedSensorCard.tsx`) once Step 1 passes. Unit tests and build passed on 27 Oct.

### Task 9: Desired-link distance labels (backlog 4)

- [ ] **Step 1: Write the failing test** for the label text, using the existing distance formatting (km or m, as the workspace already uses).
- [ ] **Step 2: Implement** a midpoint label on each desired `MapLink` in `SensorMap.tsx`.
- [ ] **Step 3: Run** `pnpm test && pnpm build`, then check the labels in the browser.

### Task 10: Rx power meter in the Link budget drawer (backlog 5)

- [ ] **Step 1: Compare** the drawer meter with the reference in `docs/BACKLOG.md`: scale, markers, colours and labels. Task 6 already built the stacked meters, so only the gaps need work.
- [ ] **Step 2: Write failing tests** for any missing marker or label.
- [ ] **Step 3: Implement** the gaps, keeping the objective-aware reference lines (desired vs avoidance).
- [ ] **Step 4: Run** `pnpm test && pnpm build`, then check the drawer in the browser.

### Task 11: Link settings number fields and frequency scale (backlog 6)

- [ ] **Step 1: Confirm** the spinner overlap and the slider scale in `LinkSettingsCard.tsx`, and the same fields in the Link budget drawer and the Calculator tab.
- [ ] **Step 2: Fix** the spinner and unit layout so every value is fully visible.
- [ ] **Step 3: Fix** the frequency scale labels so they match the slider mapping (check whether the slider is logarithmic).
- [ ] **Step 4: Run** `pnpm test && pnpm build`, then check each field in the browser.

### Task 12: Restyle the basemap (backlog 1)

- [ ] **Step 1: Check OneMap's styles first.** If a label-free style exists, use it and stop here.
- [ ] **Step 2: Otherwise** build a Singapore PMTiles extract and style it with `@protomaps/basemaps` (light or grayscale, no `lang`).
- [ ] **Step 3: Keep** the hillshade and the OneMap and JAXA attribution correct.
- [ ] **Step 4: Check** the basemap at zoom 10.5 to 19 in light and dark mode.

### Task 13: Verify the change is on the branch

- [ ] Before any of Tasks 8 to 12 start, confirm which checkout holds `feature/multi-link-receivers`. The Task 8 change was made in `/Users/kj-gab/Documents/Codex/Project-Sirius`, not the worktree named in the completion status.
