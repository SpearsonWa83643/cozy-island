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
