# Cozy Island backlog (single source of truth)

Updated: 2026-10-28 (CT). Live: https://cozy-island-be6.pages.dev (Cloudflare Pages, auto-built from `main`).
Owner: 3D Master (dev bot, daily session 9:57 AM CT, a floor not a cap).
Rules (fleet Bot Rules v3.0, D1-D3): every open task has Status, ETA live date and Estimate (dev days). Update this file every session, commit and push. Notion is discontinued; do not read or write it. Old content: `/workspace/fleet/archive/notion/` (read-only).
Empty backlog: tell The Boss with priority, then polish on the daily schedule. Walker's real-device iPad tests never block work.
Anything that needs Walker (decisions, approvals) goes to The Boss as a short note, never to Walker directly and never to Notion.

## Open tasks

| Order | Task | Status | ETA live | Estimate (dev days) |
|---|---|---|---|---|
| 48 | Big island phase 3: grow into a procedural archipelago | In progress (48a, 48b, 48c done) | 2026-11-11 | 1.5 (re-estimated 2026-10-28: 48d landmarks ~0.75, 48e impostor forests ~0.75) |

### Order 48 detail (Mechanic, Medium priority, deps: Orders 29-45, all done)

Walker, 2026-10-23: final world is a cluster of islands with generated terrain; no hand-sculpting, no paid tools. Perf: 60 fps target on high-end iPads, 30 fps floor on low-end.

- 48a DONE (b93a2d7, 2026-10-27): seeded `placeIslets()` generator (`ARCHIPELAGO_SEED`/`GEN_COUNT`, no-overlap and fly-leash-reachable rules), adds Heron Isle (south, woodland). Map inset, scenic tour, treasure maps and haze are driven by the `ISLETS` list.
- 48b DONE (32f49b8, 2026-10-27): archipelago is now 4 islets: Blossom, Heron (woodland), Juniper Isle (pine, north), Driftwood Isle (palm beach, east). Per-islet flora kinds. tests/archipelago.mjs 14/14, islet-stream-perf 9/9, iPad touch 20/20.
- 48c DONE (2026-10-28): `npm run bake` (scripts/bake.mjs) bakes every islet's height grid with the game's own pure generator; a Vite plugin runs the same bake inside `npm run build`, so the Cloudflare Pages build (`npm ci && npm run build`) emits hashed, immutable `assets/islet-<id>-<hash>.tile` files (lossless: gzip of a byte-shuffled Float32 grid, 50-70 KB each, 235 KB for 4 islets, ~0.35 s at build). The game fetches the tile (DecompressionStream) instead of running the gen worker, validates it against the live generator, and falls back to the worker on any problem, in dev, or with `?bake=off`. Islet grid ready 42-79 ms (worker) -> 20-26 ms (baked); first playable frame unchanged within noise. tests/bake.mjs 6/6 (bit-identical heights).
- 48d TODO: islet landmarks.
- 48e TODO: simplified (impostor) distant forests.
- Acceptance (iPad test): Cloudflare build bakes tiles; first playable frame not slower than today on a warm cache; fly edge to edge with flat memory; iPad suite passes.

## Waiting on Walker (goes via The Boss; none of these block work, defaults are in place)

For Order 48, sent to The Boss 2026-10-27:
1. Islet names and types: keep Heron Isle (woodland), Juniper Isle (pine) and Driftwood Isle (palm beach), or rename or retype them?
2. Stop at 4 islets, or grow to 5 (scope allows 3-5)?
3. Keep the pink petals on the generated islets, or only on Blossom Isle?

Earlier small calls (default in place, confirm when convenient): purple Halloween frogs in Misty Marsh; Blossom Isle as the first islet; undo history is per-session only; lighthouse beam strength is set per theme; new mounts unlock through treasure; 85 m flier leash.

## Done (from git log)

Oct 27
- 48b: 4 islets, Juniper Isle and Driftwood Isle (32f49b8)
- 48a: procedural archipelago generator, Heron Isle (b93a2d7)

Oct 26
- 47: Hot-Air Balloon mount, unlocked by building a Balloon Pad (47a), balloon tour drifts to Blossom Isle and back plus What's new (47b)
- 46: Blossom Isle hot spring (46a), lantern path, drifting petals, soak sound (46b), Sakura forage (46c), acceptance across the 5 visible themes (close-out)

Oct 25 to 24
- 45: scenic tour hops to every islet (45a), map insets driven by the `ISLETS` list (45b), islet treasure maps (45c)
- 44: cottage kit, snap walls, windows, swinging door, roof (House build tab)

Oct 23 (overnight run)
- 43: frogs and lily pads in Misty Marsh
- 42: Blossom Isle, generated islet NE of the main island (42a), cherry grove, flora, landing spot, map pin (42b), stream-in perf/memory test and collider hitch fix (42c)
- 41: sea turtle swimming mount (Sea Pearl, Shipwreck Cove chest)
- 40: walkable build pieces (stone path, stairs, arched bridge); follow-up: bridge tap-placed over real pond water
- 39: terrain streaming by camera distance, tile memory cap with LRU eviction, height/biome grids generated in Web Workers
- 38: mountain goats on Alpine Peak
- 37: Shipwreck Cove (Captain Hat chest)
- 36: terrain physics streams in 32 m heightfield tiles (3x3 ring)
- 35: Build Mode iPad undo and rotate
- 34: dragonfly mount (Shimmer Wing chest)
- 33: height fog and aerial perspective per theme
- 32: foxes in Autumn Grove
- 31: Lighthouse Point
- 30 and 30.5: 64 m terrain chunks; first-load hitch smoothing
- 29: world config groundwork (`src/world/config.ts`)

Earlier (Oct 10 to 22): per-theme soundscapes (28), scenic tour idle delay 6 s to 2 s, mount autopilot scenic tour (27), themes limited to 4 seasons plus Halloween, Cloudflare Pages hosting, mounts wave 1 (20), Phase 0 load-time work (17-19), seasons and holidays, tap reactions, friend screen, Order 23/24 puzzles and tree chopping. Full detail: `git log`.

## Session notes (for the daily dev session)

- At wrap-up: test (iPad touch viewport suite), deploy by pushing to `main`, then update this file (status, ETA, estimate, Done) and commit.
- Do not touch Notion. Cross-bot requests go in `/workspace/fleet/handoffs/open/`; Walker-facing asks go to The Boss.
- Keep the 5180 dev server (hot reload, Tailscale) running during sessions.
