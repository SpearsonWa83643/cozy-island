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

    npm run build && npm run serve:subpath   # dist under http://localhost:4181/cozy-island/ (subpath layout test)
    npm run test:touch                       # iPad + desktop Playwright checks against that server

Live: https://cozy-island-be6.pages.dev

Deploy: Cloudflare Pages (project `cozy-island`) builds from this repo on every push to `main` (`npm ci && npm run build`, output `dist`, NODE_VERSION=20). Cache headers live in `public/_headers`. GitHub Pages was retired on 2026-10-19
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

## Moving on iPad, digging, and the Crystal Cave

**Floating joystick.** Put your thumb down and drag: a joystick appears right under it, and its base follows your thumb if you drag past the rim. It feels like the 2D game's stick (wakes after 12 px, 62 px radius). In the HUD, **🕹️ Auto / Left / Right** picks which side it lives on, and the choice is saved:
- **Left** or **Right**: that half of the screen is the stick; a drag on the other half orbits the camera.
- **Auto**: the stick can start from either side in the lower 60% of the screen; drag up high (or with a second finger) to look around.

Putting two fingers down together is always a pinch.

**Tap / click to walk.** A quick tap on the ground walks you there, steering around small obstacles, with a soft ring marking the spot. Tap something you can use (food, sea treasure, bottle, chest, dig spot, an animal you have food for, the mole, or a far build piece in Remove mode) and you walk over and use it when you arrive. Touching the joystick or WASD cancels the walk. On desktop a click does the same; a drag still orbits, and build mode still places pieces.

**Digging.** Press **F** on desktop, or tap/hold **🪏 Dig** on iPad, to dig in front of you. It works on grass, sand, dirt, leaves and snow, but not rock or water. Each dig leaves a hole with a mound and flying dirt, and the hole heals over in about 95 s. What you find depends on the biome: worms 🪱 and beetles 🐞 (birds and the mole love them), seeds, buried shells, fossils 🦴, raw gems 💠, conches on the beach, and now and then a wearable. Digging at the map's X digs up the chest.

**A bigger island.** It's about 15% bigger in each direction (area ×1.32), with flora density scaled to match.

**The Crystal Cave.** Find the rocky arch on the hillside between the Alpine Peak and the Desert; bats circle above it. Walk in, and the view fades into a cavern far underground:
- glowing crystals and glowcap mushrooms, with their light baked into the rock
- stalactites and stalagmites, and a glowing pool with cave fish
- bats that flutter when you get close, beetles, and a shy **mole** that pops up to see you
- dripping echoes in the audio

Underground, the camera pulls in and never goes through the ceiling or walls.
- **Finds:** cave crystals 🔮, glowcaps 🍄, geodes 🪨 and ancient relics 🏺.
- **Cave set:** Miner Helmet with a lamp beam, Crystal Crown, Bat Wings, Crystal Pendant, Glowcap Sprout. The first geode always holds a piece of it; the mole gives the Miner Helmet for your first worm.

Only one side is drawn at a time (island or cave).

Tests: `node tests/move.mjs`, `node tests/dig.mjs`, `node tests/cave.mjs` (screenshots 29–41).

## Free look button (iPad)

An **👁️ eye button** sits above the action button. Press it and drag anywhere to look around: the orbit is smooth and eased, and letting go ends it. Your other thumb can keep using the floating joystick at the same time, and pinch still zooms. With **Right** handedness the eye moves to the left side so it stays under your free thumb. Dragging on open ground still orbits like before.

## Friend close-up

**Tap or click a follower** (or **💗 Visit** in the Bag) to open its friend screen. The world pauses and your friend sits in a cozy little studio with a soft, out-of-focus backdrop.

- **Card:** an auto-generated name (tap ✏️ to rename), species, friendship level, and 💗 friendship, 🍎 tummy and 🫧 cleanliness meters.
- **🤚 Pet:** drag on the creature. It leans into your hand, closes its eyes happily, purrs, and hearts float up. Rub fast back and forth to tickle it (giggles and wiggles). Keep petting and it gets sleepy 💤. A quick tap says hi with its species quirk.
- **🧽 Clean:** animals get dusty over time, faster in the marsh, when you dig near them, or while they wait for you to swim. Scrub with the sponge to wash off the mud spots (bubbles and sparkles), then it does a little shake-off.
- **🍎 Feed:** pick a snack from your bag (♥ marks favourites). Liked food gets chomped and fills its tummy. Food it dislikes gets a head shake and goes back in your bag.
- **Always lively:** it blinks, follows your finger or cursor with its eyes, wiggles its ears and tail, and hops. Each species has a quirk: bunny nose twitch, duck quack and wing flap, deer ear flick, crab claw clicks, bird chirp hop.
- **Friendship levels** bring rewards: Lv 2 teaches a 🌀 Spin trick (✨ Trick button), Lv 3 gives a species gift wearable, Lv 4 teaches a 💃 Happy Dance, and later levels find you shells.
- Names, meters, friendship and tricks are saved, and **your followers come back with you** when you reload.

Test: `node tests/friend.mjs` (desktop + iPad). Screenshots: `screenshots/43-friend-pet.png`, `44-friend-clean.png`, `45-friend-feed.png`, `46-friend-levelup.png`, `47-ipad-friend.png`.

## Seasonal themes (🎃 Halloween)
`src/theme/theme.ts` follows the 2D game's naming: `Theme`, `THEMES`, `THEME_ORDER`, `theme`, `setTheme`, `themeEvents`.
**Which theme is active:** `?theme=halloween|spring|summer|autumn|winter|thanksgiving|christmas` > the saved setting (the 🎨 Auto / 🌿 / 🎃 buttons in the stats panel, key `cozyIsland.theme.v1`) > the date window (`window: { from: [10, 1], to: [11, 1] }`) > spring. Legacy `classic` maps to `spring`. `?date=YYYY-MM-DD` previews a date.
A theme drives:
- the post grade (`grade`)
- the sky gradient, moon, stars, fog and sun/hemi light (`sky`, blended over the biome atmosphere and fading live)
- the HUD skin (`ui` → CSS vars + `body.theme-<id>`)
- the music mode (`music: 'spooky'` = D minor celesta + pizzicato) and ambience (owl hoots, wind)
- the decorations (`dress` → `src/theme/Dress.ts`)
- critters, collectibles (candy, seasonal wearables that only drop in season) and build pieces

Halloween adds:
- jack-o'-lanterns with flickering carved faces in the pumpkin patch, by trees and around spawn
- hanging lanterns, cobwebs, a tiny graveyard, bats, light mist
- 8 friendly ghosts that float, giggle and twirl when tapped. Stand beside one and press E (or tap it) to **trick-or-treat** for 🍬. At 8 candy a ghost swaps them for a Halloween wearable: Witch Hat, Pumpkin Head, Ghost Sheet, Cat Ears, Vampire Cape or Night Bat Wings.
- build pieces: Jack-o'-Lantern and Spooky Lamp

Perf: one InstancedMesh per decor kind. The glow is emissive with per-instance TSL flicker, and only 3 real point lights follow the nearest lanterns.

**Adding a season:** add an id to `ThemeId`, a `Theme` record with a `window`, and an entry in `THEME_ORDER`. Then optionally add a `dress` builder in `Dress.ts` and `body.theme-<id>` CSS.
