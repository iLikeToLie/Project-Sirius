# Terrain elevation — feature plan for review

22 October 2026 · Draft proposal only; elevation is not implemented.

## Intended outcome

Make elevation a meaningful variable: placing an antenna on a ridge or in a valley changes its ground elevation, its total antenna height, and the 3D separation used by the RF calculator. Contours and calculations must come from the same terrain model.

The current canvas is a separate prototype. This proposal targets a future extension of the React application, with a prototype checkpoint before integrating it into the repository. Animation changes requested alongside this plan are already applied independently: 1×–5× motion and no tempo readout.

## Recommended first version

Start with the existing imaginary landscape, converted into an explicitly labelled **synthetic elevation model in metres**. Make its elevation offset and relief scale editable. Keep a flat-terrain mode for comparison and compatibility. This lets us validate placement, height semantics and performance without adding a geographic map or external elevation service.

The source choice is a review assumption, not an agreed requirement. Alternatives:

| Approach | Benefit | Trade-off |
|---|---|---|
| Adjustable synthetic terrain first — recommended | Fast, offline, repeatable; fits the present workspace | Illustrative landscape, not an actual site |
| Real elevation grid first | Actual terrain for a selected site | Requires location, coordinate system, vertical datum, coverage and resolution handling |
| Both immediately | Can compare synthetic and real terrain | Larger first release and more validation work |

Do not derive elevation by inspecting the rendered contour image. A contour drawing is an output of the height model; it is not the source of truth.

## Elevation and interaction model

Each antenna stores X and Y in metres and **height above ground (AGL)** in metres. Ground elevation is sampled from terrain at that position. Total antenna elevation is derived, never independently edited:

`antenna elevation = terrain elevation(x, y) + antenna height AGL`

`ground separation = hypot(dx, dy)`

`3D separation = hypot(dx, dy, receiver elevation − transmitter elevation)`

The current Height field becomes **Antenna height above ground**. Show read-only Ground elevation and Total antenna elevation beneath it, with explicit units and datum. For synthetic terrain, use “local reference”, not “above sea level”. Negative ground elevation is valid; negative AGL is not.

Dragging an antenna preserves its AGL while resampling the ground underneath. Changing relief or offset updates both antennas and contours together. A common elevation offset must not change distance or RF power when relative geometry is unchanged. Relief scale zero produces flat terrain. Contour interval changes affect presentation only.

New controls: Terrain enabled, Elevation offset (m), Relief scale, and Contour interval (m). Ground elevation is derived from these controls; do not permit an isolated antenna ground-height override that contradicts the contour map. Editing individual terrain features can be a later terrain-editing feature.

### Editing distance

Keep the existing double-click distance interaction, with **3D separation** explicitly named. Keep Rx fixed, Tx AGL fixed, and move Tx along the current plan-view bearing. Because terrain changes along that line, the previous square-root formula is no longer sufficient.

Use bounded numeric root finding over the supported terrain extent to find Tx positions that achieve the requested 3D separation. If multiple solutions exist, select the one nearest the current Tx position. If no solution exists, explain it and leave the layout unchanged. For coincident planar endpoints, use a documented fallback bearing. Do not silently change AGL to force a solution.

Display ground separation alongside 3D separation so the reason for a difference is visible.

## Contours, RF and threshold boundaries

One terrain sampler supplies contour generation, endpoint heights and future path profiles. Give the synthetic model a fixed version and parameters so a saved scenario reproduces its terrain.

Phase one uses the existing Friis engine with **3D separation** and the existing user-entered gains and losses. Endpoint elevation alone does not account for a ridge obstructing the path. Label the output as a free-space estimate and retain the existing losses; do not invent an automatic terrain-loss value.

The three threshold references remain sensitivity, sensitivity + fade target, and interference threshold. Both objective modes retain their existing status rules.

**Uneven ground changes threshold geometry.** A circle assumes a fixed elevation difference. On a terrain surface, a candidate receiver at each X/Y has a different total elevation. Use the current receiver AGL at every candidate position, evaluate its 3D separation and received power, and extract each threshold as an isoline. Such boundaries can be irregular, disconnected, absent or clipped at the terrain edge. Label them “free-space threshold at receiver height X m AGL”; they are not terrain-shadowing coverage contours.

In flat mode, these isolines must match the existing analytic circles within the sampling tolerance. A single radial threshold-distance number is no longer a complete description on uneven terrain: retain each threshold's dBm level and slant-range reference, and explain that its ground boundary varies with terrain. `Fit all thresholds` fits known boundary geometry; it must not assume a constant radius in terrain mode.

## Proposed implementation sequence

1. **Height model and geometry.** Add a pure terrain sampler, terrain configuration and antenna placement types. Implement total elevation and 3D distance. Check flat parity, ridge/valley movement, negative ground elevations, invalid AGL and common-offset invariance.
2. **Linked controls and contours.** Generate labelled contours from that sampler. Add terrain controls, derived elevation readouts and ground/3D separation. Prove that changing contour interval or zoom never changes RF results.
3. **Placement and distance editing.** Connect dragging and the distance solver to the height model. Check exact requested separation, fixed Rx, fixed Tx AGL, multiple/no-root cases, terrain boundaries and cancellation.
4. **Terrain-aware threshold isolines.** Evaluate a bounded viewport grid using the same sampler and receiver AGL. Add explicit clipped/missing-boundary states. Check flat-circle parity and threshold values along generated curves, including both objectives.
5. **Persistence and integration.** Version scenario data, migrate legacy scenarios and integrate the accepted prototype behavior into the React app. Keep existing workbook calculation tests, sweeps, placements and import/export compatible. Legacy scenarios without terrain use flat ground so their saved results do not change silently.

Suggested React module boundaries, to confirm against the actual checkout before implementation:

- `src/types.ts`: terrain configuration and antenna placement types.
- `src/lib/terrain.ts`: terrain sampler, units, extent and missing-data handling.
- `src/lib/linkGeometry.ts`: AGL-to-total-elevation conversion, distance and distance solver.
- `src/lib/contours.ts`: shared isoline extraction for terrain and RF boundaries.
- `src/components/TerrainControls.tsx`: terrain inputs and elevation readouts.
- `src/components/PlacementWorkspace.tsx`: placement, viewport and linked interaction.
- `src/lib/rf.ts`: continue using the established power engine; pass derived 3D distance.

Each calculation module gets focused Vitest checks; interaction and import compatibility need browser checks as well.

## Performance requirements

Keep the current decorative canvas animation independent of all terrain and RF calculations. Cache terrain samples by terrain version, parameters, viewport and resolution. Sample endpoint height immediately during a drag; defer/coalesce contour and RF-boundary work. Use a worker for grid evaluation, discard stale jobs, and update the UI only with the latest result. Changing frequency invalidates RF boundaries, not terrain contours. Changing receiver AGL invalidates RF boundaries and geometry, not the ground model.

Start with a bounded coarse grid during interaction and refine after release. Performance acceptance should be measured on the user's browser: no terrain work in the animation frame loop, no growing job backlog during dragging, and clearly indicated refinement rather than blocked placement. Numerical contour accuracy must be reported from the selected grid resolution; visual smoothness is not evidence of precision.

## Subsequent phase: terrain obstruction and real data

After the elevation behavior is accepted, add a vertical path profile showing terrain, antenna tops and the direct ray. Distinguish clear, obstructed and unknown terrain paths separately from free-space link status. A quantitative diffraction model is a further engineering decision; do not equate a blocked ray with a fixed dB penalty. [ITU-R P.526](https://www.itu.int/rec/R-REC-P.526-16-202511-I) is a reference for that follow-up diffraction work.

For real terrain, introduce a raster adapter with metric coordinates, extent, resolution, interpolation, source metadata and a declared vertical datum. Missing cells must remain unknown, not zero. Bare-earth terrain excludes buildings and vegetation; model these separately if needed. [USGS DEM specifications](https://pubs.usgs.gov/tm/11b9/tm11B9.pdf) explain those data distinctions, and [USGS datum guidance](https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model) identifies coordinate/reference considerations.

## Review decisions

Recommended scope is adjustable synthetic elevation, 3D distance, linked contours and accurate free-space threshold boundaries first. Real data, path-profile obstruction and diffraction follow separately. Review the terrain source choice, AGL semantics and this first-release scope before implementing elevation.
