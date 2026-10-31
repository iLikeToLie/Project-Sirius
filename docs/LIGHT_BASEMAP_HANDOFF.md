# Project Sirius: Light basemap handoff for Codex

Oct 31, 2026 · @Gabriel · amended after the branch was created

## Goal and scope

Add a new **Light** basemap to Project Sirius: a recoloured OpenFreeMap vector style with an Apple Maps-inspired look. This is a visual change only. JAXA ALOS AW3D30 elevation data, terrain sampling and RF calculations must give identical results before and after.

- **In scope:** the new basemap option, its style file and palette, layer ordering, the basemap selector, attribution and a tile-failure fallback.
- **Not in scope:** RF models, DEM tiles, `src/lib/elevation.ts` logic, or a wider redesign of the app's interface.

## Branch

All work goes on `feature/light-basemap`, which already exists and was created from `main` at commit `edb7679`. Do not merge or push to `main`.

## Decisions made

Gabriel chose Option 1: OpenFreeMap, recoloured. Sirius is personal and non-commercial, so free, keyless hosting was the priority.

| Decision | Choice | Why |
| --- | --- | --- |
| Tile provider | OpenFreeMap public instance | Free, no API key, no account, no request quota |
| Starting style | OpenFreeMap Liberty, stripped down | Liberty is actively maintained; the older OpenMapTiles styles such as Positron are abandoned upstream |
| Style delivery | A modified copy of the style JSON committed to the repo | A remote style URL can't be recoloured; tiles, fonts and icons still load from OpenFreeMap |
| Option name | Light | Sits alongside the existing `onemap` and `plain` options |
| Existing basemaps | Keep OneMap and plain selectable | OneMap is Singapore's official map data and serves as a fallback |
| Attribution | Show OpenStreetMap and OpenFreeMap credits when Light is active | Required by the data licence |

OpenFreeMap's public service is provided as-is and may change, so the tile-failure fallback in the steps below is required, not optional.

## Starting point in the repo

Confirmed on the branch at commit `edb7679`.

| File | What it holds |
| --- | --- |
| `package.json` | Already depends on `maplibre-gl` 4.7.1 |
| `src/components/map/SensorMap.tsx` | Creates the map, the OneMap raster source, hillshade, sensor markers, links, range rings and coverage overlays |
| `src/components/map/MapWorkspace.tsx` | Owns the persisted basemap preference and the toolbar selector |
| `src/components/map/SignalOverlay.tsx` | A further overlay to preserve |
| `src/lib/elevation.ts` | Loads local DEM tiles, independent of the basemap |
| `src/styles.css` | Map workspace, marker, control and attribution styling |
| `README.md` | Commands, terrain data and the deploy workflow |

Key details:

- The basemap is a raster source from `https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png` (`ONEMAP_TILE_URL` in `SensorMap.tsx`), with `raster-brightness-max: 0.92`.
- The basemap preference is `usePref<Basemap>('basemap', 'onemap', oneOf('onemap', 'plain'))` in `MapWorkspace.tsx`, and the selector is a `<select aria-label="Basemap">` in the toolbar.
- DEM tiles load from `import.meta.env.BASE_URL + 'dem/{z}/{x}/{y}.png'` in Terrarium encoding.
- The README specifies Node.js 22+, pnpm, `pnpm test` and `pnpm build`. Pushing to `main` runs tests and deploys to GitHub Pages.
- Read the repo's agent instructions and map design notes first: `CODEX_BRIEF.md`, `DESIGN.md`, `docs/superpowers/specs/2026-10-26-singapore-map-workspace-design.md` and `docs/superpowers/plans/2026-10-26-singapore-map-workspace.md`.

## Starting colour palette

These are the colours from the approved mock-up. Treat them as a starting point to tune against screenshots, not fixed values.

| Map element | Fill | Outline or casing |
| --- | --- | --- |
| Land | `#F6F4EF` | none |
| Water | `#A9D3F0` | none |
| Parks and green space | `#CDE7C1` | none |
| Buildings | `#ECE8E1` | `#DCD6CC` |
| Local roads | `#FFFFFF` | `#E3DED5` |
| Major roads | `#F9DC84` | `#E8C35E` |
| Road and place labels | `#55606A` | white halo |
| Water labels | `#3E7FB0` | white halo |
| Park labels | `#4C7A3C` | white halo |

Restraint rules for the style:

- Hide most point-of-interest icons and labels.
- Show minor road labels only at higher zooms.
- Use flat building footprints; remove any 3D building extrusion from Liberty.
- If Sirius draws RF coverage in green, mute the park green further so it doesn't compete.

## Implementation steps

Work through these in order, committing after each step that leaves the app working.

1. **Bring in the style.** Copy OpenFreeMap's Liberty style JSON into the repo, for example `public/styles/sirius-light.json`. Keep its tile, font and icon URLs pointing at OpenFreeMap. Note the source URL and date it was copied in a comment or the README.
2. **Recolour and declutter.** Apply the palette and restraint rules above.
3. **Add the option.** Extend the basemap type to `'onemap' | 'plain' | 'light'`. Update the preference check in `MapWorkspace.tsx` so stored `onemap` and `plain` choices still load, and unknown values fall back safely.
4. **Integrate without wiping overlays.** Add the Light style's sources and layers into the existing map, below the app's layers, rather than calling `map.setStyle()`. If replacing the style is unavoidable, rebuild the DEM source, hillshade and every overlay on style load with one function that is safe to run repeatedly.
5. **Set the layer order.** From bottom to top: basemap fills and roads, hillshade, RF coverage, links and range rings, basemap labels, then sensor markers. This keeps street names readable over coverage.
6. **Tune hillshade cosmetically.** Adjust its opacity or exaggeration for the lighter base. Do not touch elevation sampling.
7. **Add a tile-failure fallback.** If OpenFreeMap tiles repeatedly fail to load, switch to OneMap and show a small notice.
8. **Add attribution.** Show OpenStreetMap and OpenFreeMap credits while Light is active.
9. **Validate.** Run `pnpm test` and `pnpm build`, then complete the checks below and capture screenshots.

## Guardrails

If any step seems to require breaking one of these, stop and ask Gabriel before continuing.

- **Elevation and RF are off-limits.** Don't edit `src/lib/elevation.ts`, the DEM tiles or any RF calculation code.
- **Results must not change.** The same saved scenario must give identical elevation readings and coverage before and after.
- **Don't silently lose overlays.** `map.setStyle()` can drop the hillshade and RF layers; see step 4.
- **Never push to `main`.** Pushing there deploys the live site. Stay on `feature/light-basemap` and open a pull request or leave it local.
- **No new dependencies or keys.** `maplibre-gl` is already installed, and OpenFreeMap needs no API key.
- **Keep OneMap selectable** as a fallback and an alternative.

## Verification and acceptance

The work is done when every box below is ticked and the screenshots are attached to the pull request.

- [ ] `pnpm test` and `pnpm build` pass.
- [ ] A saved scenario gives identical elevation readings and RF coverage on `main` and on the branch.
- [ ] Switching Light, OneMap and plain back and forth five times keeps hillshade, coverage, links, range rings and markers intact.
- [ ] Sensor dragging, keyboard nudging, selection, fit-to-sensors and zoom all still work.
- [ ] Street and place labels stay readable over RF coverage.
- [ ] The chosen basemap survives a page reload, and previously stored `onemap` and `plain` choices still load.
- [ ] Blocking `tiles.openfreemap.org` in browser developer tools triggers the fallback to OneMap with a notice.
- [ ] Attribution shows correctly for each basemap.
- [ ] Layout works at desktop and mobile widths.
- [ ] Side-by-side screenshots of OneMap and Light at the same four views: Marina Bay at zoom 14, Jurong West at zoom 13, Changi at zoom 12, and all of Singapore at zoom 11.

## Out of scope and open items

Out of scope for this branch: RF or elevation changes, a dark-mode map, self-hosting the map tiles, and any redesign of the app's controls or cards.

Open items to settle before or during the work:

- [ ] Should Light become the default basemap, or stay an option with OneMap as the default?
- [ ] What colours does Sirius currently use for RF coverage? This decides how far to mute the park green.
- [ ] If stripping down Liberty proves awkward, is starting from OpenFreeMap's Positron acceptable instead?

## Sources

- [OpenFreeMap quick start](https://openfreemap.org/quick_start/)
- [OpenFreeMap styles repository](https://github.com/niyamaka/openfreemap-styles)
- [MapLibre style specification](https://maplibre.org/maplibre-style-spec/)
- [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/)
