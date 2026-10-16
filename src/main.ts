import './ui/hud.css';
import { Game } from './core/Game';
import { beginLoadTiming } from './core/LoadTiming';

beginLoadTiming();

// Block browser gestures that fight the game on iPad/touch: pinch-zoom,
// double-tap zoom, scroll/rubber-banding, long-press callouts.
const block = (e: Event) => e.preventDefault();
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, block, { passive: false });
document.addEventListener('selectstart', (e) => { if (!(e.target as HTMLElement).closest?.('input')) e.preventDefault(); });
document.addEventListener('touchmove', (e) => { if (!(e.target as HTMLElement).closest?.('input')) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = performance.now();
  if (now - lastTouchEnd < 320 && !(e.target as HTMLElement).closest('button, .slot, input')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

const game = new Game();
(window as unknown as { game: Game }).game = game; // debug / test hook
const started = game.start(document.getElementById('app')!);
started.catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Failed to start: ' + (err?.message ?? err);
});

// Phase 0 (Order 18): service worker caches the hashed bundles so repeat visits start near-instantly.
// Registered once the game is up so it never competes with the first load. ?nosw opts out.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  void started.then(async () => {
    await navigator.serviceWorker.register('./sw.js');
    // hand the worker what this first visit already downloaded, so the very next visit is cached
    const reg = await navigator.serviceWorker.ready;
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/assets/'));
    reg.active?.postMessage({ type: 'cache-assets', urls });
  }).catch((e) => console.warn('sw', e));
}
