# Friis RF Link & Interference Calculator

A browser-based RF link-budget and interference-screening tool using the Friis free-space model. **Web Version 1.5.0** is based on **workbook Version 3** and presents its objective-based RF tools through a science-forward mission-control interface.

**Live calculator:** [iliketolie.github.io/friis-rf-calculator](https://iliketolie.github.io/friis-rf-calculator/)

## Web calculator features

- Main link-budget calculator with FSPL, wavelength, received power, total losses, link margin, interference-threshold margin, and screening status.
- Link-objective toggle for **Desired communication** versus **Interference avoidance**, with status logic appropriate to each use case.
- Dynamic Tx-to-Rx graphic with antenna symbols, stylized beams, distance, endpoint power and gain, cable losses, propagation losses, status animation, receiver thresholds, and an Rx power meter.
- Objective-aware Rx meter: desired communication compares received power with sensitivity and the required receive level; interference avoidance compares it with sensitivity and the interference threshold.
- Link workspace on a map of Singapore (OneMap Grey with hillshading): place up to six sensors, each switchable between transmitter and receiver; drag, nudge or type their positions.
- Per-receiver objectives: each receiver's intended transmitter (nearest by default) is judged for communication, every other transmitter for interference; links and above-threshold interference are drawn on the map.
- Free-space range zones for the selected transmitter (acceptable, weak, interference) using its linked receiver's settings, computed in a web worker.
- Real ground elevation from Terrain Tiles on AWS; antenna elevation = ground + height above ground. All sensors share one operating frequency.
- Distance sweep with received-power, sensitivity, and interference-threshold curves.
- Antenna-gain sweep with a Tx/Rx selector and three editable comparison distances.
- Ten-row placement comparison with editable gains, distances, losses, rankings, and statuses.
- Automatic device-local saving plus JSON scenario import/export. Scenarios from 1.4.0 and earlier open as two map sensors with terrain elevation off and unchanged results.
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

This calculator is for preliminary engineering analysis. Friis assumes free-space propagation and antenna gains in the direction of the other antenna. The map needs an internet connection; map data ©OneMap Singapore ODL v1.0, elevation from Terrain Tiles on AWS (Mapzen; SRTM, GMTED, ETOPO1). Terrain changes antenna elevations and 3D separation only; ridges are not treated as obstructions and no diffraction loss is added. It does not replace detailed propagation modelling, antenna-pattern analysis, coordination studies, or field measurements. A threshold exceedance is a screening flag, not proof of harmful interference.
