# Handoff — Friis RF calculator / Link workspace

Last updated 27 October 2026. Everything needed to continue this work on another machine is in this repo, except the items under "Not in git".

## Status update, 27 October 2026 (read first)

- `feature/link-workspace-terrain` (this branch) now holds the v2 terrain work as uncommitted-then-committed changes: DEM build scripts (`scripts/build-dem.mjs`, `dem-lib.mjs`), `src/lib/propagation.ts`, `coverage.ts`, `SignalOverlay`, `CoverageLegend`, and the state/worker/map updates. `corepack pnpm test` and `corepack pnpm build` pass on it.
- Related branches, all pushed to origin: `feature/v2-ui` (v2 tasks 1-7 done, review + merge pending), `feature/multi-link-receivers` (multi-transmitter receivers; see `docs/MULTI_LINK_REVIEW.md`, plan in `docs/superpowers/plans/2026-10-27-multi-link-receivers.md`), `worktree-coverage-aesthetic`.
- Pending ideas are in `docs/BACKLOG.md` (basemap restyle, hiding range circles in terrain mode, Rx meter per transmitter).
- Next step: decide the merge order of the branches above into `main`, then cut release 1.6.0. `package.json` on this branch still says 1.5.0.
- `.claude/` (including local worktrees) is git-ignored; on a new machine re-create worktrees with `git worktree add` from the pushed branches if needed.
- The "Where things stand" table below is older than this section; where they disagree, this section wins.

## Where things stand

| Item | State |
|---|---|
| Branch | `feature/link-workspace-terrain` (from `main` @ `92643ba`, web 1.31.2). Not merged. |
| Web 1.4.0 | Plan-view Link workspace with synthetic terrain. Done; superseded by 1.5.0. |
| Web 1.5.0 | Singapore map workspace: OneMap Grey basemap, up to 6 TX/RX sensors, intended transmitter per receiver, free-space range zones, schema 3. **Done, reviewed, 91 tests green.** |
| v2 (target 1.6.0) | Terrain diffraction (ITU-R P.526 Bullington) on AW3D30, radial coverage map, objective default + per-receiver override, animation restore, compact cards, Link-budget drawer. **Designed and approved, not started.** |

## Read in this order

1. `REPOSITORY_BRIEF.md`: the original repo review (pre-1.4.0 baseline and the calculation rules to preserve).
2. `docs/superpowers/specs/2026-10-26-singapore-map-workspace-design.md`: the 1.5.0 design.
3. `docs/superpowers/specs/2026-10-26-link-workspace-v2-design.md`: **the current approved design.**
4. `docs/superpowers/plans/2026-10-26-link-workspace-v2.md`: **the next plan to execute** (7 tasks, test-first).
5. `docs/superpowers/plans/2026-10-26-singapore-map-workspace.md`: the executed 1.5.0 plan, for reference.
6. `design-exploration/`: the early research and prototype (`RESEARCH.md`, `ELEVATION_FEATURE_PLAN.md`, `antenna-workspace.html`).

## Decisions the user made (do not re-ask)

- **Sensors:** sensors are transmitters and receivers, up to **6**, each with a TX/RX toggle.
- **Objective:** a receiver's **intended transmitter** defaults to the **nearest**. The objective is a **workspace default plus per-receiver override**. An avoidance receiver has no intended link.
- **Shared settings:** all sensors share **one operating frequency**.
- **Map:** a terrain map of **Singapore**, not satellite, using MapLibre + OneMap Grey. Layout **B**: full-bleed map with floating cards, desktop-first.
- **Zones:** range zones use the **linked receiver's** settings.
- **Terrain:** terrain should **block links** (frequency-dependent), with a **radial coverage map** like `Reference Images/`.
- **Terrain only for now;** building heights later, via API or map-data upload.
- **Elevation source:** **ALOS AW3D30 v4** tiles `N001E103` and `N001E104` (user-downloaded).
- **Calculator merge:** the Link workspace will eventually absorb **all Calculator functionality**. Don't optimise the Calculator tab further.
- **Floating cards** must be smaller. The **link objective** and the **frequency-scaled transmit animation** must be retained.

## Calls made by the assistant (user may revisit)

**1.4.0 / 1.5.0**
- Flat ground by default in 1.4.0.
- The Calculator keeps its own objective toggle.
- Migrated sensors keep their Calculator names.
- Selecting a receiver shows its intended transmitter's zones.
- The interference zone is a red tint with an outline, not a hatch.
- Auto names (T#/R#) follow a role change.
- New sensors step outward from the map centre.
- The map chunk is lazy-loaded.
- Zone image updates are queued.
- 1.4.0 scenarios with negative total elevation are lifted so every height above ground is ≥ 0.

**v2**
- The coverage map follows the zone receiver's effective objective, with a "show all bands" toggle.
- Terrain loss is added to `otherLossDb` so `rf.ts` stays unchanged.
- New map scenarios use the `terrain` model; migrated ones use `free-space`.

## Known minor issues (deferred, from the 1.5.0 final review)

- Selecting a receiver can draw zones with another linked receiver's settings (the card names it).
- Failed elevation tiles are not retried until reload.
- The zone fill can be up to half a grid cell off its outline.
- The zone ground grid is resampled on unrelated renders.
- A typed separation over unloaded tiles drifts sub-metre after load; very large values can leave Singapore.
- "Fit all sensors" does nothing below about 740 px width.
- **Pre-existing on `main`:** a missing favicon (404), and empty nav buttons at 850 px and below.

## Open items needing the user

- **OneMap API terms:** confirm tile use from a public site (the terms text could not be retrieved; registration may be required).
- **JAXA AW3D30 terms:** confirm redistribution of derived tiles before committing `public/dem/`.
- **Merge/PR:** decide whether to merge the branch or open a PR (nothing pushed as of this handoff).

## Not in git (copy manually or re-create)

| What | Why not in git | How to restore |
|---|---|---|
| `Map/N001E103.zip`, `Map/N001E104.zip` (AW3D30 v4, ~8.7 MB) | The repo is public; JAXA's redistribution terms are unconfirmed | Copy from the old machine, or download from JAXA (https://www.eorc.jaxa.jp/ALOS/en/aw3d30/, free registration) tiles N001E103 and N001E104 into `Map/` |
| `public/dem/` (generated tiles) | Same reason | `corepack pnpm dem:build` once v2 Task 1 exists |
| `Reference Images/*.png` (coverage-map references), `design-exploration/uisp-reference.png` | Third-party screenshots | Copy manually; they are described in the v2 spec ("radial coverage like CloudRF/Radio Mobile") and the 1.5.0 spec |
| `.superpowers/` | Scratch: execution ledgers, brainstorm mockups | Not needed; rulings and minors are copied above |

## Environment setup on a new machine

- **Node and pnpm:** Node ≥ 22 (tested on 24.22.1). Use pnpm through corepack: `corepack pnpm install`, then `corepack pnpm test` (91 passing), `corepack pnpm build`, `corepack pnpm dev`.
- **Dev server:** serves at `http://localhost:5173/friis-rf-calculator/`. Earlier sessions used `--port 5199 --strictPort`.
- **GitHub CLI:** `gh auth login` (account `iLikeToLie`). On Windows, if `gh` is not on PATH in an already-open shell, use `"C:/Program Files/GitHub CLI/gh.exe"`.
- **Git identity:** set per repo: `git config user.name iLikeToLie` and `git config user.email 113039795+iLikeToLie@users.noreply.github.com`.
- **Claude Code plugins** used in these sessions (user-level, so reinstall them):
  ```
  claude plugin marketplace add obra/superpowers-marketplace && claude plugin install superpowers@superpowers-marketplace
  claude plugin marketplace add mksglu/context-mode && claude plugin install context-mode@context-mode
  claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill && claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill
  git clone --depth 1 https://github.com/Nutlope/hallmark && cp -R hallmark/skills/hallmark ~/.claude/skills/hallmark
  ```
  The workflow is superpowers: brainstorming, then writing-plans, then executing-plans (native), then a final fresh-reviewer pass, then finishing-a-development-branch.
- **Browser checks:** `scripts/e2e/drive-map.mjs` and `nudge-check.mjs` use `playwright-core` with the installed Chrome.
  - Install it in a scratch folder, not the project: `npm i playwright-core@1.49.1`.
  - Run with the dev server on port 5199: `node scripts/e2e/drive-map.mjs <screenshot-dir>`.
  - `drive-map.mjs` stubs OneMap and the elevation tiles, so it works offline.

## How to resume

- Start a session in the repo, on branch `feature/link-workspace-terrain`.
- Tell the assistant: "Execute `docs/superpowers/plans/2026-10-26-link-workspace-v2.md` natively."
- Task 1 needs the two AW3D30 zips in `Map/`.
