# Building tile recovery verification

17 November 2026; based on `main` at `cee36b0` (web 1.12.0).

The reported Link workspace notice can be reproduced by returning HTTP 503 for one building-height tile. The original loader removed the failed tile from its cache but did not automatically request it again. Its `offline` status was sticky even after a later successful request. A clean live-site check loaded 32 building tiles without errors; the original user's initial network failure was not captured.

The loader now uses the same bounded backoff as elevation tiles: retries after 1.5, 5 and 15 seconds. Pending requests stay deduplicated during backoff. Only exhausted failures produce the missing-buildings notice; successful later requests clear their failure entries. HTTP 404 remains an empty building tile. Retry timers are cleared when the hook unmounts.

Verification:

- All 400 unit tests across 35 files pass.
- TypeScript and the production build pass with `VITE_BASE=/Project-Sirius/`.
- `scripts/e2e/building-tile-recovery.mjs`: a one-off 503 reproduced the persistent notice against the live release before the fix; the fixed production preview loads the failed tile and clears the notice without sensor edits or reload. A sustained outage exhausts its retries and shows the notice; toggling Buildings after service recovery requests the tile again and clears it.
- Existing `scripts/e2e/buildings.mjs` passes: diffraction loss 42.98 dB with buildings off, 60.87 dB at street level and 59.29 dB on the roof.

The fix is prepared for pull-request review; this record does not claim a merge or deployment. The connected tools do not provide access to the project's artifact database, so pending hub steering could not be queried. The primary checkout and its existing local edits were preserved; work is in an isolated local clone.
