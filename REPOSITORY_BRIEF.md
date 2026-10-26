# Repository briefing

Reviewed 22 October 2026 using the connected GitHub plugin.

Repository: https://github.com/iLikeToLie/friis-rf-calculator

## Current baseline

- Default branch: `main`.
- Current main commit: `92643bab9f563b26690ae8f22b207709cd48989b`, 24 September 2026, “Release v1.31.2 objective-aware receiver meter”.
- Web version: 1.31.2. Calculation model: workbook Version 3.
- Latest GitHub Actions Pages deployment succeeded: https://github.com/iLikeToLie/friis-rf-calculator/actions/runs/35954017785
- No open issues or pull requests found during review.
- Live calculator: https://iliketolie.github.io/friis-rf-calculator/

## Product and architecture

Browser-only React 19 / TypeScript application built with Vite 6. Charts use Chart.js 4 and react-chartjs-2; icons use lucide-react. No backend appears in the repository tree.

- `src/App.tsx`: application state, local storage, JSON import/export, navigation, calculator, live link schematic, sweeps, placement comparison, and guide. These are currently implemented together in one file.
- `src/lib/rf.ts`: pure calculation engine, validation, status interpretation, sweeps, and placement rankings.
- `src/lib/rf.test.ts`: five Vitest cases covering known workbook results and objective-specific status behavior.
- `src/types.ts`: state and domain types.
- `src/data/defaults.ts`: default scenario and ten placement rows.
- `src/styles.css`: responsive interface and semantic status styling.
- `DESIGN.md`: dark mission-control direction, monospaced typography, amber primary emphasis, fine borders, and objective-aware status colors.
- `.github/workflows/deploy-pages.yml`: install, test, build, and GitHub Pages deployment on main pushes or manual dispatch.
- Four workbook releases and `VERSION_HISTORY.txt` preserve spreadsheet history. The web app intentionally excludes Version 4 antenna-pattern/off-axis modeling.
- No AGENTS.md is present in the remote main tree.

## Calculation behavior to preserve

Received power is transmit power plus Tx and Rx gains minus FSPL and five additive losses. FSPL uses the workbook-compatible constant 32.44 with GHz converted to MHz and metres converted to kilometres. Wavelength uses 299,792,458 m/s.

Desired communication: below sensitivity means No link; meeting sensitivity but missing the fade-margin target means Weak link; meeting both means Acceptable link. Interference avoidance: received power at or above the interference threshold means Possible interference; lower power means Below interference threshold. Switching objective changes interpretation, not calculated power.

Link margin is received power minus sensitivity. Interference margin is threshold minus received power. Placement rank always orders stronger received power first, regardless of objective; ties share a rank. Invalid placements receive rank zero.

Distance sweeps cap at 1,000 points; gain sweeps cap at 301 points. The cap truncates the generated series rather than resampling the full requested range.

The receiver meter uses sensitivity plus required receive level (sensitivity + fade margin) for desired communication, or sensitivity plus interference threshold for avoidance.

## State and validation

The local-storage key is `friis-rf-planner-v3-state`. State is saved automatically, restored with defaults merged into saved sections, and can be exported/imported as JSON. Import checks top-level section presence and the placements array; it does not comprehensively validate nested runtime types. This is an area to examine if scenario handling changes.

The RF engine rejects nonfinite inputs, nonpositive frequency/distance, negative losses, and negative fade-margin targets. Default UI objective is desired communication, while engine functions default to avoidance when the objective argument is omitted.

## Recent direction

September 24 releases moved from the Raycast visual system (1.3) to mission control (1.31), then made link colors status-responsive (1.31.1) and the receiver meter objective-aware (1.31.2). August releases added the live RF graphic and objective toggle.

## Development and verification

Requires Node.js 22+ and pnpm; package manager is pinned to pnpm 11.19.0. Commands: `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm build`. Build runs TypeScript project checking followed by Vite.

This review inspected remote source and CI results; it did not run a fresh local build or browser test. The current workspace contains an empty Git repository with no commits or configured remote; the source has not been checked out here yet. No application code or remote repository state was changed.
