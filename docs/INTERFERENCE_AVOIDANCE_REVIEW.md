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

## Task 8: Per-sensor channel and frequency rejection (2026-11-02)

Schema 6 now stores sensor frequency inheritance/override, bandwidth, ACR and
1–4 mask steps, plus a scenario rejection-model choice. Missing fields migrate
to defaults. Invalid frequency, bandwidth, ACR, mask ordering/length/rejection,
and model values reject an import. Both rejection settings survive switching
models, switching roles and saving/restoring the scenario.

`pairLinkInputs` supplies transmitter frequency and receiver channel rejection
to pair evaluation, active inputs, drawer, free-space zones and terrain coverage.
Rejection enters miscellaneous path loss once; the drawer's editable Other
field continues to edit only the saved shared loss. Terrain diffraction uses
the same transmitter frequency. Derived frequency/loss terms enter the worker
request key, so changing channels or models recomputes the map.

Validation:

- `corepack pnpm test`: 239/239 tests pass. Initial rejection-module and
  transmitter-frequency edit tests failed before implementation, then passed.
  Tests cover co-channel parity, half overlap (3.0103 dB), nested bands,
  adjacent bands, mask boundaries/between/beyond steps, schema defaults and
  rejection, retained settings, and an obstructed ridge proving diffraction
  uses the transmitter frequency. Independent masks avoid shared mutation.
- `corepack pnpm build`: passes without warnings.
- `node scripts/e2e/channel-rejection.mjs`: passes in headless installed Chrome
  against the final production build. Verifies legacy received power, partial
  overlap, off-channel warning, drawer frequency and miscellaneous-loss edits,
  ACR/mask controls and persistence, invalid-mask edits, 4-step cap, step removal,
  free-space worker recomputation, explicit Tx edits versus inherited default
  edits, and no uncaught page errors.
- Existing `interference-workspace.mjs`, `twelve-sensors.mjs`,
  `terrain-workspace.mjs` and `link-budget-drawer.mjs` browser checks pass.
  The terrain check uses the requested new Default frequency label.
- `git diff --check`: clean. `git diff main -- src/lib/rf.ts`: empty.
  Task 8 does not modify `src/App.tsx`.

The Channel help describes the in-band-only rectangular overlap approximation:
leakage outside the overlapping band is omitted. Polarization remains 0 dB in
the new pair metadata until Task 10. Task 9 is pending.
