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
game.start(document.getElementById('app')!).catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Failed to start: ' + (err?.message ?? err);
});
