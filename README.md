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
