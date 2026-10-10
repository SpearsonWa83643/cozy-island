# Cozy Island (milestone 1)

TypeScript + Vite + Three.js r186 `WebGPURenderer` (auto WebGL2 fallback) + TSL shaders + Rapier physics.

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # tsc --noEmit && vite build
    npm run preview    # http://localhost:4180 (serves dist/)
    npm run shots -- --webgl   # Playwright smoke test + screenshots/ (needs preview running)

URL params: `?webgl` forces the WebGL2 backend, `?q=low` starts on Low quality.

Controls: WASD walk, Shift run, Space jump, drag orbit, wheel zoom, Q/E rotate camera,
B build mode, 1-5 select piece, R rotate piece, click place, right-click / X remove.

Layout: `src/core` (Game loop, Input, Physics, System), `src/world` (Terrain, Water, Sky, Decor, Models, noise),
`src/player` (Player controller, CameraRig), `src/build` (BuildMode), `src/render` (renderer + post), `src/ui` (HUD).
