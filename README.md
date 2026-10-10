# Cozy Island (milestone 1)

TypeScript + Vite + Three.js r186 `WebGPURenderer` (auto WebGL2 fallback) + TSL shaders + Rapier physics.

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # tsc --noEmit && vite build
    npm run preview    # http://localhost:4180 (serves dist/)
    npm run shots -- --webgl   # Playwright smoke test + screenshots/ (needs preview running)

Touch / iPad (auto-detected via `pointer: coarse`; force with `?touch=1` / `?touch=0`): left joystick to walk
(push to the rim to jog), drag elsewhere to orbit, pinch to zoom, Jump / Build buttons; in build mode tap the ground
to place, tap the hotbar to pick, Rotate button, Remove toggle (then tap a piece). Touch devices start on Low quality.

    npm run build && npm run serve:subpath   # dist under http://localhost:4181/cozy-island/ (GitHub Pages layout)
    npm run test:touch                       # iPad + desktop Playwright checks against that server

Deploy: `.github/workflows/deploy.yml` builds with Node 20 and publishes `dist/` to GitHub Pages on push to `main`
(enable Settings → Pages → Source: GitHub Actions). `base: './'` keeps asset URLs relative, so any repo name works.

URL params: `?webgl` forces the WebGL2 backend, `?q=low` starts on Low quality.

Controls: WASD walk, Shift run, Space jump, drag orbit, wheel zoom, Q/E rotate camera,
B build mode, 1-5 select piece, R rotate piece, click place, right-click / X remove.

Layout: `src/core` (Game loop, Input, Physics, System), `src/world` (Terrain, Water, Sky, Decor, Models, noise),
`src/player` (Player controller, CameraRig), `src/build` (BuildMode), `src/render` (renderer + post), `src/ui` (HUD).

## Biomes, flora, fauna, audio (milestone 3)

The island (radius ~47 m) has six blended zones: **Meadow** (centre), **Alpine Peak** (north, snow + snowy pines),
**Autumn Grove** (east, maples, leaf litter, falling leaves), **Tropical Beach** (south-east, palms, shells, wide sand),
**Desert Mesa** (west, terraced sandstone, saguaro/barrel/prickly-pear cacti) and **Misty Marsh** (south-west, pond with
lily pads, reeds, willows, ducks, ground mist, fireflies). Biome weights are domain-warped Gaussians cached on a 1 m grid
(`src/world/Biomes.ts`); terrain height/colour, ground cover, particles, fog, sun and sky tint all blend from them.

- **Flora** (`src/world/Plants.ts`, `Flora.ts`): ~35 procedural plant/prop types, baked into vertex-coloured
  geometry and drawn as one `InstancedMesh` per variant (wind sway via a baked `sway` attribute). Low quality thins
  small plants, grass and flowers.
- **Camera occlusion**: vegetation between the camera and the player dithers out (screen-door fade in the shared
  flora material; shadows stay solid).
- **Fauna** (`src/world/Fauna.ts`): bunnies, deer, crabs, pond ducks (wander + gently flee), fish (swim, jump with
  splash rings), birds (circle, land, peck, take off when approached) and butterflies, all instanced.
- **Audio** (`src/audio/`): 100% procedural Web Audio, no files. Generative music (Markov chord pads, pentatonic
  pluck/chime/kalimba phrases with motif memory, slow key changes), biome ambience beds that crossfade (ocean panned
  toward the nearest shore and louder near it, wind, alpine howl, leaf rustle, cicadas, marsh), event critters
  (several bird species, gulls, crickets, frogs, woodpecker), per-surface footsteps (sand, grass, leaves, snow, rock,
  mud, water, wood), jump/land, build place/remove, fish splashes. Starts on the first tap/click/key (iOS unlock).
  HUD: mute button (or **M**), music + ambience sliders, saved in `localStorage`.

Tests: `npm run shots:biomes` (screenshots/07-13), `npm run test:audio`, `npm run test:touch`,
`npm run perf -- <urlA> <urlB> --rounds=2` (A/B frame-time probe on Low).

## Treasure, wardrobe, foraging & friends

Design notes and research are in [`docs/design-research.md`](docs/design-research.md).

- **Treasure maps.** A message bottle on the beach near spawn holds the first map. The map is a parchment overlay drawn from the real island heightfield, with the treasure area torn out as a fragment, a red X, a compass and a handwritten clue. Clues get stronger as you get close: a "warmer" chime, a sparkle column and a star-shaped crack in the ground. **Dig** to raise a chest, then **Open** it. The lid pops, confetti flies, and you get a wearable plus the next map. Chest spots are procedural, rotate through the six biomes, and never run out. Rarer items get a little more likely over time, and you are guaranteed a Rare or better at least every 4th chest.
- **Wardrobe.** 51 procedural low-poly wearables across hats, face, neck, back, outfit patterns and sprouts, in 5 rarities. Opening the wardrobe swings the camera round to your character as a live 3D preview (drag to spin). Duplicates turn into 🐚 shells, which buy outfit dyes.
- **Foraging.** About a dozen foods grow on or around the plants of each biome (apples, cherries, berries, acorns, mushrooms, pinecones, coconuts, cactus fruit, seeds, clover, wild carrots, reed grain). They pop into your bag and grow back after a few minutes.
- **Friends.** Animals that see you carrying a food they like stop fleeing and come over to look. Feeding them their favourite (♥) wins them over right away. A food they merely like takes two. Friends follow you in a little parade (breadcrumb trail plus spacing, up to 6). They get hungry after about 5 minutes and wander home if you don't feed them. Wave one goodbye from the Bag.
- **Saving.** Inventory, wardrobe, dyes, map progress and placed builds are saved to `localStorage`.

| Action | Desktop | iPad |
|---|---|---|
| Pick / Feed / Dig / Open / Take | **E**, or click the item | big orange context button (or tap the item) |
| Map | **M** (wheel to zoom) | 🗺️ button (pinch / drag inside the map) |
| Bag (food, friends) | **I** | 🎒 button (bottom sheet) |
| Wardrobe | **O** | 👕 button (bottom sheet, drag the view to spin) |
| Rotate camera | **Z / C** | drag right side |
| Mute | **U** | 🔊 button |
| Close overlays | **Esc** | ✕ / swipe the sheet handle down |

`npm run test:loop` runs the scripted full loop (forage, feed, follow, map, dig, open, equip, reload persists) on desktop and in iPad emulation.

## Swimming & the reef

- **Swimming:** walk off any beach into deeper water and you start swimming (head and shoulders above the surface, a gentle bob, kicking feet, a lean into each stroke, wake rings and soft stroke splashes). Swimming is slower than walking; Shift or pushing the joystick to the rim swims faster. The camera always stays above the swell.
- **Soft limit:** about 12 m past the shoreline a current starts carrying you back. A stamina ring ("Getting tired…", then "The current is carrying you back to shore") appears at the top on desktop and bottom-centre on iPad. It tops out at about 19 m, with no invisible wall. Swim back toward the island and you climb straight out onto the sand.
- **No more stuck states:** the old "deep water blocks movement" rule is gone. An anti-stuck nudge around the waterline frees the character if it gets wedged.
- **Reef ecosystem:** a shallow reef shelf about 16 m wide rings the island before a deep drop-off. It has coral clusters (staghorn, brain, fans, tube sponges, table coral, anemones), swaying kelp and rocks, all baked into 18 culled sectors (one draw call each). Its creatures are recycled around you: fish schools (boids that scatter from you), sea turtles that rise to breathe, rays, pulsing jellyfish, and dolphins jumping farther out. The shallows are clearer, with animated caustics on the seabed. Swimming adds reef ambience: muffled surf, a bubbly undertow, rising bubbles.
- **Sea treasures:** 🐚 conch shells, 💎 sea glass, ⭐ starfish and 🦪 pearls lie on the reef. Swim over one and press **Collect** (E / action button). They respawn over time, and in the Bag you can trade them for 🐚 shells to spend on dyes.
- **Drifting bottles:** message bottles bob on the reef. They hold the treasure map if you haven't found it yet, otherwise a piece of the **seaside set**: Sailor Cap, Fish Hat, Captain Hat, Coral Crown, Swim Goggles, Snorkel Mask, Kelp Scarf, Shell Necklace, Pearl Necklace, Duck Floatie, Kelp Sprout, Pearl Sprout, Sailor Stripes. The new pieces also drop from chests.
- Tests: `node tests/swim.mjs`, which swims out to the limit and back, checks the shallows in every direction, collects a sea item, opens two bottles, trades treasures, and runs an iPad Low joystick swim. Screenshots are `screenshots/24-28-*.png`.
