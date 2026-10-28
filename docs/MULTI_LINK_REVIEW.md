# Multi-transmitter receiver verification — 27 October 2026

Branch: `feature/multi-link-receivers`; base: `a04bc24`.
Tasks 1–4: `77093ce`, `43eb669`; Task 5: `0495955`; Task 6: `c0dfd3f`.

## Results

- `node_modules/.bin/vitest run --configLoader runner`: 145/145 tests, 15 files.
- `node_modules/.bin/tsc -b`: clean.
- `node_modules/.bin/vite build`: passes. Existing >500 kB chunk warning remains.
- `scripts/e2e/link-budget-drawer.mjs`: passes against the production preview, including editing fields and Calculator/free-space parity. Its real-terrain path reported unknown diffraction, so it does not prove real DEM availability.
- `scripts/e2e/multi-link-receivers.mjs`: passes against the production preview, including all six Review Focus cases, shared meter scales/markers, correct relative bar widths, and strongest-link summary. No uncaught browser errors.
- `git diff --check`: clean. `src/lib/rf.ts` and `src/App.tsx` have no changes from the base.

The schema-4 fixture in `scripts/e2e/fixtures/v4-single-link.json` was generated from the defaults at `a04bc24`, with free-space mode, terrain elevation disabled, and an explicit receiver link. The RF engine at that commit yields -51.18795995798126 dBm at its actual 500.00000000012307 m separation. Importing the fixture displays the same -51.19 dBm and migrates the explicit transmitter to a one-item list.

## Review Focus evidence

1. Missing legacy transmitter: import succeeds, selection becomes `auto`, one nearest-link meter remains.
2. Last desired checkbox unticked: `auto` becomes checked, stored selection is `auto`, one nearest-link meter remains.
3. Missing elevation: synthetic zero-elevation tiles are supplied except the tile under Weak. Alpha retains a finite meter; Weak shows Unknown and the elevation warning, with no fill or needle.
4. Avoidance: the desired rows are replaced by one meter for the shown pair against the interference threshold, the stored list stays intact, and switching back restores all rows.
5. Role change: changing Alpha to a receiver removes it from desired lists; changing the last listed transmitter to a receiver returns the original receiver to `auto`.
6. Equal power: colocated Alpha and Zulu have identical powers and bar widths, sort Alpha first despite their IDs and insertion order, and Alpha supplies the drawer summary.

## Phase 1 test audit

Commit `77093ce` added four tests in `src/lib/state.test.ts`: new receiver auto defaults, legacy string migration, missing-ID fallback, and duplicate removal. It updated schema expectations and existing sensor/active-link fixtures. Later browser checks independently cover an actual schema-4 fixture and its missing-transmitter variant.

## Decisions and review

- Ruling: Decision 3 and Review Focus 6 take precedence over Task 3's conflicting ID-based wording. Pair results carry the transmitter name; ties sort by name, then ID for duplicate names. Renaming can intentionally reorder equal-power rows.
- Ruling: `meterScale` lives in `sensors.ts`, as allowed by Task 6, so it can use the existing unit-test setup. `RxMeterStack` accepts links, pair inputs, and objective, deriving thresholds and scale together instead of receiving redundant scalar props. Browser assertions verify the rendered shared scale and markers.
- Ruling: retain the optional shared-input argument added to `activePair` in Phase 2. All production callers pass current inputs, preventing incorrect terrain ranking at a non-default frequency. Existing two-argument tests and callers remain compatible.
- Ruling: preserve the two existing phase commits; rewriting them solely to split completed tasks adds no behavioral benefit. Tasks 5 and 6 have separate commits.
- Final review: self-review (no subagent tool). Reviewed the full branch against the spec, migration validation, helper callers, unknown-elevation behavior, role removal, objectives, and unchanged single-link RF behavior. No unresolved correctness findings. This is weaker than an independent review; obtain one before merging.
- Deferred minor: existing large JavaScript chunk warning. Code splitting is outside this task.

## Rerunning browser checks

Start `node_modules/.bin/vite preview --host 127.0.0.1 --port 5199 --strictPort` after building.
Run each script with these environment variables if Playwright is not in local dependencies:

```sh
export PLAYWRIGHT_MODULE=/Users/kj-gab/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs
export CHROMIUM_EXECUTABLE=/Users/kj-gab/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell
node scripts/e2e/link-budget-drawer.mjs
node scripts/e2e/multi-link-receivers.mjs
```

These paths are machine-specific. Set `E2E_URL` for another preview URL. The browser and preview require sandbox approval in the managed environment. No dependencies were installed.

The plan and `docs/BACKLOG.md` remain untracked as requested. No merge, push, or deployment was performed.
