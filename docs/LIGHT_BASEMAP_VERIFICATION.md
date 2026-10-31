# Light basemap verification

31 October 2026 · `feature/light-basemap` · local review, not deployed.

## Implemented

Light is an optional, persisted OpenFreeMap Liberty derivative. OneMap remains the default and Plain terrain remains available. No new dependency or key was added. Sources and layers are installed once; switches change visibility, preserving the existing map and every overlay source. Base geometry is below hillshade, coverage, links and rings; text is above these layers and below HTML sensor markers. Hillshade changes are paint-only. Attribution is placed above the collapsed link budget bar with an opaque backing.

Three provider source errors per Light selection trigger OneMap fallback and a notice. An initial source still unloaded after 15 seconds also triggers fallback, including a failed TileJSON request. Reselecting Light starts a new attempt.

## Evidence

- Current checkout only: **162/162 tests passed** using `corepack pnpm --config.verify-deps-before-run=false test --exclude '.claude/**' --exclude '.superpowers/**'`.
- `corepack pnpm --config.verify-deps-before-run=false test`: 564 tests passed, including this checkout and historical local worktrees. Two new Light tests check flat style restraints, repeat installation, overlay preservation and geometry/text ordering.
- `corepack pnpm --config.verify-deps-before-run=false build`: TypeScript and production build passed.
- The installed MapLibre style-spec validator returns no errors for `sirius-light.json`.
- `git diff origin/main -- src/lib src/workers public/dem` is empty: elevation, DEM and RF code are unchanged.
- A temporary comparison test imported both this checkout and `origin/main`'s calculation modules. The JSON-round-tripped default scenario sampled the real bundled DEM: elevations **70.62745757976882 m** and **50.453707231093134 m** matched exactly. Active link inputs and all **3,600** received-power/unknown samples over a terrain grid matched exactly. The temporary baseline and test are local scratch, not shipped.
- `scripts/e2e/light-basemap.mjs` passed in isolated Chromium: five cycles through all three basemaps preserve source identities; markers remain; Light credits appear; Light/Plain/OneMap survive reload; keyboard nudge, drag, selection, fit and zoom actions run; mobile layout is captured; blocking all OpenFreeMap requests causes OneMap fallback and its notice.
- Browser had no uncaught application exceptions. Expected console network errors occur during the intentional provider block; a pre-existing favicon 404 also appears.

The pnpm flag bypasses automatic dependency reinstallation for the existing local node_modules; neither the dependency manifest nor lockfile changed.

## Screenshots

Local review artifacts are in `artifacts/light-basemap/` (not committed):

| View | OneMap | Light |
| --- | --- | --- |
| Marina Bay, zoom 14 | `marina-bay-onemap.png` | `marina-bay-light.png` |
| Jurong West, zoom 13 | `jurong-west-onemap.png` | `jurong-west-light.png` |
| Changi, zoom 12 | `changi-onemap.png` | `changi-light.png` |
| Singapore, zoom 11 | `singapore-onemap.png` | `singapore-light.png` |

Also: `mobile-light.png`, `fallback.png`. Grey diagonal stripes are the existing unknown-RF-coverage display when panning outside the coverage footprint, not basemap tile failures. These can be attached to a future PR; no PR, push, merge or deployment was performed.

## Decisions and review

- Keep OneMap as default: existing users retain their behavior; Light requires selection.
- Mute parks to `#DDE8D5`: distinguishes them from RF green; palette remains subject to visual preference.
- Retain the upstream sprite URL in the style for provenance, but omit sprites from the live map: all icons were removed; adding icons later needs sprite wiring.
- Use installed dependencies with pnpm's verification override: avoids an unnecessary reinstall; validation reflects the installed dependency versions.

Independent static review found no Critical or Important defects. Deferred minor observations:

- The 15-second stall watchdog runs on selection, not on later pans. Later failures still trigger fallback after three errors.
- Errors accumulate within one Light selection, even if successes intervene; three isolated failures can conservatively trigger fallback. Reselect Light to retry.
- Automated fallback/persistence/attribution coverage is in the browser script rather than unit tests.
