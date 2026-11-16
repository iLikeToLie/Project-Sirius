# Directional antennas: design (web 1.12.0)

Date: 16 November 2026. Source of the decision: project hub **D10 = Directional antennas** (saved 16 Nov), backlog item 8.

## 1. Goal

A transmitter can be pointed away from victim receivers, and a receiver can be pointed at its desired transmitter, so that antenna direction becomes a mitigation alongside power, distance, frequency and polarization.

## 2. Scope

In scope:

- Per-sensor antenna: **Omni** (today's behaviour) or **Sector**, with azimuth, horizontal 3 dB beamwidth and front-to-back ratio.
- Pattern loss on every Tx→Rx pair (both ends), in the link budget, Rx meters, matrix, statuses and fix suggestions' inputs.
- Pattern loss on the coverage map (terrain and free-space), the Interference layer and the Placement layer.
- A beam wedge on the map marker, and an "Aim at" control.
- Schema 8 with migration; every existing scenario is unchanged (all antennas Omni).

Out of scope (recorded for later):

- Vertical pattern, downtilt and elevation-dependent gain.
- Imported pattern files (MSI/Planet), workbook Version 4 patterns.
- Drag-to-rotate on the map; a "rotate antenna" fix suggestion.
- Calculator tab changes (decision: the Calculator is not optimised further). `src/lib/rf.ts` is not changed: pattern loss enters through `otherLossDb`, like polarization and rejection.

## 3. Pattern model

Horizontal pattern of the 3GPP TR 36.814 sector antenna (also ITU-R F.1336 simplified form):

```
loss(φ) = min(12 · (φ / θ3dB)², FBR)        dB, φ = off-axis angle in [0°, 180°]
```

- `gainDbi` stays the **boresight** gain. Omni → loss is always 0.
- At φ = θ3dB/2 the loss is 3 dB; it reaches FBR and stays there.
- Ranges: azimuth 0–359.9° (true north, clockwise, normalised modulo 360), beamwidth 1–180°, FBR 0–60 dB.
- Defaults when switched to Sector: beamwidth 65°, FBR 25 dB, azimuth unchanged (0° on a new sensor).

Bearings use the workspace local plane (`toLocalM`), `atan2(dx, dy)`, the same convention as coverage radials (angle from north, clockwise).

## 4. Data model (schema 8)

```ts
interface AntennaPattern { kind: 'omni' | 'sector'; azimuthDeg: number; beamwidthDeg: number; frontToBackDb: number }
interface Sensor { …; antenna: AntennaPattern }
```

- Kept when toggling Omni/Sector, like the TX/RX role fields, so values are not lost.
- Migration: an absent `antenna` becomes `{ kind: 'omni', azimuthDeg: 0, beamwidthDeg: 65, frontToBackDb: 25 }`. An invalid present value rejects the sensor (strict, like the other fields).
- `AppState.schemaVersion` becomes 8. The `localStorage` key is unchanged.

## 5. Where the loss applies

| Place | Tx end | Rx end |
|---|---|---|
| Pair evaluation (`evaluatePairs`, drawer, matrix, meters) | bearing Tx→Rx vs Tx azimuth | bearing Rx→Tx vs Rx azimuth |
| Coverage map (selected Tx, zone receiver settings) | per radial / per cell | **receiver assumed aimed at the Tx** (no Rx loss) |
| Interference layer (reference receiver at each cell) | each interferer's pattern per radial | reference receiver's real azimuth, bearing cell→interferer |
| Placement layer (selected Tx at each cell; sources are receivers) | Tx's real azimuth, bearing cell→receiver | each receiver's pattern per radial from it |

Rule: a layer about a **specific real receiver** (Interference, Placement) uses both real azimuths; the coverage map shows the **transmitter's footprint** and assumes the receiver points at it (as coverage tools usually do). This is an assistant call the user may revisit.

Implementation consequence: `pairLinkInputs` adds pattern loss only when called for a real pair. Field builders (`interferenceSources`, `placementPlan`, the zone/coverage requests) call it **without** pattern loss and pass the patterns to the sweep, which applies them per radial (terrain) or per cell (free space), as

```
radialLoss(θ) = sourcePattern(θ) + cellPattern(θ + 180°)
```

where `θ` is the bearing from the source to the cell.

## 6. UI

- **Selected sensor card:** an "Antenna" row: Omni / Sector select; for Sector, Azimuth (°), Beamwidth (°), Front-to-back (dB) number fields and an **Aim at** select listing the other sensors (sets azimuth to the bearing toward the chosen one; for a receiver the first desired transmitter is offered first).
- **Map:** a Sector sensor's marker shows a translucent wedge of its 3 dB beamwidth, rotated to the azimuth (CSS transform on an SVG inside the marker element; fixed pixel radius, map-bearing aware). Omni markers are unchanged.
- **Link budget drawer:** a metric "Antenna pattern loss" with the note `Tx 23° off axis · Rx 4° off axis` (or "omni"), and the loss included in total losses.
- Free-space reference rings stay as boresight ranges; their label says "boresight" when the Tx is Sector.

## 7. Performance

Pattern loss per radial is one evaluation per radial (360 per source), not per step, so the terrain sweep cost is unchanged. In the free-space field path it is one `atan2` per cell per source. The multi-field and coverage request keys include the pattern fields so a rotation recomputes.

## 8. Tests and verification

- Unit: pattern function (0°, θ3/2 → 3 dB, FBR cap, symmetry, wrap at 360°), bearings, pair loss both ends, migration 7 → 8, invalid antenna rejected, coverage radial loss, multi-field key changes on rotation, interference/placement layers with a back-facing sector.
- Engine: every existing `rf.test.ts` result unchanged; every existing scenario test unchanged with Omni antennas.
- Browser: new `scripts/e2e/directional-antennas.mjs`: set a Tx to Sector, rotate it away from an interfered receiver, check the matrix entry drops by roughly FBR and the Interference layer changes; existing browser scripts still pass.

## 9. Decisions from review (16 Nov, in chat)

1. **Coverage map receiver:** assumed aimed at the transmitter (as designed). Interference and Placement layers use both real azimuths.
2. **Gain:** `gainDbi` stays as typed (boresight). The Sector fields show a hint with the typical gain for the beam, `10·log10(41253 / (θh · θv))` dBi; nothing is changed automatically.
3. **Vertical pattern and tilt: in this release.** `AntennaPattern` gains `verticalBeamwidthDeg` (1–90, default 10) and `downtiltDeg` (−20 to 45, positive is below the horizon, default 0). With `e` = elevation of the far end above the antenna's horizon (degrees):
   ```
   Av(e)  = min(12 · ((e + tilt) / θ3dB,v)², 20)
   loss   = min(Ah(φ) + Av(e), FBR)            (3GPP TR 36.814 combined pattern)
   ```
   Omni stays lossless in both planes. The elevation angle is taken at each end of a pair from the two antenna heights (ground + AGL, roof or street as now), and in the sweeps per ray step (terrain) or per cell (free space), so the vertical term is evaluated per step, not per radial. The cost is one `atan2` and a few multiplications per step.
4. **Extras in this release:**
   - **Rotate fix suggestion:** a `rotate` mitigation for an interfered receiver: the smallest azimuth change of the offending Sector transmitter that clears the victim while keeping every receiver it serves at or above its required level (a 1° search over ±180°). Omni transmitters get no suggestion.
   - **Aim tracking:** `AntennaPattern.aimAtId: string | null`. When set, the azimuth follows the bearing to that sensor whenever either one moves. Typing an azimuth, dragging the wedge or deleting the target clears it. The card shows "Tracking <name>".
   - **Drag to rotate:** a round handle at the tip of the wedge, shown on the selected Sector sensor. Dragging it sets the azimuth (to 1°, Shift for 5° steps) and does not move the marker. The handle is keyboard reachable: [ and ] rotate by 5°.

Schema stays **8** (unreleased); the new fields default when absent.

## 10. Built

To be filled when the work is merged.
