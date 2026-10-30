# Cozy Island backlog (single source of truth)

Updated: 2026-10-29 (CT), 11:10 AM. Live: https://cozy-island-be6.pages.dev (Cloudflare Pages, auto-built from `main`).
Owner: 3D Master (dev bot, daily session 9:57 AM CT, a floor not a cap).
Rules (fleet Bot Rules v3.0, D1-D3): every open task has Status, ETA live date and Estimate (dev days). Update this file every session, commit and push. Notion is discontinued; do not read or write it. Old content: `/workspace/fleet/archive/notion/` (read-only).
Empty backlog: tell The Boss with priority, then polish on the daily schedule. Walker's real-device iPad tests never block work.
Anything that needs Walker (decisions, approvals) goes to The Boss as a short note, never to Walker directly and never to Notion.

## Open tasks

| Order | Task | Status | ETA live | Estimate (dev days) |
|---|---|---|---|---|
| 49 | Day/night cycle with stars; frog chorus at night (no longer tied to themes); lighthouse beam sweeps at night | In progress: 49a-c done 2026-10-30, 49d (perf check + settings time picker) next | 2026-11-03 | 2 |
| 50 | Weather: gentle rain, winter snow, rainbows after rain, theme-aware | To do | 2026-11-06 | 2 |
| 51 | Rowboat or sailboat for travelling between the islets | To do | 2026-11-10 | 2.5 |
| 52 | Fishing, plus a collection journal (fish, creatures, treasures) with completion rewards | To do | 2026-11-16 | 3.5 |
| 53 | Cottage interiors and decorating: furniture inside the house you build | To do | 2026-11-21 | 3.5 |

Next backlog picked by Walker 2026-10-29 10:54 AM CT (relayed by The Boss). The claimable home islet was not picked and is not on the backlog.

### Acceptance criteria (Orders 49-53)

- 49 Day/night: smooth sun/moon arc with sky, light, fog and water colours per time of day on top of each theme's grade; a star field (and moon) at night that fades at dawn; the Misty Marsh frog chorus plays at night in every theme and is quiet by day; the Lighthouse Point beam sweeps only at night; a settings/URL override (e.g. `?time=`) for testing; 60 fps target held on iPad (stars one draw); iPad touch suite passes.
- 50 Weather: gentle rain (particles, ripples on water, rain soundscape layer) that comes and goes; winter shows snowfall instead of rain; a rainbow can appear after rain clears in daylight; per-theme look (e.g. Halloween drizzle tint); no weather inside caves; `?weather=` override for tests; perf within budget on iPad.
- 51 Boat: a rowboat or sailboat found or built at a dock, boarded with a tap; steers with the iPad joystick, floats with gentle bob and wake, cannot beach on land; reaches every islet and docks at its landing; respects the sea edge; save restores it; iPad test sails main island to an islet and back.
- 52 Fishing + journal: cast from shore, dock or boat with a simple timing mini-game on touch; several fish per biome/water type/time of day; a journal screen with pages for fish, creatures befriended and treasures found (silhouettes until found, counts); completion rewards (e.g. cosmetic or decor unlocks) on finishing a page; progress saved; iPad test catches a fish and sees it logged.
- 53 Interiors: enter a built cottage (camera moves inside, roof hides); place, rotate, move and remove furniture and decor on a grid inside (bed, table, chairs, rug, lamp, shelves, plants at least); furniture snaps to floor and walls, cannot block the door; saved with the house; undo works; iPad test furnishes a room and reloads.

### Order 49 detail (in progress, started 2026-10-30)

- 49a DONE (2026-10-30): `src/world/TimeOfDay.ts` game clock. Visits start at 9:00; a game hour lasts 50 s by day and 25 s by night (full cycle about 15 min). The sun rises at 6:00 and sets at 18:00 on a smooth arc (max 55 deg); the moon rises opposite at 18:00 (max 42 deg). The key light and shadows follow the sun by day and the moon by night, switching at the horizon where light is near zero, so nothing pops. Sky, fog, sun/hemi light, water and post grade blend toward twilight and night palettes on top of each theme's own grade (themes keep about 14% of their colour at night). `?time=noon|dawn|dusk|night|midnight|<hours>|HH:MM` freezes the clock for testing; `?timespeed=` scales the pace.
- 49b DONE (2026-10-30): star field is computed inside the existing sky dome shader (round, twinkling, size and colour varied dots), so it costs zero extra draw calls; it and the moon fade in at dusk and out at dawn. Foliage glow and cloud glow dim at night.
- 49c DONE (2026-10-30): Misty Marsh frog chorus is driven by the night amount in every theme (herd chorus and ambient croak rate, plus 3-frog chorus bursts after dark), quiet by day; no longer tied to Halloween. The Lighthouse Point beam sweeps only at night (lightning flashes still show it). tests/daynight.mjs 20/20 (new), lighthouse 11/11 (now checks no sweep at noon), frog 15/15 (night chorus in every theme), iPad touch 24/24.
- Note: the Halloween moon now follows the real moon arc, so it is below the horizon by day instead of hanging in the fixed dusk sky.

### Order 48 detail (DONE 2026-10-29, live 13 days ahead of the 2026-11-11 ETA)

Walker, 2026-10-23: final world is a cluster of islands with generated terrain; no hand-sculpting, no paid tools. Perf: 60 fps target on high-end iPads, 30 fps floor on low-end.

- 48a DONE (b93a2d7, 2026-10-27): seeded `placeIslets()` generator (`ARCHIPELAGO_SEED`/`GEN_COUNT`, no-overlap and fly-leash-reachable rules), adds Heron Isle (south, woodland). Map inset, scenic tour, treasure maps and haze are driven by the `ISLETS` list.
- 48b DONE (32f49b8, 2026-10-27): archipelago is now 4 islets: Blossom, Heron (woodland), Juniper Isle (pine, north), Driftwood Isle (palm beach, east). Per-islet flora kinds. tests/archipelago.mjs 14/14, islet-stream-perf 9/9, iPad touch 20/20.
- 48c DONE (2026-10-28): `npm run bake` (scripts/bake.mjs) bakes every islet's height grid with the game's own pure generator; a Vite plugin runs the same bake inside `npm run build`, so the Cloudflare Pages build (`npm ci && npm run build`) emits hashed, immutable `assets/islet-<id>-<hash>.tile` files (lossless: gzip of a byte-shuffled Float32 grid, 50-70 KB each, 235 KB for 4 islets, ~0.35 s at build). The game fetches the tile (DecompressionStream) instead of running the gen worker, validates it against the live generator, and falls back to the worker on any problem, in dev, or with `?bake=off`. Islet grid ready 42-79 ms (worker) -> 20-26 ms (baked); first playable frame unchanged within noise. tests/bake.mjs 6/6 (bit-identical heights).
- 48d DONE (2026-10-29): one landmark per generated islet, picked by kind: Heron Stones (standing-stone ring with a lintel gate and altar, Heron Isle), Juniper Lookout (timber watchtower with ladder, railed deck and shingle roof, Juniper Isle), Driftwood Arch (driftwood gateway with shell charms over a fire ring, Driftwood Isle). Sited on high gentle ground near each knoll, 40+ m from the landing, faces the main island, one baked mesh each (280-668 tris), solid colliders, flora kept 7+ m clear, built first in the lazy islet flora build. tests/landmarks.mjs 11/11, islet-flora 10/10, iPad touch suite passes (Jump check hardened against box load).
- 48e DONE (2026-10-29): distant-forest impostors. Each islet bakes all its trees into one low-poly canopy mesh (pine cones, palm crowns, round blobs; 756-1120 tris, same flora material so seasons still tint it, no shadows). More than 110 m past an islet's shore the full instanced flora (trees, bushes, flowers, shells, petals, hot spring) hides and only the impostor, landmark and pennant draw: 2-3 meshes instead of 15-19, 27-40x fewer triangles; back under 95 m it swaps back (hysteresis, no flicker), and far islets skip petal animation. tests/impostor.mjs 8/8, archipelago 14/14, islet-stream-perf 9/9 (heap and geometry flat), iPad touch suite passes.
- Acceptance met 2026-10-29 (iPad test): Cloudflare build bakes tiles; first playable frame not slower than today on a warm cache; fly edge to edge with flat memory; iPad suite passes.

## Waiting on Walker (goes via The Boss; none of these block work, defaults are in place)

Earlier small calls (default in place, confirm when convenient): purple Halloween frogs in Misty Marsh; Blossom Isle as the first islet; undo history is per-session only; lighthouse beam strength is set per theme; new mounts unlock through treasure; 85 m flier leash.

## Resolved decisions

- 2026-10-29 (Walker via The Boss, 10:53 AM CT), Order 48:
  1. Islet names and types: "Keep the islet names and types" (Heron Isle woodland, Juniper Isle pine, Driftwood Isle palm beach). No change.
  2. Islet count: "Stop at 4 islets". `GEN_COUNT` stays at 3 generated + Blossom Isle.
  3. Pink petals: "Pink petals only on Blossom Isle". Shipped 2026-10-29: generated islets lose the petal-pink ground drifts, and the season's drifting petals hide within 30 m of a generated islet (main island and Blossom Isle unchanged). tests/islet-petals.mjs 30/30.

## Done (from git log)

Oct 29
- Pink petals only on Blossom Isle (Walker's Order 48 answer), tests/islet-petals.mjs
- 48e: distant-forest impostors, Order 48 closed
- 48d: islet landmarks (Heron Stones, Juniper Lookout, Driftwood Arch) (d04ee06)

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

## Session log

- 2026-10-29 (CT), 11:10 AM: Walker answered the three Order 48 questions (keep names/types, stop at 4 islets, petals only on Blossom Isle); moved to Resolved. Shipped petals-only-on-Blossom (terrain tint + season petal particles), new tests/islet-petals.mjs 30/30 (spring + summer), archipelago 14/14. Added Walker's next backlog, Orders 49-53 (picked 10:54 AM CT); the daily session starts Order 49 on 2026-10-30.
- 2026-10-29 (CT): recovery restored node_modules and src/build (removed by a shared-box cleanup again) and restarted the 5180 dev server. Shipped 48d (landmarks, d04ee06) and 48e (impostor forests), closing Order 48. Hardened the iPad Jump check against box load. Backlog is now empty: The Boss gets a priority ping; polish on the daily schedule (load time, perf, visuals, iPad feel) until Walker sets the next backlog. Walker reviews on production (Bot Rules D4).

## Session notes (for the daily dev session)

- At wrap-up: test (iPad touch viewport suite), deploy by pushing to `main`, then update this file (status, ETA, estimate, Done) and commit.
- Do not touch Notion. Cross-bot requests go in `/workspace/fleet/handoffs/open/`; Walker-facing asks go to The Boss.
- Keep the 5180 dev server (hot reload, Tailscale) running during sessions.
