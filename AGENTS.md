# Agent instructions

## Project hub
Hub: https://claude.ai/artifact/MG1fu1vgHrMX91bjgE4akp (dashboard; repo docs are truth). Its state lives in the artifact database: never read or republish the page to update it.
- Start: query `steer` and `notes` where `handled != true`; if none, skip. Act on them, record decisions in `docs/HANDOFF.md`, then set `handled: true` and a short `reply`.
- End, only if `README.md`, `VERSION_HISTORY.txt`, `docs/HANDOFF.md` or `docs/BACKLOG.md` changed this session: update just the changed `hub` docs (`meta` for headline/recommendation/repo/version/updated; `{items}` docs for milestones/tasks/backlog/decisions/roadmap), add one `hublog` doc `v<n>` {v,date,t,items}, bump `meta.version`. Never record a result that is not in a repo doc.
