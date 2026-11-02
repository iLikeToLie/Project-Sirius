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

## Task 9: Threshold from noise floor (2026-11-02)

Receiver cards offer a collapsed Derive from noise floor section in the Sensor
tab. It uses the receiver's channel bandwidth with -174 dBm/Hz thermal noise,
local noise figure (default 6 dB) and local I/N (default -6 dB). Only the explicit
Use as interference threshold action saves the calculated threshold; the
receiver's protection margin remains in effect. Readouts use one decimal place,
while the applied threshold retains full calculation precision.

Validation:

- Four new tests failed before implementation, then passed.
- `corepack pnpm test`: 243/243 tests pass. Coverage includes 20 MHz / NF 6
  giving approximately -95.0 dBm noise and -101.0 dBm threshold with I/N -6,
  bandwidth and noise-figure scaling, MHz units and receiver-only collapsed UI.
- `corepack pnpm build`: passes without warnings.
- `node scripts/e2e/noise-floor.mjs`: passes in headless installed Chrome
  against production preview. Checks defaults, explicit threshold application,
  rejection of negative noise figure, bandwidth-driven updates, no automatic
  threshold change during edits, only the target threshold changing on apply,
  local inputs resetting after reload, persisted applied threshold, no panel
  for transmitters and no uncaught page errors.
- `git diff --check`: clean. RF engine unchanged from main; App.tsx unchanged
  by this task. No schema or persistence changes. Task 10 is pending.

## Task 10: Per-sensor polarization (2026-11-02)

Every sensor now stores V, H, RHCP or LHCP polarization (default V). The
scenario stores cross-polar discrimination (XPD), default 15 dB and constrained
to a finite non-negative value. Missing fields in older saves get these defaults;
invalid explicit values reject imports. Role changes retain polarization.

The pair budget adds zero for matching polarizations, XPD for orthogonal
linear or circular polarizations, and 10 log10(2) dB for linear/circular pairs.
This loss enters otherLossDb once, alongside frequency rejection and terrain
loss. The shared polarization loss remains an extra loss on every pair.
The drawer reports per-sensor mismatch separately, including the Tx/Rx types.
Sensor cards expose all four choices, and Link settings explains additive
losses and the cautious 15 dB urban XPD default. XPD remains a fixed path
approximation rather than a terrain-dependent estimate.

Validation:

- Six new calculation/state tests failed before implementation, then passed;
  three new UI tests likewise failed before implementation, then passed.
  A parity regression also verifies unchanged results for all-V sensors.
- `corepack pnpm test`: 253/253 tests pass. Coverage includes all 16 ordered
  polarization combinations at four XPD values, old schema 5/6 defaults,
  new sensors, import validation, zero/custom XPD, role/save retention,
  desired/interferer power and margin parity, exact V/H attenuation, combined
  frequency/shared losses, and active-link edits without double counting.
- `corepack pnpm build`: passes without warnings.
- `node scripts/e2e/polarization.mjs`: passes in headless installed Chrome
  against production preview. Verifies legacy power parity, all four choices,
  XPD validation and zero, linear/circular and circular/circular mismatch,
  role retention, shared-loss edits, free-space range recomputation, terrain
  worker inputs updating after XPD edits, saved values after reload, and no
  uncaught page errors.
- Existing `node scripts/e2e/channel-rejection.mjs` also passes, including
  channel model persistence, overlap/rejection, worker updates and drawer edits.
- `git diff --check`: clean. RF engine unchanged from main; App.tsx unchanged
  by this task. Task 11 is pending.

## Task 11: Isolation-based fix suggestions (2026-11-02)

Receiver-local advice now offers an orthogonal contributor polarization when
matching antennas have enough XPD, and a frequency centre offset when the
selected rejection model supplies enough isolation. Simple rejection uses the
non-overlap offset; masks use the first sufficient step with that same floor.
Already applied rejection is included in the required replacement isolation.
The advice uses the aggregate or C/I allowance already computed for power
suggestions and preserves warnings about other violating contributors.
Frequency changes under terrain propagation are labelled as estimates.

Validation:

- Targeted tests: 11 expected missing-suggestion failures before implementation,
  then 50/50 interference tests pass after implementation and fixture corrections.
- `corepack pnpm test`: 267/267 tests pass. New coverage includes all four
  orthogonal switches, equality at the XPD/ACR/mask boundaries, insufficient
  isolation, unequal bandwidths, mask step selection, existing rejection,
  aggregate allowances, other-contributor warnings, and terrain estimate labels.
  Applying frequency and polarization advice to evaluated free-space pairs
  clears the protected limit for both rejection models.
- `corepack pnpm build`: passes without warnings.
- `git diff --check`: clean. RF engine unchanged from main; App.tsx unchanged
  by this task. No browser check added for this pure calculation change.
- Task 12 remains pending; no push or merge performed.
