# Singapore map workspace — design

26 October 2026 · Builds on branch `feature/link-workspace-terrain` (web 1.4.0, unmerged).

## Intent

Today's Link workspace places one Tx and one Rx on an abstract plan view in metres, over an illustrative synthetic landscape. The user wants to plan real sensor placements in **Singapore**: put sensors on a terrain map of the island (not satellite), see each transmitter's range, and read every result through the right objective. A receiver should communicate with the transmitter it is meant to hear and stay clear of interference from all the others.

The reference is the UISP Design Center (`design-exploration/uisp-reference.png`): a map filling the workspace, with compact tools floating on top. The earlier drafts (`thresholds-avoidance.png`, `draft-preview.png`) set the threshold rings, status colours and inspector vocabulary to keep.

## Goals

- A full-bleed map of Singapore in the Link workspace: OneMap Grey basemap with hillshade, PC-first.
- Up to **six sensors**. Each is switchable between **transmitter** and **receiver**.
- Every receiver has an **intended transmitter**, defaulting to the nearest transmitter. That pair is judged as **desired communication**. Every other transmitter it receives is judged as **interference avoidance**.
- Real ground elevation from a public elevation model. Antenna elevation = ground elevation + height above ground. 3D separation feeds the unchanged Friis engine.
- The selected transmitter's **range zones** are drawn as filled areas, using the settings of its linked receiver.
- The intended links and any interference above a threshold are visible on the map.

## Non-goals

- Small-screen or touch optimisation. Desktop only for now; it must not break on narrow screens, but it need not be good there.
- Terrain obstruction, diffraction, Fresnel clearance or building loss. The result stays a free-space estimate.
- Per-sensor frequencies, channels or filters. All sensors share one operating frequency.
- More than six sensors, satellite imagery, offline maps, address search.

## Anti-goals (a failure even if it works)

- Any change to the workbook Version 3 calculation results. The engine in `src/lib/rf.ts` stays authoritative and unchanged.
- An API key or secret in the shipped site. It is a public GitHub Pages build.
- Range zones that look like terrain-aware coverage predictions. They are free-space boundaries and must say so.
- Saved scenarios whose results change silently on upgrade.
- Interference judged against the wrong receiver's threshold.

## Constraints

- Static hosting on GitHub Pages (`vite.config.ts` base `/friis-rf-calculator/`). No backend.
- Map data needs network access and attribution: "©OneMap Singapore ODL v1.0" for the basemap and a credit for the elevation tiles. OneMap's API terms must be checked before release.
- Keep the local-storage key `friis-rf-planner-v3-state`, JSON import/export, the Calculator, the sweeps and the placement table working.
- Design system: `DESIGN.md` mission-control tokens in `src/styles.css`. Threshold colours follow the receiver meter: sensitivity blue, required level green, interference red.

## Approaches considered

| Approach | Trade-off |
|---|---|
| **1. MapLibre GL JS + OneMap Grey + AWS Terrain Tiles (Terrarium) for hillshade and elevation (chosen)** | Real streets, names and relief; no key; zoom to street level. Needs internet and attribution; elevation is about 30 m resolution and partly includes buildings and trees; adds roughly 250 KB of map code. |
| 2. Leaflet + OpenTopoMap | Lighter, with built-in topographic styling. But the styling is Europe-oriented and sparse for Singapore, the fair-use limits are tighter, and elevation still needs a separate source. |
| 3. A bundled, pre-rendered Singapore terrain image | Offline and free of third-party terms. But no streets or names, a blurry close zoom, and a manual regeneration step. |

**Chosen: 1.** It is the only option that gives a real, readable Singapore terrain map on static hosting without a key.

## Decisions made with the user

1. Sensors are transmitters and receivers. Up to six in this build, each with a TX/RX toggle.
2. The objective is **per receiver**. Its intended transmitter (default: nearest) is judged for communication; every other transmitter it receives is judged for interference.
3. All sensors share **one operating frequency**.
4. The map is a **terrain map of Singapore, not satellite**, built with approach 1.
5. Layout **B**: a full-bleed map with floating cards (UISP style), PC-first.
6. Range zones for a transmitter use the **settings of its linked receiver**.

## Design

### Sensor model

Each sensor stores a name, a role (`tx` or `rx`), latitude and longitude, height above ground, antenna gain and cable loss. It also stores the transmitter fields (power) and the receiver fields (sensitivity, fade-margin target, interference threshold, intended transmitter: `auto` or a sensor id). Both sets are kept on every sensor, so toggling the role never loses values.

New sensors take their values from the current Calculator inputs and default names T1…T6 or R1…R6. Shared settings stay on the scenario: operating frequency and the polarization, obstruction and other losses.

The `auto` intended transmitter resolves to the nearest transmitter by 3D separation. Ties are broken by sensor order.

### Pair evaluation

For every (transmitter, receiver) pair, build `LinkInputs` from the transmitter's power, gain and cable loss, the receiver's gain, cable loss and thresholds, the shared frequency and shared losses, and the 3D separation. Call `calculateLink`:

- with `desired` for the receiver's intended pair,
- with `avoidance` for every other pair.

Positions convert to metres on a local tangent plane centred near Singapore. At island scale the error is negligible next to the elevation data; the builder should state the error bound in a test.

### Map and elevation

- **Map:** MapLibre GL JS (pin an exact version). OneMap `Grey` raster tiles (EPSG:3857, about zoom 11–19), with the view bounded to Singapore and the sea around it.
- **Elevation:** AWS Terrain Tiles in Terrarium encoding, from a `raster-dem` source, give the hillshade layer. The same tiles are decoded (`(r·256 + g + b/256) − 32768`) and bilinearly sampled for sensor ground elevation and for the zone grids, so the shading and the numbers come from one model.
- **Missing elevation:** stays unknown, never zero. The sensor card says elevation is unavailable, and that sensor's pair results are marked accordingly.
- **Terrain elevation toggle:** the scenario has a "Use terrain elevation" setting. It is on for new map scenarios. When off, ground is flat at 0 m and only height above ground counts. It exists for comparison and for migration (below).

### Range zones

- The selected transmitter's zones are computed with its **linked receiver's** gain, cable loss, thresholds and height above ground:
  - **Several linked receivers:** the selected-sensor card has a "Zones for" picker, defaulting to the nearest.
  - **No linked receiver:** the nearest receiver's settings are used and the card says so.
  - **No receivers at all:** no zones.
- **Areas:**
  - **Acceptable** (at or above sensitivity + fade margin): green fill.
  - **Weak** (between sensitivity and the required level): amber fill.
  - **Interference threshold:** a red outlined, hatched area where a receiver with those settings would be at or above the threshold.
- The legend names each zone with its dBm level. It states "free-space boundary at Rx height X m above ground; terrain does not block the signal".
- Zones come from the existing grid and isoline approach (`src/lib/thresholds.ts`, `src/lib/contours.ts`), generalised to take any ground sampler. They are computed in the existing web worker, coarse while dragging and refined on release. On flat ground they must match the analytic circles, as the current tests require.

### Links on the map

- Each receiver's intended link is a solid line in its status colour.
- An interference pair is a dashed red line, shown only when received power reaches that receiver's interference threshold.
- The selected sensor's lines are emphasised; the others are dimmed.

### Layout B (desktop)

- **The map fills the workspace panel.** A top bar holds Fit all sensors, zoom, "Link settings" (frequency and shared losses) and the Use terrain elevation toggle. Attribution sits bottom right.
- **Sensors card (top left):** up to six rows, each with name, role and status.
  - A receiver row shows its link status, plus an interference count when any interferer is above threshold.
  - A transmitter row shows the number of receivers it serves.
  - "+ Sensor" places a new sensor at the map centre and is disabled at six. Each row can be deleted.
- **Selected-sensor card (top right):**
  - Name, TX/RX toggle, latitude/longitude, height above ground, and read-only ground and total elevation.
  - The role's radio settings.
  - For a receiver: the intended transmitter (`auto (nearest: T2)` or a named one).
  - Results: for a receiver, its intended link power and status and its worst interferer; for a transmitter, the receivers it serves and the ones it interferes with.
- **Interaction:**
  - Drag sensors with pointer capture and the grab offset preserved, as in today's workspace.
  - Arrow keys nudge the selected sensor by 1 m, or 10 m with Shift.
  - Typed latitude/longitude is the non-drag alternative.
  - Clicking a sensor selects it.

### Calculator, sweeps and placements

The **active link** is the selected receiver's intended pair, or the selected transmitter's nearest served receiver.

- The Calculator shows the active link and writes edits back to those two sensors and the shared settings.
- Its "Tx-to-Rx 3D separation" field moves the transmitter along its bearing, as now, with the solver generalised to the elevation model.
- The sweeps and the placement table read the active link's inputs; they are otherwise unchanged.

### Persistence and migration

- Bump to schema version 3, keeping the same storage key.
- A version 1.4.0 workspace (plan-view Tx/Rx in metres) migrates as follows:
  - Its two sensors are anchored at a fixed Singapore reference point using their metre offsets.
  - Their values come from the scenario inputs.
  - **Use terrain elevation** is turned off, so the separation and every result stay exactly as saved.
- Pre-1.4.0 scenarios pass through the existing migration first.
- Import validates every sensor field and rejects unknown roles.

### What happens to the 1.4.0 plan view

The map replaces the plan-view canvas. The synthetic terrain controls leave the UI, but the synthetic model stays in `src/lib/terrain.ts` for tests and as the flat/synthetic fallback the zone tests use.

## Testing

- **Pure-module tests first (TDD):**
  - projection round trip and error bound
  - Terrarium decode and bilinear sampling
  - nearest-transmitter resolution and ties
  - pair objectives (intended vs interference)
  - zone selection rules (several, none, nearest)
  - role toggling preserving values
  - migration keeping saved results identical
  - six-sensor limit
  - flat-ground zones equal to analytic circles
- **Workbook parity:** the existing Version 3 tests stay unchanged and green.
- **Browser check:** Playwright against the dev server, with map and elevation tiles stubbed locally so the check needs no network. It drags, toggles a role, changes the intended transmitter, checks that zones redraw, and confirms there are no console errors.

## Left to the builder

- The exact MapLibre version, tile URLs and zoom limits, and the attribution wording, once OneMap's terms have been checked.
- The tangent-plane reference point and its error test.
- Zone grid resolution, worker messaging and tile caching, with no terrain work in the animation frame and no job backlog while dragging.
- The sensor icon (Lucide radio tower) and the role colours within the existing tokens.
- Whether the signal-packet animation carries over to intended links (optional).

## Open before release

- Confirm OneMap's API terms and attribution for tile use from a public site.
- Confirm the AWS Terrain Tiles attribution text.
