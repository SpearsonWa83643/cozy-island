import { defineConfig } from 'vite';
export default defineConfig({
  base: './', // relative asset URLs so dist works under https://<user>.github.io/<repo>/
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  server: { port: 5173, host: true, allowedHosts: true },
  preview: { port: 4180, host: true, allowedHosts: true },
});
