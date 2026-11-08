# Building heights and clutter: data sources and design

Status: **built on branch `claude/dreamy-bell-a3obkr` as web 1.10.0** (8 November 2026). Decisions B1–B3 were taken with the recommendations (hub D6–D8). Section 7 records where the build differs from this draft.

Hub decision D1 (6 Nov) chose building heights and clutter as the next feature, with the note "search and find open data sources for building heights". This document answers that note, then proposes how buildings would enter the propagation model.

## 1. What the workspace does today

- Terrain comes from ALOS AW3D30 v4, bundled as Terrarium tiles in `public/dem/` (zoom 10–14). The build script (`scripts/build-dem.mjs`) reads the `_DSM.tif` file, so the source is a **surface** model, not bare earth.
- Path profiles (`buildProfile` in `src/lib/propagation.ts`) sample the ground every 30 m, up to 511 intervals. Bullington diffraction (`bullingtonLossDb`) reduces all obstacles to one equivalent knife edge.
- Coverage (`computeCoverage` in `src/lib/coverage.ts`) walks radials over a ground grid of at most 480 columns across the view, with an incremental horizon edge.
- The Version 3 Friis engine (`src/lib/rf.ts`) is unchanged; terrain loss enters through `otherLossDb`. Buildings would enter the same way.

### Does the DSM already contain buildings?

Barely. Samples from the bundled zoom-14 tiles (script in `scripts/buildings/`; point positions are approximate):

| Point | DEM value |
|---|---|
| Raffles Place towers (about 200–280 m tall) | 10.2 m |
| Marina Bay Sands hotel tower (about 200 m) | 5.1 m |
| Padang, open field | 3.9 m |
| Gardens by the Bay lawn | 5.5 m |
| Punggol HDB blocks (about 50–60 m) | 21.0 m |
| Punggol Waterway Park | 16.7 m |

So AW3D30 in Singapore is close to bare earth with some low clutter. CBD towers add about 6 m, and HDB estates about 4 m. Adding building heights on top of the DSM would double-count only those few metres. Section 4.2 uses this.

## 2. Data sources found

| Source | What it gives for Singapore | Licence | Reachable from a cloud session | Verdict |
|---|---|---|---|---|
| **Overture Maps buildings** (release 2026-10-21.0) | 249,649 footprints in Singapore (OSM 128k, Google Open Buildings 88k, Microsoft ML 33k). **Measured here:** 2,817 have `height` and another 32,196 have `num_floors` only, all from OSM. Together that is **32.6 % of footprint area** and **44 % of footprints over 1,000 m²**. Heights: median 12 m, 90th percentile 56 m, max 245 m. Storeys: median 4, 90th percentile 16, max 70. | ODbL (buildings theme) | Yes: public S3 bucket `overturemaps-us-west-2` (the STAC catalogue host is blocked; read the release path directly) | **Use as the base.** Footprints are complete; heights are partial. |
| **OpenStreetMap** directly | Same tags as Overture's OSM part, possibly a few weeks fresher | ODbL | No (Overpass and Geofabrik are blocked) | Not needed; Overture already carries OSM heights. |
| **HDB Property Information** (data.gov.sg, dataset `d_17f5382f26140b1fdae0ba2ef6239d2f`) | `max_floor_lvl` for about 13,000 HDB blocks, by block number and street; updated April 2026 | Singapore Open Data Licence | No (data.gov.sg is blocked here); works from a local machine | **Use to fill HDB blocks.** Joins to footprints through **HDB Existing Building** (`d_16b157c52ed637edd6ba1232e026258d`, footprints with block numbers, updated every 2 months). |
| **NUS Urban Analytics Lab `hdb3d-data`** | 12,119 HDB blocks as LoD1.2 CityJSON, heights from storey counts | Credit NUS UAL, HDB, OSM contributors, OneMap | Yes (GitHub) | Fallback if data.gov.sg cannot be reached. Dated 2019, so newer estates are missing. |
| **GlobalBuildingAtlas** (TUM, 2025) | Global polygons and heights from satellite imagery; covers Singapore | **CC BY-NC 4.0** (non-commercial) | No (Hugging Face and mediaTUM are blocked) | Only if non-commercial use is acceptable. Accuracy in Singapore not checked. |
| **Google Open Buildings 2.5D Temporal** | Yearly 4 m rasters of building height, 2016–2023; Singapore is listed | CC BY 4.0 (per Google's page) | No (Earth Engine) | Heights are capped at 100 m, which cuts the CBD. Weak fit. |
| **URA Master Plan 2025 building height control** | Planning height limits, not built heights | Singapore Open Data Licence | No | Not a height source. Could cap estimates. |
| **OneMap 3D** | National 3D model | Not downloadable | n/a | Not usable. |

No open lidar or government LoD1 model for all of Singapore was found. The combination of **Overture (OSM heights and storeys) plus HDB storeys** is the best open, redistributable option. It should cover most residential high-rise and the tagged commercial towers. Coverage after the HDB join is still to be measured, because data.gov.sg could not be reached from this session.

## 3. Proposed data pipeline (offline, like `dem:build`)

A build script, `scripts/build-buildings.mjs` (or Python, if the Overture read stays in pyarrow), run by hand and committed output, as for the DEM:

1. **Read Overture buildings** for the DEM bounds from the release path on S3. Keep the footprint, `height`, `num_floors`, the source dataset and the class.
2. **Join HDB storeys**: match HDB Existing Building footprints to Overture footprints by overlap, then take `max_floor_lvl` from HDB Property Information by block and street.
3. **Resolve a height per footprint**, in this order: OSM `height`; HDB storeys × storey height; OSM `num_floors` × storey height; then the fallback chosen in decision B1. Storey height default 3.0 m for HDB and 3.5 m for other buildings, plus 3 m for the roof structure on HDB blocks. Record which rule set each height.
4. **Rasterise** height above ground into Terrarium tiles at zoom 15 (about 4.8 m pixels at Singapore's latitude) in `public/buildings/`, with a manifest: sources, release dates, coverage shares, storey heights and licence. Pixels outside footprints are 0.
5. **Attribution and licence**: the tiles are a derived database of ODbL data, so they are published under ODbL with "© OpenStreetMap contributors, Overture Maps Foundation" and the HDB/data.gov.sg credit. README and the map attribution are updated to match.

Size is not yet measured. A rough figure is a few MB for zoom 15, as most pixels are 0 and compress well. The script will report it.

## 4. Proposed model changes

### 4.1 Surface sampler

A new `createSurfaceSampler(ground, buildings)` returns ground plus building height. Profiles and coverage use it when buildings are on, and the plain ground sampler when they are off. `GroundAt` keeps its contract: `null` when the DEM is unknown. A missing building tile counts as no building, never as unknown ground.

### 4.2 Double-counting

Add building height to the DSM directly. Section 1 shows the DSM carries only a few metres of building mass, which is well inside the storey-count error. The alternative, a local-minimum filter to estimate bare earth, adds work and edge effects for little gain. Record this as a known bias in the guide.

### 4.3 Resolution

- `buildProfile`: when buildings are on, sample every 5 m and raise the 511-interval cap to 4,095 (a 20 km path at 5 m). Bullington's single pass is linear in samples, so this is cheap.
- Coverage: radial step 5 m inside about 2 km of the transmitter, then the current step. The ground grid for coverage needs the building raster at its own resolution rather than the 480-column view grid. The worker already holds per-source fields (`src/lib/multiField.ts`), so the building tiles go to the worker as well. Performance must be measured against the 1.9.0 figures (p95 input-to-frame 7.1 ms, worker peak 374.7 ms).

### 4.4 Sensors standing on a building

A sensor placed on a footprint at 1.5 m above ground would be inside the building, and every path would be blocked at its first sample. See decision B2.

### 4.5 Limits to state

- Bullington with one equivalent edge understates loss over many rooftops. Urban paths may need a multi-edge method (Deygout, or ITU-R P.526 multi-edge) later; this is out of scope for the first release.
- No through-building penetration, reflection or street-canyon effects. A blocked path is a screening flag, as with terrain.
- Heights from storeys are estimates. Buildings with no height use the B1 fallback, and the map should show where heights are measured, estimated or missing.

### 4.6 State and UI

- Scenario schema 7: `propagation.buildings: boolean` and, for B2, a per-sensor mount option. Older files load with buildings off.
- Link settings: a "Buildings" toggle beside the propagation model, enabled only in terrain mode.
- Map: an optional footprint layer shaded by height, with outlines for estimated heights. Path profile chart: buildings drawn as a separate fill above the ground.
- Drawer: diffraction loss stays one line; the profile shows which obstacle governs.

## 5. Open decisions

- **B1. Footprints with no height** (about two thirds of footprint area before the HDB join). (a) Leave them out: the DSM alone stands in. (b) Give them a default by class, for example 2 storeys for houses and 4 for others, drawn as estimated. (c) Use GlobalBuildingAtlas heights, which brings in a non-commercial licence. **Recommended: (b)**, because most of these are low-rise and leaving them out would make dense estates look open.
- **B2. A sensor inside a footprint.** (a) Mount it on the roof: its height above ground counts from the roof. (b) Keep it at ground level and ignore its own building. (c) A per-sensor choice, defaulting to roof. **Recommended: (c)**.
- **B3. Default state.** Buildings off by default for existing and new scenarios, or on for new ones. **Recommended: off at first**, until the coverage numbers after the HDB join and the performance figures are in.

Also needed: a way to fetch HDB data. Either run the build script on a local machine, or allow `data.gov.sg` and `api-open.data.gov.sg` in the cloud environment.

## 6. Reproducing the numbers

`scripts/buildings/overture_coverage.py` reads the Overture release for the Singapore bounds and prints the coverage figures in section 2. `scripts/buildings/dsm_samples.mjs` prints the DEM table in section 1.

## 7. As built (8 November)

- **Decisions:** B1 (b) class defaults, B2 (c) per-sensor mount with roof as default, B3 off by default.
- **HDB heights** come from the NUS Urban Analytics Lab `hdb3d-data` model (2019), joined to Overture by OSM way id, because data.gov.sg is blocked from cloud sessions. 9,488 footprints take that height. The data.gov.sg join stays open for blocks built after 2019 (for example newer Punggol blocks read the 14 m default).
- **Storey height** is 3.5 m for all OSM storey counts; the HDB model supplies its own heights.
- **Result:** 326,403 footprints in the build bounds (which include part of Johor). Area share by kind: measured 2.8 %, from storeys 30.0 %, class default 67.2 %. Tiles: 1,216 files, 6.2 MB, zooms 13–15. Spot checks: Marina Bay Sands hotel 207 m, Pinnacle@Duxton 150 m.
- **Own building at street level:** only the run of samples at the sensor's own building height is skipped. The first draft skipped every touching building, which dropped a 158 m tower beside a 33 m block in the CBD check.
- **Coverage:** ray step 5 m (at most 2,000 steps) with buildings; building grids use the max-pooled zoom 13–15 tiles nearest the grid cell size. Wide views therefore blur and slightly overstate buildings.
- **Performance:** one 720-radial coverage pass, 3.6 km, 480 × 300 grid: 92 ms with buildings, 21 ms without (Node, this session). Not yet measured in the browser against the 1.9.0 figures.
- **Checks:** 319 unit tests; production build; `scripts/e2e/buildings.mjs` passes (CBD path: diffraction 43.0 dB without buildings, 60.9 dB with the receiver at street level, 59.3 dB on its roof).
