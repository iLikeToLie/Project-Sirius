# Backlog: Link workspace

Items recorded from review of the live site (web 1.6.0). Not yet implemented.

## Decisions

- **Item 1:** keep one OneMap map with labels hidden if OneMap offers a label-free style. If it does not, switch to another basemap, visually only. The JAXA elevation data must remain in either case.
- **Item 3:** the Rx meter shows one bar per desired transmitter, sorted from best to worst link.

## 1. Restyle the basemap

- **Problem:** the OneMap Grey basemap shows road names and MRT lines, which clutter the workspace.
- **Want:** a cleaner map aesthetic without labels or transit lines. Keep one OneMap map if possible. Otherwise use another basemap, visually only. JAXA elevation must remain as the terrain source and hillshade.

### Findings (checked 2026-10-27)

- **OneMap:** the current `Grey` tile (`https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png`) is a raster with road names and MRT lines baked in. Hiding them is not possible on the client. `docs.onemap.sg` did not resolve when checked, so I could not confirm whether OneMap publishes a label-free style. **Unverified; check the OneMap developer portal before relying on it.**
- **Protomaps (open source, OSM data):** `@protomaps/basemaps` builds a MapLibre style with `layers(source, flavor, options)`. Labels are added only when a `lang` option is passed; `labelsOnly` draws labels alone. Omitting `lang` should give a geometry-only basemap with no text, so no glyph server is needed. Data comes from a PMTiles file, which can be a Singapore extract. Attribution: Protomaps and © OpenStreetMap. **To verify:** that omitting `lang` removes all symbol layers in the installed package version.
- **OpenFreeMap (open source, OSM data):** a free public instance with no key, styles `liberty`, `bright`, `positron`, `dark`. Labels are in symbol layers that could be removed from a style JSON. The public service is provided as-is and may change, so self-hosting is safer for a long-lived app. **To verify:** the style JSON contents and the terms.

### Recommended plan

1. Verify OneMap's options first (a short check). If a label-free OneMap style exists, use it and stop here.
2. Otherwise use Protomaps: build a Singapore PMTiles extract, self-host it with the app (or a static file in `public/`), and style it with `@protomaps/basemaps` using a light or grayscale flavor and no `lang`.
3. Keep the existing `hillshade` layer on the JAXA DEM source, unchanged.
4. Keep the attribution for the chosen basemap and for JAXA.
5. Check the rendered result at the zoom levels the workspace uses (10.5 to 19) and in dark mode, and compare with the existing canvas colours.
- **Notes:** the basemap is the `onemap` raster source in `src/components/map/SensorMap.tsx` (`ONEMAP_TILE_URL`). Options to evaluate: a label-free OneMap style if one exists, a different tile provider (check its terms and attribution), or a plain canvas-coloured background with only the terrain hillshade. The JAXA hillshade and the ©OneMap attribution must stay correct for whichever base is chosen.

## 2. Hide range circles in terrain mode

- **Problem:** the green and red dashed range rings around a transmitter are free-space reference ranges, so they no longer mean anything once terrain diffraction is on.
- **Want:** the dashed rings turn off when the propagation model is terrain diffraction. Keep them in free-space mode.
- **Notes:** the rings are the "free-space reference ranges" in the coverage layer (see `SensorMap.tsx` and `SelectedSensorCard.tsx`). Gate them on the scenario's propagation model.

## 3. One receiver linked to multiple transmitters

- **Problem:** each receiver currently has one intended transmitter, so it can link to only one.
- **Want:** a receiver can receive from several transmitters, as in real comms (for example, listening to several stations). Each receiver should be able to choose its set of desired transmitters.
- **Notes:**
  - Today each receiver has one intended transmitter, the nearest by default, and every other transmitter it hears is judged for interference. This needs a change to the data model (`src/types.ts`, scenario schema and migration from 1.4.0/1.5.0/1.6.0 files in `src/lib/state.ts`) and to the link evaluation in `src/lib/sensors.ts`.
  - Rx meter: one bar per desired transmitter, sorted from best to worst link.
  - Decide whether a transmitter heard by a receiver counts as desired or interference when it is in the desired set.

## 4. Show distance on desired-link lines

- **Want:** in desired-communication mode, each link line drawn on the map shows its distance as a label.
- **Notes:** the lines are the `intended` links from `MapLink` in `SensorMap.tsx`. Show the label at the midpoint, in the same units the workspace already uses (check the existing distance formatting before choosing km or m).

## 5. Rx power meter in the Link budget tab

- **Want:** add the Rx power meter graphic to the Link budget drawer at the bottom, as in the reference below.
- **Reference (from the review screenshot):**
  - Title "Rx power meter" with the current value "-74.24 dBm" in bold blue on the right.
  - A horizontal bar with a scale from -95 dBm (left) to -55 dBm (right). The filled portion goes from the left to the current level, with a dark-to-blue gradient.
  - A blue tick at the sensitivity level (-85 dBm) and a red tick at the interference level (-65 dBm).
  - Labels under the bar: "Sensitivity -85.00 dBm" in blue on the left, "Interference -65.00 dBm" in red on the right.
- **Notes:** this is the same meter that already exists for the active link. Check that the link budget drawer's meter matches the reference, including the objective-aware reference lines (desired vs avoidance). The screenshot file is in a temporary folder that the session cannot read, so it is not copied into the repo.

## 6. Link settings: number fields and frequency scale

- **Problem:** in the Link settings card, the spinner arrows of the number inputs sit on top of the values, so the Polarization, Environment and Other dB fields cannot show their numbers (the first digit is hidden). The fields are too narrow for the value plus the unit and spinner.
- **Problem:** the operating frequency slider's scale labels (1 MHz, 1 GHz, 100 GHz) do not match the slider's position. The 2 GHz thumb sits well past the midpoint, so the scale looks wrong. Check whether the slider is logarithmic and, if so, label it to match.
- **Want:** every value is fully readable, with the spinners hidden or moved clear of the digits and the unit kept visible. The frequency slider and its labels agree, so a reader can place any value on the scale.
- **Notes:** the card is `src/components/map/LinkSettingsCard.tsx` (the scale labels are the `range-scale` element). Check the same fields in the Link budget drawer and the Calculator tab for the same overlap.
