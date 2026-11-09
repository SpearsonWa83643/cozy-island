import { defineConfig, type Plugin, type HtmlTagDescriptor } from 'vite';
import wasm from 'vite-plugin-wasm';
// @ts-ignore plain JS build helper (Order 48c)
import cozyBake from './scripts/vite-bake-plugin.mjs';

/**
 * Polish 2026-11-09: Rapier (JS glue + 1.2 MB gzip WASM) used to start downloading only after the index
 * chunk had run and Physics.init() called import(). Preload both from index.html so the biggest download
 * on a cold iPad load overlaps the index/terrain chunks. Hrefs come from the bundle (hashed names).
 */
function preloadRapier(): Plugin {
  return {
    name: 'cozy-preload-rapier',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const names = Object.keys(ctx.bundle ?? {});
        const js = names.find((n) => /(^|\/)rapier-[\w-]+\.js$/.test(n));
        const wasm = names.find((n) => /rapier_wasm3d_bg-[\w-]+\.wasm$/.test(n));
        const tags: HtmlTagDescriptor[] = [];
        if (js) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `./${js}` }, injectTo: 'head' });
        // matches the glue's plain fetch(url) (cors mode, same-origin credentials), so the browser reuses it
        if (wasm) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'fetch', type: 'application/wasm', crossorigin: true, href: `./${wasm}` }, injectTo: 'head' });
        return tags;
      },
    },
  };
}

export default defineConfig({
  base: './', // relative asset URLs so dist works under https://<user>.github.io/<repo>/
  plugins: [wasm(), cozyBake(), preloadRapier()],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  server: { port: 5173, host: true, allowedHosts: true },
  preview: { port: 4180, host: true, allowedHosts: true },
});
