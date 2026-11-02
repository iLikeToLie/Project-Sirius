# Interference avoidance verification

## Task 7: Raise the sensor cap (2026-11-02)

The workspace allows 12 sensors. Adding a thirteenth is blocked; importing a
12-sensor scenario preserves all sensors, while a 13-sensor import is rejected.
The sensor counter and full-cap button use the shared cap.

Validation:

- `corepack pnpm test`: 225/225 tests pass. The new cap/import/36-path tests
  failed before the cap change and passed after it.
- `corepack pnpm build`: passes without warnings.
- `node scripts/benchmark-sensors.mjs`: Node 24.22.1, synthetic terrain with a
  ridge, six transmitters and six receivers, 36 paths around 24 km long using
  the 512-sample profile cap. After 20 warmups, 200 measured calls: mean
  0.972 ms, median 0.960 ms, p95 1.105 ms, maximum 1.267 ms. Module loading is
  excluded. All paths have valid results; diffraction is exercised. This is
  an in-memory terrain computation benchmark, not a network or map-rendering
  measurement. No propagation cache is needed against the 50 ms budget.
- `node scripts/e2e/twelve-sensors.mjs`: headless installed Chrome against the
  production preview at port 5199, with deterministic image/DEM responses.
  Passes at 1440 x 1000 and 390 x 1000 (workspace opened at desktop width,
  then resized). Checks 12 rows, the disabled cap button, all 36 matrix cells,
  matrix scrolling, selecting the last cell, reaching/deleting the last
  receiver, re-enabled Add button, no horizontal page overflow and no
  uncaught page errors. Existing layout styles need no changes.
- `git diff --check`: clean. `git diff main -- src/lib/rf.ts`: empty.

The remaining whole-branch review cases belong to Task 16.
