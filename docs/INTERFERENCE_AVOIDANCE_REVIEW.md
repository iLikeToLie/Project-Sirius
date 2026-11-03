# Interference avoidance verification

## Task 16 — Whole-branch review (2026-11-02)

Review base: `edb76799380c76152019d948dd6bb8bd735cbb95` (actual merge-base
with local `main`). Independent read-only review covered the branch through
`92c3393`; its three Important findings were reproduced and fixed in this task.
No Critical findings. The final checks cover the resulting working tree.
No push, merge or deployment was performed.

### Commands and environment

Windows, Node 24.22.1, pnpm 11.19.0, installed headless Chrome 156.0.8078.73,
1440 × 1000 viewport, production preview on localhost port 5199. Browser
checks use deterministic zero-height DEM and basemap image responses, with
explicit missing DEM responses for unknown-path tests. Chrome uses SwiftShader
software rendering. These checks verify app behavior, not provider availability
or the predictive accuracy of real terrain propagation.

```powershell
corepack pnpm test
corepack pnpm build
corepack pnpm exec vite preview --host 127.0.0.1 --port 5199 --strictPort
# Set PLAYWRIGHT_MODULE to the installed playwright-core index.mjs file URL,
# and CHROMIUM_EXECUTABLE to the installed Chrome executable, as in HANDOFF.md.
node scripts/e2e/interference-avoidance.mjs
node scripts/benchmark-sensors.mjs
git diff --check
git diff main -- src/lib/rf.ts
```

The consolidated script also loads the actual `main` sensor evaluator through
a read-only Vite virtual module. It first verifies that its shared runtime
dependencies (`rf.ts`, `geo.ts`, `propagation.ts`) are unchanged, then compares
complete RF result objects. It does not change any checkout or branch.

Results: **302/302 tests across 30 files pass**, production build passes without
warnings, whitespace check clean, and `rf.ts` unchanged from `main`. Seven new
regression cases were observed failing before their fixes, then passing.
No application dependencies or application network requests were added.
Current Playwright and Vite 6 documentation was fetched through Context7.

Existing browser regressions also pass: `interference-workspace.mjs`,
`channel-rejection.mjs`, `placement-layer.mjs`, `interference-layer.mjs`,
`twelve-sensors.mjs` (desktop and mobile), `polarization.mjs`, `noise-floor.mjs`,
`multi-link-receivers.mjs`, `link-budget-drawer.mjs` and `terrain-workspace.mjs`.
The terrain check first saw one additional global requestAnimationFrame during
its 300 ms idle assertion (274 versus 273), then passed unchanged when rerun
alone. Its counter includes all MapLibre rendering, not just signal animation;
this transient is recorded rather than treating the first run as a pass.

### Review Focus results

| Case | Result and evidence |
|---|---|
| 1. Default parity | PASS. One desired Tx/Rx pair has exactly the same powers, margins and raw statuses as the actual main evaluator; assessed status also matches. |
| 2. Aggregate avoidance | PASS. Three −67 dBm interferers produce −62.23 dBm and Possible interference. Setting aggregate Off changes the card to Marginal interference. |
| 3. Desired default | PASS. The desired receiver uses −67 dBm worst-single interference under the default aggregation setting. |
| 4. C/I throughout UI | PASS. A desired link below required C/I reads Interfered link in the card, list and matrix, and its receiver marker has the danger tone. Screenshot `04-ci-matrix.png`. |
| 5. Schema 5 migration | PASS. A schema 5 single-link file imports through the browser, saves as schema 6 and gains the 3 dB/objective/default-frequency/V defaults. Original desired-link status is retained. Isolated margin cases −70/−68/−67/−65/−60 dBm verify exact boundaries. See interpretation below. |
| 6. Isolation parity | PASS. Every complete RF result from multiple same-default-frequency/V pairs equals main exactly. Legacy browser channel tests also retain −51.18795996 dBm power. |
| 7. Binding power | PASS. Applying the unrounded maximum puts the receiver at its protected limit within 1e−10 dB and reads Below interference threshold. The real Set to max control rounds down to 0.1 dBm and clears the receiver. Zero-margin and fixed worst-single violation controls are checked separately. |
| 8. Unknown elevation | PASS. A missing −30 dBm path is excluded from a known −80 dBm partial sum and counted, not used as a contributor. Browser card/matrix show three missing paths explicitly. Fixed unknown paths also make power ranges incomplete and disable Set to max. |
| 9. Rejection settings | PASS. Two receivers retain independent ACR and mask values across both model toggles and browser reload. Existing channel checks cover edits and invalid-mask rejection. |
| 10. Twelve-sensor terrain drag | PASS on the fixture below. Real mouse drag moves and persists T3 with six transmitters/six receivers, terrain elevation and terrain diffraction enabled. Animation frames continue, and 180-radial drag requests return to 360-radial refinement after release. |
| 11. Placement consistency | PASS. A real placement-worker sample nearest the current transmitter exceeds the victim threshold, matching its Interferes card and Unsafe region. Exact zero-margin threshold equality is tested through placement plan/raster classification and reads Marginal, preserving safe C/I equality. |

Case 5's literal statement that *only* statuses within 3 dB may change conflicts
with the separately accepted aggregate and C/I behavior changes. The review
isolates the margin effect for that assertion; it does not claim that a legacy
multi-interferer scenario retains its old aggregate or desired-link statuses.

### Review fixes and rulings

1. **Fixed worst-single interference and unknown paths.** The power-range
   evaluator previously ignored other interferers whenever aggregation was Off.
   A source already violating the protected or C/I allowance now makes the
   range infeasible. Unknown fixed interferers are counted in either mode,
   including at served receivers. Set to max cannot confidently apply a partial
   range. Regression tests cover threshold/C/I feasibility, protected equality
   and unknown fixed paths; browser checks verify the disabled control.
2. **Served-link minimum.** The minimum now uses the greater of sensitivity
   plus fade margin and effective interference plus required C/I. This resolves
   Task 4's formula conflicting with its promise that served links stay
   Acceptable. Tests apply both aggregate and worst-single minimums and verify
   the resulting assessed desired link. The card explains both requirements.
3. **Zero-margin equality.** Review Focus 11 takes precedence over a blanket
   safe-equality interpretation when the margin is zero: equality at the raw
   interference threshold is Marginal in Placement, never Recommended. A
   separate threshold-only allowance preserves safe equality at a stricter C/I
   allowance. A fixed interferer exactly at the raw threshold also prevents
   recommending a cell. A zero-margin power maximum is moved 1e−9 dB inside
   the open threshold boundary before the existing UI rounds down; it cannot
   offer a threshold-equal power as safe. Positive-margin protected equality
   retains its original safe semantics. Tests cover these distinctions.

The old workspace browser check initially failed because its open Link settings
popover intercepted a matrix click; the test now closes that popover. Its old
exact count of two fix suggestions also predates frequency/polarization advice;
it now verifies the actual power and distance suggestions while allowing the
additional valid isolation suggestions. No product change was needed for these
two test setup issues.

### Timing and screenshots

Task 7's original in-memory 36-path terrain benchmark remains recorded below:
mean 0.972 ms, median 0.960 ms, p95 1.105 ms, max 1.267 ms. A fresh Task 16
run (same synthetic ridge, 20 warmups, 200 samples) measured mean 1.237 ms,
median 1.105 ms, p95 1.646 ms, max 2.341 ms, below the 50 ms pair-evaluation
budget. These values exclude module loading, browser rendering and networking.

The final browser drag generated 41 mousemove events over 8.580 seconds,
including automation round trips. Input-to-next-frame delay: median 2.8 ms,
p95 7.1 ms, max 8.4 ms. There were 141 measured frame intervals: median
50.0 ms, p95 116.7 ms, max 300.0 ms. Software rendering is visibly slower
than 60 fps, but input continues to be processed during the drag. The 42
completed six-source worker requests took 15.0–374.7 ms (median 64.5 ms,
p95 268.2 ms), below the plan's approximately 1-second concern threshold.
This is one local deterministic workload, not a hardware-independent guarantee.

Artifacts are local and git-ignored; paths relative to this feature worktree:

- `.superpowers/review-task16/results.json` — browser version, assertions and zero page errors.
- `.superpowers/review-task16/review-edb7679-92c3393.diff` — archived independent-review range (24 commits, 568,466 bytes).
- `.superpowers/review-task16/timing.json` — frame/input samples summarized above and every worker duration/source count/radial count.
- `.superpowers/review-task16/02-aggregate.png`
- `.superpowers/review-task16/04-ci-matrix.png`
- `.superpowers/review-task16/05-schema5-import.png`
- `.superpowers/review-task16/08-unknown.png`
- `.superpowers/review-task16/10-twelve-terrain-drag.png`
- `.superpowers/review-task16/11-placement.png`

The matrix, current-position Placement and twelve-sensor screenshots were
visually inspected. Basemap images are deterministic fixtures; they do not
represent live cartography. The visible 1.8.0 chip is the already documented
App.tsx scope exclusion, not a failed package version bump.

### Deferred minor findings

- The Interference layer paints exact protected-limit equality amber under
  Task 13's `[L,T)` band definition, while card/matrix shared definitions call
  that equality safe. The layer is conservative at that exact boundary.
- The multi-field request key serializes the full map, so some name, selection
  or threshold edits can recompute fields unnecessarily. The measured workload
  did not demonstrate a responsiveness failure requiring optimization.

### Disposition of items set aside by the reviewer

- Stale UI version labels remain explicitly excluded and disclosed; pair-pin
  changes in App.tsx are earlier authorized integration, with Calculator
  formulas/status logic unchanged. No further Calculator work is introduced.
- Directional antennas, spectral leakage and environment-dependent XPD remain
  future work/documented limitations. Terrain placement remains reciprocal and
  sampled by nearest ray; exact terrain reciprocity is not promised.
- Recommended continues to require served sensitivity plus fade margin, as
  explicitly defined in the placement legend. It does not promise served C/I;
  the transmitter's scalar allowed power interval now includes that requirement.
- Existing unknown desired-path badge/raw drawer behavior and the worker's
  pre-existing error handling are outside this branch's introduced changes;
  no new regressions were identified there by the independent review.
- Inherited Light-basemap and coverage-edge work between main and the plan's
  earlier `34140db` reference remains part of the baseline, not an interference
  implementation finding. Review Focus 5 is interpreted as described above.

All three Important findings were handled in one fix pass with failing-then-
passing regressions and a green full suite. The two Minor findings are deferred.
This review permits keeping the verified feature branch ready for user review;
it does not authorize publication or integration.

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

## Task 12: Multi-source power fields (2026-11-02)

`computeMultiField` returns one independent Float32 power raster per source in
request order, with the request's job id. Free-space powers use the same 1 m
link-budget base as radial coverage and the zone model's 3D separation.
Terrain powers run the existing radial sweep per source and use the extracted
`reprojectPowers` helper. The terrain sweep reaches all four raster corners,
with a 30 m minimum step or about 400 steps for a larger view. Its caller can
request 360 radials normally and 180 while dragging.

Missing source elevations yield an unknown field; missing free-space ground
or missing terrain paths yield NaN at the affected nodes. A zero-length
free-space path is unknown rather than infinite power. Empty source lists
return no fields; the shared sensor cap rejects requests above 12 sources.
Combining fields and adding their map controls remain Tasks 13 and 14.

The worker accepts `kind: 'multi'`. `useMultiFieldWorker` shares the existing
queue, job id checks, cleanup, and synchronous fallback with the other hooks.
React lifecycle documentation was fetched using Context7 after one transient
fetch failure; no scheduling behavior was changed.

Validation:

- Nine missing-calculation/reprojection failures RED, then GREEN. The existing
  nearest-ray parity fixture passed before refactoring and still passes.
- Worker routing failed for a multi request before implementation, then passed;
  existing coverage and zone routing also pass. The worker fixture's extra loss
  was corrected to add to the default loss rather than replace it.
- `corepack pnpm test`: 280/280 tests across 27 files pass. New tests cover
  3D free-space parity within 0.01 dB, source order and independent buffers,
  missing ground/elevations, the zero-length path, 180/360 terrain radials,
  off-screen sources, ridge shadows, the source cap, reprojection offsets and
  unknown/out-of-range samples, and all three worker request kinds.
- `corepack pnpm build`: passes without warnings and emits the updated worker.
- `git diff --check`: clean. Existing coverage tests unchanged; RF engine
  unchanged from main; App.tsx unchanged by this task. The new hook is not yet
  wired into map controls, so browser UI validation belongs to Tasks 13/14.
- Task 13 remains pending; no push or merge performed.

## Task 13 — Total interference map layer

The remembered layer selector offers Range and Interference. Placement is visible
and disabled until Task 14. Range retains its existing behavior; interference
hides range rings and uses the selected receiver, then the zone receiver, then
the first receiver. Its legend names that receiver and aggregate/worst single mode.

The existing multi-source worker receives every non-desired transmitter with
the reference receiver's height, pair-specific channel rejection, polarization
and losses. Its ground grid includes off-screen sources. Known powers combine
in linear power when aggregate applies, otherwise by maximum. Bands paint
at/above the threshold red, the protected interval amber, and below it clear.
Gradient uses the existing avoidance signal range. Unknown paths remain hatched;
no-interferer cells are clear where ground is known. Results carry the request
key so old rasters cannot be interpreted with a new grid or receiver settings.

Validation:

- Calculation/source tests failed for the missing module, then passed. The legend
  regression failed for the missing selector, then passed.
- `corepack pnpm test`: 285/285 tests across 29 files pass.
- `corepack pnpm build`: passes without warnings.
- Chrome `scripts/e2e/interference-layer.mjs` checks actual worker sources and
  receiver height, source exclusion, selected receiver changes, terrain/free-space
  dispatch, red/amber/clear rendering, gradient, disabled Placement, remembered
  layer/style, and range ring restoration. No uncaught page errors.
- Every rendered band pixel is checked against the worker powers in both
  aggregate and worst single modes, including the north/south image orientation.
- The browser fixture threshold was adjusted from a view containing red/amber
  only to one spanning all three bands; no product change was needed.
- `git diff --check` clean; RF engine unchanged from main; App.tsx unchanged.
- Task 14 remains pending; no push or merge performed.

## Task 14 — Safe transmitter placement layer

Placement is enabled for a selected transmitter and remembers the layer choice.
It fixes the current victim and served sets for the request, places worker ray
origins at those receivers, uses their ground plus antenna heights, and uses the
selected transmitter's height at each candidate cell. Pair budgets retain the
original transmitter power, gains, frequency, rejection, polarization and losses.
The legend lists both sets and explains the reciprocal terrain approximation.

Each victim's threshold and C/I allowances exclude the moving transmitter's
current contribution. Aggregate mode subtracts fixed interference in linear
power; worst-single mode also prevents an already violated fixed path from
being painted safe. Unknown fixed paths produce unknown allowances. Protection
margin applies to the threshold, matching Task 4; C/I is unchanged. Equality at
an allowance is permitted. A safe cell becomes Recommended when every served
receiver reaches sensitivity plus fade margin, including an empty served set.

Recommended is green, Safe light green, Marginal amber, Unsafe red, and Unknown
uses existing hatching. Placement has categorical colours, hides range rings
and gradient controls, and clears its overlay with a prompt when selection
changes to a receiver. Result keys prevent old fields from being reclassified
against changed inputs. No new dependencies or application network calls.

Validation:

- Eight calculation/integration tests and the legend test failed for missing
  functionality, then passed. An additional numerical integration test compares
  reversed field powers with forward `evaluatePairs` at every grid node, using
  unequal heights and gains, channel rejection and polarization mismatch.
- `corepack pnpm test`: 295/295 tests across 30 files pass.
- `corepack pnpm build`: passes without warnings.
- Chrome `scripts/e2e/placement-layer.mjs` checks worker origins, heights, budgets,
  all five categories and every RGBA pixel including row orientation, selection
  gating, persisted layer, terrain/free-space, isolation and restored range rings.
  The test injects one missing worker ray to verify hatching alongside real
  computed powers. Fixture counts: 43,335 Unsafe, 33,863 Marginal, 23,308 Safe,
  23,309 Recommended, one Unknown. No uncaught page errors.
- The terrain browser assertion waits for refined source elevations after the
  initial unknown result while DEM tiles load. This was a test wait correction.
- Existing Chrome `scripts/e2e/interference-layer.mjs` regression passes.
- `git diff --check` clean; RF engine unchanged from main; App.tsx unchanged.
- Task 15 remains pending; no push or merge performed.

## Task 15 — Documentation and version

Package version is 1.9.0. README and release history cover the implemented
workspace features, schema 6 migration, default aggregate interference for
avoidance receivers, the 3 dB protection margin and Marginal interference,
unknown paths, and unchanged no-interferer/default-isolation results. Limitations
include reciprocal placement terrain, rectangular in-band overlap without
spectral leakage, fixed XPD, and unchanged Calculator calculations/statuses.
The handoff updates the code map, test count and local branch state; backlog
items 7a–7k are checked as implemented, pending whole-branch review/deployment.

Validation:

- `corepack pnpm test`: 295/295 tests across 30 files pass.
- `corepack pnpm build`: passes without warnings.
- `git diff --check`: clean; `git diff main -- src/lib/rf.ts`: empty.
- No source changes in Task 15. Existing pair-pin integration changes in
  App.tsx predate this task; its 1.8.0 version chips and guide text remain under
  the plan's scope constraint and are disclosed in the handoff/release notes.
- Task 16 remains pending. No browser checks were rerun for this documentation
  task; no push or merge performed.
