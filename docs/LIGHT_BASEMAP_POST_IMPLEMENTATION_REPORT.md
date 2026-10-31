# Post-implementation report: Light basemap

**Project:** Project Sirius  
**Date:** 31 October 2026  
**Branch:** `feature/light-basemap`  
**Status:** Implemented and validated locally; user reviewed the localhost preview and reported “looks good”. No push, pull request, merge, or deployment has been performed.

## Outcome

Project Sirius now offers a Light basemap based on a locally maintained, recoloured OpenFreeMap Liberty style. It provides warm land tones, blue water, muted green parks, flat building footprints, restrained labels, and white/yellow roads. OneMap remains the default, and Plain terrain remains selectable.

The implementation meets the handoff's functional scope. Release packaging remains: screenshots are local artifacts and have not been attached to a pull request. User approval of the visual preview is recorded separately from any authorization to merge or deploy.

## Delivered changes

| Area | Result |
| --- | --- |
| Style | Added `public/styles/sirius-light.json`, derived from Liberty on 31 October 2026, with source provenance. |
| Visual treatment | Recoloured map features, muted parks, removed POI icons/labels and 3D buildings, delayed minor road labels to higher zooms. |
| Selector and persistence | Added Light alongside OneMap and Plain terrain; preserved existing preferences and safe fallback for unknown values. |
| Integration | Added sources/layers to the existing map; switches change visibility without calling `map.setStyle()`. |
| Layer order | Base fills/roads → hillshade → RF coverage → links/rings → basemap labels → HTML sensor markers. |
| Hillshade | Reduced exaggeration and adjusted paint colours while Light is active; restored existing paint for other choices. |
| Provider fallback | Three provider source errors within a Light selection, or an initial source still unloaded after 15 seconds, switch to OneMap with a notice. Reselecting Light retries. |
| Attribution | Credits OpenFreeMap, OpenMapTiles, OpenStreetMap and the existing elevation source; placed credits above the collapsed link-budget bar with an opaque backing. |
| Documentation | Added provider notes, an acceptance script and a detailed verification record. |

No dependencies, API keys, RF calculations, elevation sampling logic, or DEM tiles were changed.

## Validation results

These results were recorded during implementation; preparing this report did not rerun the application checks.

| Check | Result and scope |
| --- | --- |
| Current-checkout tests | **162/162 passed** across 17 test files, including two new Light tests. Historical local worktrees and temporary baseline copies were excluded from this count. |
| Production build | TypeScript and Vite build passed. |
| Style validation | Installed MapLibre style-spec validator returned no errors. |
| Calculation source comparison | No differences from `origin/main` in `src/lib`, `src/workers`, or `public/dem`. |
| Saved-scenario comparison | JSON-round-tripped default scenario produced identical active link inputs, sensor elevations and all **3,600** received-power/unknown coverage samples compared with `origin/main`. |
| Elevation values | Both versions returned **70.62745757976882 m** and **50.453707231093134 m** from the bundled DEM. |
| Repeated switching | Five cycles through Light, OneMap and Plain preserved overlay source identities and sensor markers. |
| Preferences | Light, OneMap and Plain choices survived reload. |
| Interaction exercise | Browser script exercised keyboard nudge, dragging, selection, fit-to-sensors and zoom. This is an interaction smoke check, not exhaustive gesture validation. |
| Provider outage | Blocking all OpenFreeMap requests triggered OneMap fallback and the notice. |
| Layout and appearance | Desktop and mobile screenshots captured; labels were visually checked over coverage. |
| Browser exceptions | No uncaught application exceptions observed. Intentional outage requests emitted expected network errors; a pre-existing favicon 404 was also observed. |
| User review | User approved the appearance in the localhost preview. |

The pnpm commands used `--config.verify-deps-before-run=false` to use the existing installed dependencies without automatic reinstallation. The dependency manifest and lockfile were unchanged. Full commands and supporting detail are in [the verification record](LIGHT_BASEMAP_VERIFICATION.md).

## Review and remaining limitations

Independent static review found **no Critical or Important defects**. The following minor observations remain:

1. The 15-second stall watchdog runs when Light is selected. A later pan that stalls indefinitely has no new timeout; later reported errors still trigger fallback after three failures.
2. Errors accumulate within a Light selection even when successful requests intervene. Three isolated failures can conservatively switch a recovered map to OneMap. Selecting Light again resets the attempt.
3. Fallback, persistence and attribution are covered by the browser acceptance script rather than dedicated unit tests.

OpenFreeMap is an external, as-is service. OneMap and Plain terrain remain available alternatives. The numerical comparison covers one saved default scenario and a terrain grid; unchanged calculation sources provide additional evidence, but this is not an exhaustive comparison of every scenario.

## Implementation decisions

- **Keep OneMap as default:** preserves existing behavior; users must select Light explicitly.
- **Mute parks to `#DDE8D5`:** reduces competition with RF coverage green; the colour remains a visual preference.
- **Omit live sprite loading:** all icons were removed, so startup does not depend on the icon service. The original sprite URL remains in the style; future icon additions require sprite integration.
- **Use installed dependencies for verification:** avoided an unnecessary reinstall; results reflect the installed versions.

## Review artifacts

Screenshots are available locally under `artifacts/light-basemap/` and are not committed:

| View | OneMap | Light |
| --- | --- | --- |
| Marina Bay, zoom 14 | [OneMap](../artifacts/light-basemap/marina-bay-onemap.png) | [Light](../artifacts/light-basemap/marina-bay-light.png) |
| Jurong West, zoom 13 | [OneMap](../artifacts/light-basemap/jurong-west-onemap.png) | [Light](../artifacts/light-basemap/jurong-west-light.png) |
| Changi, zoom 12 | [OneMap](../artifacts/light-basemap/changi-onemap.png) | [Light](../artifacts/light-basemap/changi-light.png) |
| Singapore, zoom 11 | [OneMap](../artifacts/light-basemap/singapore-onemap.png) | [Light](../artifacts/light-basemap/singapore-light.png) |

Additional captures: [mobile Light](../artifacts/light-basemap/mobile-light.png) and [provider fallback](../artifacts/light-basemap/fallback.png). Diagonal grey stripes are the existing unknown-RF-coverage display outside the coverage footprint.

## Commit and release status

| Commit | Change |
| --- | --- |
| `197b618` | Add recoloured OpenFreeMap Liberty Light style. |
| `0012ae6` | Integrate Light basemap without replacing RF overlays. |
| `7f2f124` | Record acceptance checks and review evidence. |

The feature is ready for pull-request preparation. A future PR should include the comparison screenshots and this report, disclose the minor fallback limitations, and run CI before merge. Merge and deployment remain separate actions requiring authorization.
