import { defineConfig } from 'vite';
export default defineConfig({
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  server: { port: 5173, host: true },
});
