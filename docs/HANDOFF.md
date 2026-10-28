# Handoff — Friis RF calculator / Link workspace

Last updated 28 October 2026. Everything needed to continue this work on another machine is in this repo, except the items under "Not in git".

## Where things stand

| Item | State |
|---|---|
| Repository | `github.com/iLikeToLie/Project-Sirius` (renamed from `friis-rf-calculator`; GitHub forwards the old repo URL). |
| Live site | **https://iliketolie.github.io/Project-Sirius/** — web **1.8.0** plus the elevation-notice fix (PR #6), deployed from `main` @ `a26a12d`. The old `iliketolie.github.io/friis-rf-calculator/` address returns 404. |
| Branch to work from | **`main`**. Everything is merged; there is no open feature branch. Start new work on a fresh branch from `main`. |
| Tests | 160 unit tests (`corepack pnpm test`), `tsc -b` clean, `vite build` with no warnings, four browser checks pass (see Environment). |

### Release history (newest first)

| Version | PR | What it added |
|---|---|---|
| fix | #6 | No false "Elevation tiles unavailable" notice when panning past Singapore: tiles outside the DEM are not requested, and a 404 is missing data, not an outage. |
| 1.8.0 | #5 | Distance labels on desired links; Map select (OneMap / Plain terrain); view preferences remembered per device (`usePref`); F toggles full screen; Link settings number fields readable and frequency scale labels at their log positions; sensor list stops above the legend; vendor chunks (MapLibre, charts, React); deploy workflow on current action majors (Node 24) and `ubuntu-24.04`. |
| 1.7.1 | #4 | Full screen button; resizable Link budget drawer (drag handle, keys, Expand); pan margin widened from 0.05° to 0.3°. |
| 1.7.0 | #3 | Consolidation: multi-transmitter receivers (`desiredTxIds`, schema 5, stacked Rx meters, drawer link pin), terrain coverage style toggle (Gradient / Bands), free-space rings hidden in terrain mode. |
| 1.6.0 | #1, #2 | Terrain diffraction (ITU-R P.526 Bullington) on AW3D30, radial coverage map, objectives, compact cards, Link budget drawer; then the CloudRF-style coverage gradient and terrain model for migrated scenarios. |
| 1.5.0 | — | Singapore map workspace: OneMap Grey basemap, up to 6 TX/RX sensors, free-space range zones, schema 3. |
| 1.4.0 | — | Plan-view Link workspace with synthetic terrain; superseded by 1.5.0. |

`VERSION_HISTORY.txt` has the full release notes for every version.

## Branches

- `main`: the only branch to build on. Contains every feature below.
- Merged and kept for reference: `feature/v2-ui` (#1), `worktree-coverage-aesthetic` (#2), `integrate/consolidation` (#3), `feature/workspace-layout` (#4), `feature/suggestions` (#5), `fix/elevation-offline` (#6), `feature/multi-link-receivers` (via #3).
- `feature/link-workspace-terrain` (`609b284`): **do not merge.** Despite being a late commit, most of its files are older copies of v2-ui or multi-link files, and it lacks the drawer and PR #2. Its one new change (hide rings in terrain mode) and its docs were ported by hand into #3.
- These branches can be deleted on GitHub once you no longer need them.
- `.claude/` (including local worktrees) is git-ignored; re-create worktrees with `git worktree add` if needed.

## Read in this order

1. This file, then `docs/BACKLOG.md` (open ideas, with done items marked).
2. `REPOSITORY_BRIEF.md`: the original repo review (pre-1.4.0 baseline and the calculation rules to preserve). Its URLs predate the rename.
3. `docs/superpowers/specs/2026-10-26-link-workspace-v2-design.md`: the approved v2 design (terrain, coverage, drawer).
4. `docs/superpowers/plans/2026-10-27-multi-link-receivers.md` and `docs/MULTI_LINK_REVIEW.md`: the multi-transmitter plan and its verification record.
5. `docs/superpowers/plans/2026-10-26-link-workspace-v2.md` and `docs/superpowers/specs/2026-10-26-singapore-map-workspace-design.md`: executed plans and earlier design, for reference.
6. `design-exploration/`: early research and prototype.

`CODEX_BRIEF.md` is historical (the multi-link and v2 Codex briefs).

## Code map (where things live)

- `src/lib/rf.ts`: Version 3 Friis engine. **Do not change**; terrain loss is added through `otherLossDb`.
- `src/lib/propagation.ts`, `coverage.ts`: Bullington diffraction and the radial coverage sweep (run in `src/workers/fieldWorker.ts`).
- `src/lib/sensors.ts`: pair evaluation, `resolveDesiredTxs`, `receiverSummary`, `worstLink`, `meterScale`.
- `src/lib/activeLink.ts`: the active pair the Calculator, sweeps and drawer show, with the optional `LinkPin`.
- `src/lib/state.ts`: load, validation and migration (schema 2 → 5). Saved key in `localStorage` is unchanged.
- `src/lib/signalColour.ts`: gradient colours and ranges.
- `src/components/map/MapWorkspace.tsx`: workspace state (prefs, full screen, drawer size, coverage style, basemap) and wiring.
- `src/components/map/SensorMap.tsx`: MapLibre map, zones, rings, link lines, distance labels, basemap visibility, `PAD` pan margin.
- `src/components/map/LinkBudgetDrawer.tsx`: drawer, resize handle (`DrawerSize`), link pin, `RxMeterStack`, `PathProfileChart`.
- `src/components/map/useElevationTiles.ts`: DEM tile cache; `DEM_BOUNDS` limits requests to the bundled tiles.
- `src/components/usePref.ts`: per-device view preferences (`friis-rf:pref:*` keys), safe when storage is blocked.
- `.github/workflows/deploy-pages.yml`: test, build with `VITE_BASE=/<repo name>/`, deploy on push to `main`.

## Decisions the user made (do not re-ask)

- **Sensors:** transmitters and receivers, up to **6**, each with a TX/RX toggle.
- **Objective:** a receiver has a set of **desired transmitters**, **Auto (nearest)** by default (1.7.0). The objective is a **workspace default plus per-receiver override**. An avoidance receiver shows the displayed pair against the interference threshold.
- **Coverage style:** terrain coverage can be drawn as a **gradient or as bands**, with a toggle (1.7.0).
- **Consolidation:** build on `main`; keep every feature; prefer the latest work, but not stale file copies.
- **Workspace room (1.7.1):** the map must allow centring a setup near the coast; full screen mode; a resizable or full-size Link budget drawer.
- **Releases:** the user reviews on the live site, so changes go out as PRs merged to `main` (which deploys). Ask before merging unless told to merge.
- **Shared settings:** all sensors share **one operating frequency**.
- **Map:** a terrain map of **Singapore**, not satellite, using MapLibre + OneMap Grey (Plain terrain is an option). Layout **B**: full-bleed map with floating cards, desktop-first.
- **Zones:** range zones use the **linked receiver's** settings.
- **Terrain:** terrain should **block links** (frequency-dependent), with a **radial coverage map** like `Reference Images/`.
- **Terrain only for now;** building heights later, via API or map-data upload.
- **Elevation source:** **ALOS AW3D30 v4** tiles `N001E103` and `N001E104`. Publishing the derived tiles is fine (`public/dem/` is committed).
- **Calculator merge:** the Link workspace will eventually absorb **all Calculator functionality**. Don't optimise the Calculator tab further.
- **Floating cards** must be smaller. The **link objective** and the **frequency-scaled transmit animation** must be retained.

## Calls made by the assistant (user may revisit)

**1.4.0 / 1.5.0**
- Flat ground by default in 1.4.0; the Calculator keeps its own objective toggle; migrated sensors keep their Calculator names.
- The interference zone is a red tint with an outline, not a hatch. Auto names (T#/R#) follow a role change. New sensors step outward from the map centre.
- The map chunk is lazy-loaded; zone image updates are queued.
- 1.4.0 scenarios with negative total elevation are lifted so every height above ground is ≥ 0.

**v2 (1.6.0)**
- The coverage map follows the zone receiver's effective objective, with a "Show all bands" toggle.
- The drawer shows the shared Other loss as typed; diffraction is listed separately and included in total losses. Edits write back through `applyInputEdit`.
- All map scenarios, new and migrated, use the `terrain` model (migrated 1.4.0 scenarios keep terrain elevation off).

**1.7.0 – 1.8.0**
- Schema 5: a saved `intendedTxId` becomes a one-item `desiredTxIds` list; unknown or duplicate ids are dropped; an empty list returns to Auto.
- Gradient is the default coverage style; bands are the pre-gradient look with outlines.
- Pan margin 0.3° (about 33 km) beyond Singapore.
- Drawer resize: minimum 120 px, arrow keys 40 px, Page keys 160 px, Home = minimum, End = Expand; desktop only (≥ 1001 px).
- View preferences live in `localStorage` per device, not in scenario files. Full-screen state is not remembered.
- Distance labels are HTML markers 14 px above the link midpoint (no glyph server for map text). They stay visible when panels are hidden.
- Plain terrain hides the OneMap layer; its attribution stays.
- Version numbers: 1.7.0 consolidation, 1.7.1 layout, 1.8.0 suggestions.

## Known minor issues (deferred)

- Selecting a receiver can draw zones with another linked receiver's settings (the card names it).
- Elevation tiles that fail for network reasons are not retried until reload (404s outside the DEM are now ignored).
- The zone fill can be up to half a grid cell off its outline.
- The zone ground grid is resampled on unrelated renders.
- A typed separation over unloaded tiles drifts sub-metre after load; very large values can leave Singapore.
- "Fit all sensors" does nothing below about 740 px width.
- A very tall Link budget drawer covers the lower part of the sensor list (the list scrolls).
- Pre-existing: a missing favicon (404), and empty nav buttons at 850 px and below.

## Open items

- **Old URL redirect:** create a public repo `iLikeToLie/friis-rf-calculator` with a redirect page to `/Project-Sirius/` (keep path and hash) and enable Pages. **First** run `git remote set-url origin https://github.com/iLikeToLie/Project-Sirius.git` in every clone, because creating that repo ends GitHub's forwarding of the old repo URL. This step was blocked by a permission prompt and is not done.
- **Backlog:** item 1 (label-free street basemap, Protomaps or a OneMap style) and item 5 (match the drawer Rx meter to the reference) are open. See `docs/BACKLOG.md`.
- **OneMap API terms:** confirm tile use from a public site (registration may be required).
- **Final review:** no independent reviewer pass has been run over 1.7.0 – 1.8.0; each PR was self-reviewed and verified with tests and browser checks.

## Not in git (copy manually or re-create)

| What | Why not in git | How to restore |
|---|---|---|
| `Map/N001E103.zip`, `Map/N001E104.zip` (AW3D30 v4, ~8.7 MB) | The original JAXA data is not redistributed | Only needed to rebuild `public/dem/`. Copy from the old machine, or download from JAXA (https://www.eorc.jaxa.jp/ALOS/en/aw3d30/, free registration) into `Map/` |
| `Reference Images/*.png`, `design-exploration/uisp-reference.png` | Third-party screenshots | Copy manually; described in the v2 and 1.5.0 specs |
| `.superpowers/`, `.claude/` | Scratch and local worktrees | Not needed |

## Environment setup on a new machine

- **Clone:** `git clone https://github.com/iLikeToLie/Project-Sirius.git` (use the new name so the remote survives the redirect repo above).
- **Node and pnpm:** Node ≥ 22 (tested on 24.22.1; CI uses 24). `corepack pnpm install`, then `corepack pnpm test` (160 passing), `corepack pnpm build`, `corepack pnpm dev`.
- **Dev and preview server:** locally the base path is `/friis-rf-calculator/` (CI sets `VITE_BASE` from the repo name). For browser checks: `corepack pnpm build`, then `node_modules/.bin/vite preview --host 127.0.0.1 --port 5199 --strictPort`.
- **GitHub CLI:** `gh auth login` (account `iLikeToLie`). On Windows, if `gh` is not on PATH, use `"C:/Program Files/GitHub CLI/gh.exe"`.
- **Git identity:** per repo: `git config user.name iLikeToLie` and `git config user.email 113039795+iLikeToLie@users.noreply.github.com`.
- **Browser checks** (`playwright-core`, not a project dependency):
  - Install it in a scratch folder: `npm i playwright-core@1.49.1`.
  - Set `PLAYWRIGHT_MODULE` to that package's `index.mjs` (on Windows as a `file:///C:/...` URL) and `CHROMIUM_EXECUTABLE` to Chrome (for example `C:/Program Files/Google/Chrome/Application/chrome.exe`).
  - With the preview on port 5199, run: `scripts/e2e/workspace-layout.mjs`, `terrain-workspace.mjs`, `link-budget-drawer.mjs`, `multi-link-receivers.mjs`. All four print `PASS`.
  - `drive-map.mjs` and `nudge-check.mjs` are older drivers that stub OneMap and elevation.
- **Claude Code plugins** used in these sessions (user-level, so reinstall them):
  ```
  claude plugin marketplace add obra/superpowers-marketplace && claude plugin install superpowers@superpowers-marketplace
  claude plugin marketplace add mksglu/context-mode && claude plugin install context-mode@context-mode
  claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill && claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill
  git clone --depth 1 https://github.com/Nutlope/hallmark && cp -R hallmark/skills/hallmark ~/.claude/skills/hallmark
  ```

## How to resume

1. Clone (or `git pull` on `main`) and run the setup above; confirm 160 tests pass.
2. Open the live site and note review comments.
3. Branch from `main`, implement, run the unit tests and the four browser checks, open a PR, and merge when the user approves; the merge deploys to Pages.
4. Add a `VERSION_HISTORY.txt` entry and bump `package.json` and the version chips in `src/App.tsx` for each release.
