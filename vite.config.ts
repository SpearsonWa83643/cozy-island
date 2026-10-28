import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
// @ts-ignore plain JS build helper (Order 48c)
import cozyBake from './scripts/vite-bake-plugin.mjs';

export default defineConfig({
  base: './', // relative asset URLs so dist works under https://<user>.github.io/<repo>/
  plugins: [wasm(), cozyBake()],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  server: { port: 5173, host: true, allowedHosts: true },
  preview: { port: 4180, host: true, allowedHosts: true },
});
