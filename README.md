# Friis RF Link & Interference Calculator

A browser-based RF link-budget and interference-screening tool using the Friis free-space model. **Web Version 1.8.0** is based on **workbook Version 3** and presents its objective-based RF tools through a science-forward mission-control interface.

**Live calculator:** [iliketolie.github.io/Project-Sirius](https://iliketolie.github.io/Project-Sirius/)

## Web calculator features

- Main link-budget calculator with FSPL, wavelength, received power, total losses, link margin, interference-threshold margin, and screening status.
- Link-objective toggle for **Desired communication** versus **Interference avoidance**, with status logic appropriate to each use case.
- Dynamic Tx-to-Rx graphic with antenna symbols, stylized beams, distance, endpoint power and gain, cable losses, propagation losses, status animation, receiver thresholds, and an Rx power meter.
- Objective-aware Rx meter: desired communication compares received power with sensitivity and the required receive level; interference avoidance compares it with sensitivity and the interference threshold.
- Link workspace on a map of Singapore (OneMap Grey with hillshading): place up to six sensors, each switchable between transmitter and receiver; drag, nudge or type their positions.
- Per-receiver objectives: each receiver has a set of desired transmitters (Auto picks the nearest), judged for communication with one Rx meter bar each; every other transmitter is judged for interference; links and above-threshold interference are drawn on the map.
- Terrain diffraction (ITU-R P.526 Bullington knife edge, 4/3 Earth radius) over ALOS AW3D30 ground, with a radial coverage map for the selected transmitter (acceptable, weak, interference) using its linked receiver's settings, computed in a web worker and drawn as a continuous signal gradient or as threshold bands. A Free space model option remains, with free-space range rings shown only in that model.
- Workspace default objective (Desired / Avoidance) with per-receiver overrides, a frequency-scaled transmit animation, compact collapsible cards, and a Link-budget drawer holding every Calculator input and result plus a path-profile chart.
- Antenna elevation = ground + height above ground. All sensors share one operating frequency.
- Distance sweep with received-power, sensitivity, and interference-threshold curves.
- Antenna-gain sweep with a Tx/Rx selector and three editable comparison distances.
- Ten-row placement comparison with editable gains, distances, losses, rankings, and statuses.
- Automatic device-local saving plus JSON scenario import/export. Scenarios from 1.5.0 and earlier open with the terrain model; 1.4.0 and earlier open as two map sensors with terrain elevation off, so over flat ground their results are unchanged.
- Responsive layout for desktop, tablet, and mobile browsers.
- Mission-control interface with monospaced editorial typography, deep-space surfaces, solar-amber emphasis, compact instrument controls, and accessible status colours.
- Automated tests against known Version 3 workbook results.

The objective toggle changes status interpretation only; it does not change the Friis power calculation. The web version intentionally does **not** include the Version 4 antenna-pattern and off-axis-gain model.

## Run locally

Prerequisites: Node.js 22 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

The terrain tiles in `public/dem/` are generated from JAXA AW3D30 and committed. To rebuild them, put the AW3D30 v4 tiles `N001E103.zip` and `N001E104.zip` (JAXA, free registration) in `Map/` and run `pnpm dem:build`.

To verify and build the production site:

```bash
pnpm test
pnpm build
```

## Deployment

Pushing to `main` runs the GitHub Actions workflow in `.github/workflows/deploy-pages.yml`. It tests the RF calculation engine, builds the static site, and deploys the `dist` output to GitHub Pages.

## Workbook releases

The repository retains the four Excel releases and [VERSION_HISTORY.txt](VERSION_HISTORY.txt). The source used for the web implementation is [Friis_RF_Link_and_Interference_Calculator_v3.xlsx](Friis_RF_Link_and_Interference_Calculator_v3.xlsx).

## Engineering scope

This calculator is for preliminary engineering analysis. Friis assumes free-space propagation and antenna gains in the direction of the other antenna. The map needs an internet connection; map data ©OneMap Singapore ODL v1.0, elevation ©JAXA, ALOS World 3D-30m (AW3D30). In terrain mode a single Bullington knife-edge diffraction loss is added per path; building heights, clutter, foliage, rain and multipath are not modelled. It does not replace detailed propagation modelling, antenna-pattern analysis, coordination studies, or field measurements. A threshold exceedance is a screening flag, not proof of harmful interference.

### Light basemap

The map selector offers **Light**, **OneMap** (the default), and **Plain terrain**.
Light uses a locally maintained, recoloured copy of [OpenFreeMap Liberty](https://tiles.openfreemap.org/styles/liberty), copied on 31 October 2026 to `public/styles/sirius-light.json`.
Vector tiles and fonts are served by OpenFreeMap; the original sprite URL is retained as provenance, but icons are removed and no sprite download is needed.
The map credits OpenFreeMap, OpenMapTiles and OpenStreetMap while Light is visible.
Light's geometry sits below hillshade and RF overlays; its labels sit above them.
Parks are muted to distinguish them from RF coverage. Buildings are flat footprints.
The preference is remembered on this device. Repeated provider errors (three per selection),
or a source still loading after 15 seconds, switch to OneMap and display a notice.
Selecting Light again retries it. Elevation data and RF calculations are independent of this choice.
