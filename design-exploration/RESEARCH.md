# Interactive antenna placement — research and draft

22 October 2026 · Review artifact, not an application change.

## Goal and selected direction

Replace repeated manual distance entry with direct placement of Tx and Rx. The user selected a **scaled 2D workspace to explore separation in metres**. Keep precise entry available. Success means the user can drag either antenna and immediately understand the new distance, received power, and objective-specific status.

Open `antenna-workspace.html` for the interactive draft. The **Reference samples** button opens the comparison board, including a playable official Hamina demo and a screenshot of UISP. **Tweaks** switches among three arrangements without resetting positions.

## Real-world references

| Sample | Verified behavior | What to borrow | Limits of comparison |
|---|---|---|---|
| [Hamina Planner](https://www.hamina.com/planner) | Official page states that heatmaps update while access points move; official video shows drawing walls and placing APs. | Immediate feedback, direct placement, controls adjacent to the spatial task. | Its propagation, antenna and building models go beyond this calculator. |
| [UISP Design Center](https://ispdesign.ui.com/) | Live guest UI offers selecting a map point, starting a multipoint network, or adding a bridge link. | Large canvas, compact tools, explicit endpoints and link creation. | Actual geographic network planning; no claim that its RF computations match Friis. |
| [CloudRF web interface guide](https://cloudrf.com/documentation/04_web_interface_functions.html) and [overview](https://cloudrf.com/documentation/02-web-interface-intro.html) | Official documentation describes visual Tx/Rx placement alongside precise coordinates and a path-profile view. | Visual placement plus numeric precision, with results tied to the selected path. | Terrain and Fresnel profile calculations are separate capabilities. |

Hamina's [official placement demo](https://www.hamina.com/hubfs/planner/drawing-walls-placing-aps.mp4) is streamed in the reference board. The UISP screenshot is a genuine live guest welcome capture, not a reconstructed interface or an example of a completed network. CloudRF is supported by documentation; its authenticated app was not operated.

## Approaches considered

1. **Scaled 2D workspace — recommended and selected.** Cartesian coordinates in metres, optional grid snapping, direct manipulation, live results. No map account or tile provider. Best fit for separation studies.
2. **Calibrated floor plan.** Add an uploaded drawing, identify two points of known separation, then position antennas against that scale. More context, but requires calibration and a separate decision about wall losses.
3. **Geographic map.** Place actual sites using geographic coordinates. Useful outdoors; adds geographic distance handling, tile attribution, network dependency, and possibly provider costs. It still would not automatically add terrain analysis.

## Draft interaction

- Drag Tx or Rx using mouse or touch. Pointer capture preserves tracking and the original grab offset. Release fixes the antenna in place; no inertial movement that could alter engineering intent.
- Move focused antennas with arrows by 1 m or Shift+arrows by 10 m. Numeric coordinates remain available.
- Optional 25 m snapping. Grid labels and visible extent explain the scale.
- Zoom and Fit link change the view, not world coordinates or computed distance.
- Height is an explicit optional value. Separation is `sqrt(dx² + dy² + dz²)`; defaults use equal heights and match the repository's 500 m case.
- Received power, FSPL, margin, meter and status update immediately. The objective toggle follows the existing desired/avoidance logic.
- A dashed circle represents the objective boundary for the selected antenna heights. It is a threshold guide, not a terrain-aware coverage prediction. It can lie outside the visible extent; zoom out to see it.
- The draft aggregates the five existing losses into one 6.5 dB input for exploration. Production should retain the existing separate losses.
- Reset layout restores positions and viewport only. Draft sessions are deliberately unsaved; scenario import/export and existing application views are not part of this review artifact.

## Three layout studies

**01 — Canvas + inspector (recommended).** Most space goes to geometry. A stable right inspector keeps live power and selected antenna fields in one place. Strongest for repeated engineering edits.

**02 — Instrument strip.** Results and fields move below the canvas. Better horizontal canvas space and a clearer fit for narrower screens; requires more vertical scanning.

**03 — Canvas guidance.** A contextual instruction panel appears over the canvas alongside a slimmer inspector. More guidance for first-time users; overlay can occupy useful drawing space. This is an arrangement study, not a different propagation model.

## Design decisions and constraints

Mode: **extension study**, preserving the existing mission-control identity. Preserve calculations, objective behavior, navigation, defaults, local-storage key and existing scenario compatibility when eventually integrating.

Design Read: engineering prototype for laptop-distance viewing; calm instrument panel; canvas first, short precise labels, no decorative hero or unrelated dashboard modules. Variance 3/10 (familiar canvas/inspector), motion 2/10 (direct tracking only), density 7/10 (power + geometry + selected fields), asset dependence 2/10 (data and controls carry the draft), brand fidelity 10/10 (existing palette and monospaced vocabulary).

Use the repo's `#090b12` background, `#0f1420` surfaces, `#27344a` borders, amber selection, and existing semantic green/blue/red states. Use the existing SF Mono/Consolas fallback family, compact 6–10 px corners, measured spacing and minimal shadow. Color supports text status; it is not the sole signal. Numeric outputs use stable tabular figures. Small-screen layout stacks the inspector. No autonomous animation is needed.

## Skills and source transparency

- [Superpowers brainstorming](C:/Users/UserAdmin/.codex/plugins/cache/openai-curated-remote/superpowers/6.4.2/skills/brainstorming/SKILL.md): explore context, compare approaches, make a reviewable design before product implementation. This request explicitly authorized a draft; production implementation remains pending the user's choice.
- [Context-mode](C:/Users/UserAdmin/.codex/plugins/cache/context-mode/context-mode/1.0.169/skills/context-mode/SKILL.md): used sandbox execution to process source material and validate draft syntax/math. Its fetch-and-index route failed because `turndown` is missing; sandbox and normal browsing were used instead. No plugin installation changes were made.
- [Emil Kowalski apple-design](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md): immediate feedback, direct manipulation, preserved grab offset, pointer capture, accessible alternatives and restrained motion. Do not apply momentum to precision antenna placement.
- [Garden web-design-engineer](https://github.com/ConardLi/garden-skills/blob/main/skills/web-design-engineer/SKILL.md), including its redesign protocol and design-calibration references: preserve the existing system, define visual hierarchy, build a separate draft, compare layout arrangements.

The referenced Explain AI Skills chat was read. Its assistant replies only exposed content-reference placeholders. Its attached image identified the external skill repositories, which were consulted directly. No claim is made to have recovered the missing prose. No external skills were installed.

## Production integration proposal — for later review

Keep `calculateLink` authoritative. Introduce a placement component with world coordinates separate from viewport state, derive `distanceM` from antenna positions, and feed that value into the existing engine. Persist geometry alongside scenario state using an explicit schema/migration decision. Old scenarios with distance alone need a deterministic initial geometry. Numeric distance editing should reposition one endpoint along the current direction, or be explicitly labeled as a manual mode; avoid two conflicting distance sources.

Preserve all five losses, charts, placements, validation and accessible number controls. Save positions on completed movement rather than writing local storage on every pointer event. Decide whether height belongs in the first production iteration after reviewing this concept.

Meaningful integration checks: known workbook parity; 3–4–5 planar geometry and height separation; zoom invariance; keyboard and pointer movement; touching/overlapping endpoints; import of legacy scenarios; coordinate persistence; changing objectives; small-screen scrolling and touch gestures. This draft is not a substitute for those checks.

## Validation performed

### Latest adjustment: 1×–5× motion and hidden tempo readout

The visible tempo output was removed, including its explanatory animation copy from the frequency help. The same bounded nonlinear smoothstep now spans 100–500 CSS pixels/s (1×–5×). Canvas isolation, slider batching, culling and reduced-motion behavior remain in place. The animation regression checks now assert the requested upper endpoint of 500 pixels/s.

Elevation is separately proposed in `ELEVATION_FEATURE_PLAN.md`; no elevation behavior has been implemented as part of this adjustment.

### Performance revision: bounded decorative motion

The earlier six-second low-frequency transit and per-frame SVG mutations were removed. Signals now paint on a separate transparent canvas over the static SVG. Viewport geometry, RF validity/color and frequency speed are cached when application state changes. An animation frame only advances decorative travel and paints a small set of wave packets; it does not query layout, calculate RF results, rebuild legends or draw terrain.

Visual motion uses a smoothstep curve over logarithmic frequency, bounded to **100–180 CSS pixels per second** across 1 MHz–100 GHz. Consistent packet spacing keeps the low end active; the upper cap prevents frantic movement. Speed changes blend over approximately 120 ms without restarting packet positions. Motion stops when the document is hidden, the workspace is outside the viewport or reduced motion is requested. The canvas resolution is capped at 2× device scale.

Rapid slider input now renders at most once per display frame, using the latest frequency. Threshold circumferences entirely outside the viewport are hidden instead of asking the browser to paint enormous invisible circles at low frequencies; their engineering values remain in the legend.

`node design-exploration/check-animation.cjs` passes: speed bounds/monotonicity across 1,001 frequencies, invalid speed inputs, invisible-circle culling, 100 slider events combined into one render, 120 animation frames without RF/terrain/layout reads, and hidden/reduced-motion stopping. Browser checks confirmed both slider endpoints, visible wave packets at 1 MHz, and the 1.00×/1.80× tempo limits. No numerical browser FPS claim is made; the change isolates and bounds the decorative work rather than claiming animation has zero rendering cost.

### Latest review: realistic relief, continuous frequency and all thresholds

The frequency unit toggle has been removed. One logarithmic slider now spans **1 MHz–100 GHz**, giving equal space to each decade. The precise field accepts `433 MHz`, `5.8 GHz` or an unqualified GHz number; invalid or out-of-range entries leave the last valid setting intact. Animation transit remains bounded between 6.0 and 0.7 seconds over the full range. RF calculations still use GHz internally.

All three reference circles now appear in both modes: sensitivity (red dotted), required receive level = sensitivity + fade target (green dashed), and interference threshold (amber patterned). The legend lists their dBm levels and Tx-to-Rx separation at each boundary. Desired mode has two actual status transitions; avoidance has one. Inactive references are identified explicitly instead of inventing new screening statuses. `Fit all thresholds` adjusts the viewport to include the largest reachable horizontal radius. The circle radii account for antenna height difference; a threshold closer than that difference has no planar crossing.

The previous repeating sine-wave landscape has been replaced by two finite elongated ridges, a distant headland and a broad low-gradient valley/plain. This is synthetic reference artwork, not real surveyed terrain. Its sparse valley contours and tighter slopes follow [USGS topographic-map guidance](https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-map-symbol-guide). Curved ridgelines and finer contour sampling reduce the repeating hill and polygon artifacts. Elevation remains disconnected from the RF engine.

Validation: slider endpoints and every decade round-trip; precise MHz/GHz inputs and invalid strings; inversion of the RF model at all three thresholds (default sensitivity 24,522.91 m, required level 4,360.86 m, interference 2,452.29 m). Browser checks cover 100 GHz, all-threshold fitting and objective switching.

### Review revisions: editable separation and signal animation

The canvas distance label now opens an inline editor on double-click (or Enter/Space when focused). Apply moves Tx along its existing bearing from the fixed Rx, preserving both heights and the requested 3D separation. Exact entry bypasses grid snapping. If needed, the viewport fits the updated link. Escape/Cancel leave positions unchanged. Zero, negative, nonfinite, and distances smaller than the height difference are rejected. Coincident planar positions use the negative X direction as a deterministic fallback.

Animated wave packets travel from Tx to Rx in the current status color and follow the endpoints as they move. Following the next review, the pause control was removed: animation plays continuously, while reduced-motion preferences display static directional packets. This is a schematic animation, not a representation of propagation speed or antenna patterns.

Checked the distance-editor geometry for diagonal links, height offsets, fixed receiver, invalid entries and coincident endpoints. Browser double-click and Apply changed the default link from 500 m to exactly 1,000 m, moved Tx X from 250 to −250, and updated received power to −57.21 dBm.

### Review revisions: icon choices, frequency and terrain

**Antenna icons** opens four actual Lucide alternatives, each with a source link and a Try on canvas action: [broadcast tower](https://lucide.dev/icons/radio-tower) (recommended general RF symbol), [directional dish](https://lucide.dev/icons/satellite-dish) (directional links), [compact radio/router](https://lucide.dev/icons/router) (access-point hardware), and [site marker](https://lucide.dev/icons/map-pin) (location-first). No antenna-pattern model is implied by choosing an icon. Source SVGs and their ISC license are included in `icons/`. The existing canvas icon remains until a preview is selected.

Frequency controls now offer 1–999 MHz and 0.1–50 GHz with a numeric field and slider; values convert to the existing GHz RF input. Changing unit ranges preserves the physical value where possible, otherwise clamps it to the selected range with an explicit status message. Changing frequency affects both the RF engine and decorative pulse tempo. A continuous logarithmic visual mapping gives a 6 s transit at 1 MHz, 1.52 s at 999 MHz/1 GHz, 1.07 s at 5.8 GHz and 0.7 s at 50 GHz. The mapping is continuous and monotonic across units. This deliberately exaggerated animation cue does not imply that electromagnetic propagation speed increases with carrier frequency.

A separate deterministic imaginary contour layer now sits behind the grid. These lines have no elevation units and do not change antenna heights, distance, obstruction loss, LOS or power. A future elevation implementation needs a real or explicitly synthetic terrain model and a separate decision on how it affects calculations. Current contours are visual only. Grid spacing now adapts to screen width using 1/2/5 steps, fixing overlapping labels at wide extents.

Checked JavaScript syntax, monotonic pulse periods and adaptive grid density in code. Browser checks confirmed 999 MHz / 1.52 s and 1 MHz / 6.00 s, with matching RF input/result updates. Visually checked contours and the icon comparison board.

- JavaScript parses; no duplicate HTML IDs or missing directly referenced IDs found.
- Default 500 m calculation: −51.18795996 dBm, matching the repo baseline.
- Doubling distance changes received power by −6.02059991 dB.
- Loaded and visually inspected the draft in the browser.
- Actual receiver drag changed separation from 500.0 m to 354.9 m and power from −51.19 to −48.21 dBm; selected coordinates and link margin updated visibly.

This is a concept check, not a comprehensive browser or accessibility acceptance run. No production files, remote branches, commits, PRs, or deployments were changed.
