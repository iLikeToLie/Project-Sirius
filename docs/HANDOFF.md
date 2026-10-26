# Handoff — Friis RF calculator / Link workspace

Last updated 26 October 2026. Everything needed to continue this work on another machine is in this repo, except the items under "Not in git".

## Where things stand

| Item | State |
|---|---|
| Branch | `feature/link-workspace-terrain` (from `main` @ `92643ba`, web 1.31.2); v2 UI work is on `feature/v2-ui`, branched from it. Not merged, nothing pushed. |
| Web 1.4.0 | Plan-view Link workspace with synthetic terrain. Done; superseded by 1.5.0. |
| Web 1.5.0 | Singapore map workspace: OneMap Grey basemap, up to 6 TX/RX sensors, intended transmitter per receiver, free-space range zones, schema 3. **Done, reviewed, 91 tests green.** |
| Web 1.6.0 (v2) | Terrain diffraction (ITU-R P.526 Bullington) on AW3D30, radial coverage map, objective default + per-receiver override, animation restore, compact cards, Link-budget drawer. **All 7 plan tasks implemented; 121 unit tests green; browser drives `scripts/e2e/terrain-workspace.mjs` and `link-budget-drawer.mjs` pass.** Awaiting final fresh-reviewer pass and the open items below. |

## Read in this order

1. `REPOSITORY_BRIEF.md`: the original repo review (pre-1.4.0 baseline and the calculation rules to preserve).
2. `docs/superpowers/specs/2026-10-26-singapore-map-workspace-design.md`: the 1.5.0 design.
3. `docs/superpowers/specs/2026-10-26-link-workspace-v2-design.md`: **the current approved design.**
4. `docs/superpowers/plans/2026-10-26-link-workspace-v2.md`: the executed v2 plan (7 tasks, test-first).
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
- The Link-budget drawer shows the shared Other loss as typed; diffraction is listed separately and included in total losses.
- The drawer is collapsed by default and edits write back through `applyInputEdit`, like the Calculator.
- All map scenarios, new and migrated, use the `terrain` model (changed on 2026-10-27 at the user's request; migrated 1.4.0 scenarios still have terrain elevation off).

## Known minor issues (deferred, from the 1.5.0 final review)

- Selecting a receiver can draw zones with another linked receiver's settings (the card names it).
- Failed elevation tiles are not retried until reload.
- The zone fill can be up to half a grid cell off its outline.
- The zone ground grid is resampled on unrelated renders.
- A typed separation over unloaded tiles drifts sub-metre after load; very large values can leave Singapore.
- "Fit all sensors" does nothing below about 740 px width.
- **Pre-existing on `main`:** a missing favicon (404), and empty nav buttons at 850 px and below.

## Open items needing the user

- **Final review:** run the fresh-reviewer pass (superpowers workflow) over `feature/v2-ui`, then finishing-a-development-branch.

- **OneMap API terms:** confirm tile use from a public site (the terms text could not be retrieved; registration may be required).
- **JAXA AW3D30 terms:** the user confirmed on 2026-10-26 that publishing derived tiles is fine, so `public/dem/` is committed. The credit line shown in the app is "©JAXA, ALOS World 3D-30m (AW3D30)".
- **Merge/PR:** decide whether to merge the branch or open a PR (nothing pushed as of this handoff).

## Not in git (copy manually or re-create)

| What | Why not in git | How to restore |
|---|---|---|
| `Map/N001E103.zip`, `Map/N001E104.zip` (AW3D30 v4, ~8.7 MB) | The original JAXA data is not redistributed | Copy from the old machine, or download from JAXA (https://www.eorc.jaxa.jp/ALOS/en/aw3d30/, free registration) tiles N001E103 and N001E104 into `Map/` |
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
- **Browser checks:** `scripts/e2e/drive-map.mjs`, `nudge-check.mjs`, `terrain-workspace.mjs` and `link-budget-drawer.mjs` use `playwright-core`. The terrain and drawer scripts need `public/dem/` built, and accept `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` (a Playwright-installed Chromium works).
  - Install it in a scratch folder, not the project: `npm i playwright-core@1.49.1`.
  - Run with the dev server on port 5199: `node scripts/e2e/drive-map.mjs <screenshot-dir>`.
  - `drive-map.mjs` stubs OneMap and the elevation tiles, so it works offline.

## How to resume

- Start a session in the repo, on branch `feature/link-workspace-terrain`.
- The v2 plan is implemented. Next: the final review, the open items above, then merge or PR.
- Rebuilding the terrain tiles needs the two AW3D30 zips in `Map/` (`corepack pnpm dem:build`).
