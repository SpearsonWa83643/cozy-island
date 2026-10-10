import { Game } from './core/Game';

const game = new Game();
(window as unknown as { game: Game }).game = game; // debug / test hook
game.start(document.getElementById('app')!).catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Failed to start: ' + (err?.message ?? err);
});
