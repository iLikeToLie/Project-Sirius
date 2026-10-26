# Link workspace v2 — terrain-aware coverage, objectives and calculator merge

26 October 2026 · **Approved by the user 26 Oct.** Not yet implemented; plan: `docs/superpowers/plans/2026-10-26-link-workspace-v2.md`. It builds on web 1.5.0 (branch `feature/link-workspace-terrain`) and supersedes these parts of `2026-10-26-singapore-map-workspace-design.md`: the "free-space only" non-goal, the range-zone design, layout sizing, and the role of the Calculator.

## Why this revision

The user reviewed 1.5.0 and found:

1. **Terrain barely matters.** Elevation changes only the 3D separation. An obstructed path at high frequency should lose the link, as it would in practice.
2. **No radial range visual.** The references (`Reference Images/`) are terrain-shadowed coverage maps: signal computed outward along radials from the transmitter, coloured by signal band, with irregular shadow edges. The earlier drafts' dashed threshold rings are also missing from the map.
3. **Floating cards are too large** and cover the map.
4. **The link objective control is gone** from the workspace.
5. **The frequency-scaled transmit animation is gone.**
6. **Direction change:** the Link workspace is meant to become the single home for everything the Calculator does. Further work should optimise the workspace, not the Calculator.

## Goals

- **Terrain obstruction drives the result.** Received power includes diffraction loss from the path profile between Tx and Rx. It is frequency-dependent, so the same ridge or building costs more at 28 GHz than at 433 MHz.
- **Per-pair clearance class:** line of sight, Fresnel zone intruded, or obstructed. It appears with a path-profile view.
- **Radial coverage map** for the selected transmitter, in the style of the references. It is terrain-shadowed, banded by received power against the zone receiver's thresholds, and objective-aware. Dashed free-space threshold rings with distance labels sit on top as the "radial range" reference.
- **The link objective is back in the workspace** (see Open question 2 for its exact form).
- **The frequency-scaled transmit animation is back** along intended links, paused for reduced motion.
- **Compact, collapsible cards** that leave most of the map visible.
- **Everything in the Calculator becomes available in the workspace,** so the Calculator tab can later be retired.

## Non-goals (this phase)

- Clutter and land-use loss models, rain fade, multipath, antenna patterns.
- Sweeps and the placement table moving into the workspace. They come in a later phase.
- Mobile layout.

## Anti-goals

- Changing workbook Version 3 results when the model is set to Free space. Parity tests stay.
- Presenting a diffraction estimate as a measured or guaranteed result.
- A coverage map that silently treats missing elevation as flat.
- Animation work inside the coverage computation, or coverage work inside the animation frame.

## Propagation model (recommended)

| Option | Behaviour | Cost |
|---|---|---|
| Binary line-of-sight cut-off | "Blocked = no link" | Wrong at low frequencies; no grading |
| **ITU-R P.526 Bullington (delta-Bullington) diffraction over the path profile (recommended)** | Frequency-dependent loss from one equivalent knife edge; handles multiple obstacles conservatively; standard and cheap | Approximate for complex terrain |
| Deygout multi-edge | More detail per obstacle | Costlier, and can over-estimate |

Design (recommended):

- **Path profile:** sample ground elevation at about cell-size spacing between Tx and Rx. Include Earth curvature with effective radius k = 4/3. At 25 km mid-path the bulge is about 9 m, so it matters.
- **Bullington construction:**
  - The obstruction parameter is ν = h·√(2(d₁+d₂)/(λ·d₁·d₂)).
  - Knife-edge loss is J(ν) = 6.9 + 20·log₁₀(√((ν−0.1)²+1) + ν − 0.1) for ν > −0.78, and 0 otherwise.
- **Received power** = Friis power − diffraction loss. The existing obstruction/environment loss input remains as an additional user loss.
- **Clearance class:**
  - LOS when the 60 % first-Fresnel-zone radius is clear.
  - Fresnel-intruded when the direct ray is clear but that zone is not.
  - Obstructed when the direct ray is blocked.
- **Propagation model setting:** "Free space (workbook)" or "Terrain diffraction". It is per scenario, with terrain as the default for new map scenarios and free space for migrated ones.

**Data caveat:** the elevation tiles over Singapore are roughly 30 m SRTM-based surface data. They capture hills and some canopy but **not individual buildings** reliably. In Singapore most real obstructions are buildings (see Open question 1).

## Elevation data source

**User decision (26 Oct):** terrain only this phase. Building heights come later, through an API or a user map-data upload.

**Recommended architecture: a bundled Singapore DEM**, regardless of source.
- A dev-time script converts the chosen source into Terrarium PNG tiles (zoom 10–14, Singapore bounds only, roughly 30 m grid, a few MB) under `public/dem/`.
- The app reads them as it reads AWS today. That removes the runtime dependency on AWS, makes results reproducible, and versions the terrain with the app.
- The source is pluggable, so a user-uploaded DEM (GeoTIFF) can later use the same path. That fits the "map data upload" idea.

| Source | What it is | Licence / access | Fit for "terrain only" |
|---|---|---|---|
| ArcGIS "Contour lines (2014)" (in the user's web map) | 5 m contours over Singapore, bare earth, −40…160 m, 41 polylines | Public layer, **no licence stated**; owner is an education account | Best bare-earth match, but must be interpolated between contours (flat bands between 5 m levels), is from 2014, and needs **permission or a stated licence** before shipping |
| NASA SRTM GL1 (30 m) | Radar surface model from 2000 | Public domain | Includes canopy and some building height; ±5–10 m noise. AWS tiles over Singapore are largely this already |
| ALOS AW3D30 (JAXA, 30 m) | Optical stereo surface model | Free with registration; attribution "©JAXA" | Usually better vertical accuracy than SRTM; still a surface model (canopy, buildings) |
| "ALOS PALSAR 12.5 m DEM" (ASF RTC) | **Resampled SRTM/NED**, not new measurements | Free (NASA ASF) | No more real detail than SRTM, despite the finer grid |
| Copernicus GLO-30 (reference) | Recent surface model, generally the best global 30 m | Free with attribution | Surface model |

The satellite surface models count tree canopy as terrain (Central Catchment rises by tens of metres) and smear buildings in. That is closer to real RF obstruction, but it is not bare terrain.

### Decision: ALOS AW3D30 v4 (user-supplied, 26 Oct)

- **Supplied files:** the user downloaded `Map/N001E103.zip` and `Map/N001E104.zip`. These are JAXA AW3D30 (`ALPSMLC30`) 1° tiles covering 103–105°E, 1–2°N, which is all of Singapore. Each zip contains:
  - `_DSM.tif`: 3600×3600, 1″ (~30 m), Int16 little-endian, heights relative to the EGM96 geoid (≈ mean sea level), datum ITRF97/GRS80
  - `_MSK.tif`: valid / cloud-filled / sea mask
  - `_STK.tif`, `_QAI.txt`, `_HDR.txt`, `_LST.txt`
- **Quality, N001E103 QAI:**
  - RMS against ICESat 4.7 m (SRTM 5.9 m, ASTER 9.0 m)
  - 22.9 % of the tile cloud-masked and gap-filled from other DEMs
  - 40.7 % sea
- **Pipeline (dev-time script, committed):**
  - Read both DSM and MSK GeoTIFFs with `geotiff` (a dev dependency), crop to the Singapore bounds and mosaic the two tiles.
  - Set sea-masked pixels to 0 m.
  - Report the share of cloud-filled pixels inside Singapore, and expose it in the app as a data-quality note.
  - Encode Terrarium PNG tiles at zoom 10–14 into `public/dem/`, with a `public/dem/manifest.json` recording source, version, bounds, datum and fill ratio.
  - The raw zips stay out of git (`Map/` is git-ignored), because the GitHub repo is public and JAXA's redistribution terms are unconfirmed. `docs/HANDOFF.md` says how to re-download them. The derived tiles are committed only after the terms are confirmed; until then the build script regenerates them locally.
- **Use:** the app's elevation sampler and the MapLibre hillshade both read `public/dem/`. That gives one terrain model for display and calculation, and removes the AWS runtime dependency.
- **Attribution:** "©JAXA, ALOS World 3D-30m (AW3D30)". **To confirm before release:** JAXA's terms on redistributing derived tiles from a public site.
- **Known limitation:** AW3D30 is a surface model. Canopy (for example the Central Catchment) and some building mass count as terrain. That is accepted for this phase; a building model comes later.

## Radial coverage map

- **Grid:** a polar grid centred on the selected Tx: about 720 radials (0.5°) × range steps at about the view cell size, out to the free-space sensitivity range (capped at the view and the Singapore bounds).
- **Incremental Bullington:** along each radial, keep the running maximum obstruction slope, so each sample costs O(1). For 720 × 400 that is about 300k samples, which runs in the worker. It is coarse while dragging and refined at rest.
- **Values:** each sample holds received power for a receiver with the zone receiver's gain, losses and height above ground.
- **Bands:**
  - Desired communication: ≥ required level (green), between sensitivity and the required level (yellow), below sensitivity (none).
  - Interference view: ≥ interference threshold (red).
  - Low-alpha fills, as in the references.
- **Free-space rings:** dashed circles at the sensitivity, required and interference slant ranges, labelled with distance, drawn above the coverage as the radial range reference.
- **Rendering:** polar samples reprojected to a raster image over the view. Missing elevation shows as hatched or unknown, never as coverage.

## Workspace UI changes

- **Cards:**
  - **Sensor list:** about 220 px wide, collapsible to an icon rail.
  - **Selected sensor:** about 300 px wide, with tabs for Sensor, Link and Coverage, and a collapse control.
  - **Link settings:** becomes a popover.
  - Cards dim while a sensor is dragged, and a "hide panels" toggle clears the map.
- **Link budget drawer (bottom, collapsible):** the full Calculator for the active link, with every input, FSPL, diffraction loss, total losses, power, margins, the Rx power meter, the objective explanation and a **path-profile chart** (terrain, Earth bulge, direct ray, Fresnel zone, obstruction point). This is the merge target that replaces the Calculator tab.
- **Animation:** a canvas overlay synced to map render events. Packets travel along intended links in their status colour at 100–500 px/s (log-frequency smoothstep, as in 1.4.0), and stop when hidden or with reduced motion.
- **Objective control:** visible in the selected-receiver card and the drawer (form per Open question 2).

## Calculator merge (phased)

1. **This phase:** the drawer provides every Calculator capability for the active link. The Calculator tab stays as-is and receives no new work.
2. **Next phase:** sweeps and placements become drawer tabs.
3. **Then:** the Calculator tab is retired, and workbook parity tests run against the workspace's free-space mode.

## Open questions (only the user can answer)

1. ~~Buildings~~ **Decided:** terrain only this phase; buildings later via API or upload. **Still open:** which elevation source (see "Elevation data source").
2. **Decided (user, 26 Oct): workspace default plus per-receiver override.** A workspace-level default objective (`desired` or `avoidance`) sits in the map toolbar. Each receiver has `objective: 'default' | 'desired' | 'avoidance'`.
   - **Desired:** its intended transmitter (nearest by default) is judged for communication, and every other transmitter for interference.
   - **Avoidance:** it has no intended link; every transmitter must stay below its interference threshold.
3. **Builder's call (not asked):** the coverage map follows the zone receiver's effective objective. Desired shows green/yellow bands plus a red outline for the interference threshold; avoidance shows the red interference band plus a faint sensitivity outline. A legend toggle "show all bands" displays both.

## Revised phase order (for the next plan, after approval)

1. **Propagation core:** path profile, Earth curvature, Bullington diffraction, clearance class, model setting. Pure TDD, with ITU reference values; J(0) ≈ 6.0 dB is a check.
2. **Pair evaluation:** uses the model; free-space parity stays; migration sets free space.
3. **Radial coverage worker:** polar sweep, bands, raster reprojection, free-space rings.
4. **Workspace UI:** compact cards, objective control, animation restore, link-budget drawer with path profile.
5. **Calculator-merge groundwork:** the drawer covers every Calculator capability.
6. (If Open question 1 says yes) **building heights** data source and its attribution.
