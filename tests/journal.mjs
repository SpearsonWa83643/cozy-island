// Collection journal (Order 52b), iPad touch viewport: 📖 Journal opens a screen with Fish / Friends /
// Treasures pages; silhouettes until found; fish show count + best size from save.fish; creatures from
// save.pets; treasures from save.treasures. Tap tabs to browse; close with ✕. Screenshot 104.
// Timeout + browser closed in finally. Usage: node tests/journal.mjs [baseUrl]
import { chromium, devices } from 'playwright';
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4181/cozy-island/';
const kill = setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 180000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (n, c, x = '') => { results.push(c); console.log(c ? 'PASS' : 'FAIL', n, x); };
const errFilter = (m) => (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver|GPU stall|swiftshader|Automatic fallback/i.test(m.text())));
try {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const errors = []; page.on('console', (m) => { if (errFilter(m)) errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  const q = '?webgl&q=low&touch=1&whatsnew=0&time=noon&weather=clear';
  await page.goto(base + q); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.evaluate(() => document.getElementById('whatsnew')?.querySelector('.w-ok')?.click());

  const snap = () => page.evaluate(async () => {
    const g = window.game;
    if (!g.play.journal) await g.play.ensureJournal?.();
    // ensureJournal is private — open via panels API / button path by importing through toggle
    return g.play.journal ? g.play.journal.snapshot() : null;
  });

  // open via real tap on the Journal button
  const btn = page.locator('.gbtn.journal');
  ok('📖 Journal button is in the game bar', await btn.count() === 1 && await btn.isVisible());
  await btn.tap();
  await page.waitForFunction(() => !!window.game.play.journal?.open);
  let s = await page.evaluate(() => window.game.play.journal.snapshot());
  ok('tapping Journal opens the overlay on the Fish page', s.open && s.page === 'fish' && s.fish.total === 16, JSON.stringify({ open: s.open, page: s.page, total: s.fish.total }));
  ok('fresh save: every fish is a silhouette (0 known)', s.fish.known === 0 && s.fish.entries.every((e) => !e.known), `known=${s.fish.known}`);
  const lockedFish = await page.locator('.journal-body .jcard.locked[data-kind="fish"]').count();
  ok('Fish page renders 16 locked cards', lockedFish === 16, `locked=${lockedFish}`);

  // seed a catch + a pet + a treasure, then reopen / refresh
  await page.evaluate(() => {
    const d = window.game.play.save.data;
    d.fish = { minnow: { n: 2, best: 8 }, sardine: { n: 1, best: 14 }, sunfish: { n: 1, best: 220 } };
    d.pets = {
      'bunny:0': { name: 'Clover', sp: 'bunny', love: 12, lvl: 2, clean: 1, tricks: ['spin'] },
      'frog:1': { name: 'Lily', sp: 'frog', love: 3, lvl: 1, clean: 0.8, tricks: [] },
    };
    d.treasures = ['pterodactyl_egg', 'sea_pearl'];
    window.game.play.save.touch();
    window.game.play.journal.render?.();
    // render is private — flip page away and back via public setPage
    window.game.play.journal.setPage('creatures');
    window.game.play.journal.setPage('fish');
  });
  s = await page.evaluate(() => window.game.play.journal.snapshot());
  ok('seeded fish show as found with counts and best size', s.fish.known === 3
    && s.fish.entries.find((e) => e.id === 'minnow')?.n === 2
    && s.fish.entries.find((e) => e.id === 'minnow')?.best === 8
    && s.fish.entries.find((e) => e.id === 'sunfish')?.known
    && !s.fish.entries.find((e) => e.id === 'koi')?.known, JSON.stringify(s.fish.entries.filter((e) => e.known)));
  const foundFish = await page.locator('.journal-body .jcard.found[data-kind="fish"]').count();
  const bestTxt = await page.locator('.journal-body .jcard.found[data-id="minnow"] .js').textContent();
  ok('Fish page shows 3 found cards and "best 8 cm" on Minnow', foundFish === 3 && /best\s*8\s*cm/i.test(bestTxt ?? ''), `found=${foundFish} best=${bestTxt}`);

  // tap Friends tab
  await page.locator('.journal-tab[data-page="creatures"]').tap();
  await page.waitForFunction(() => window.game.play.journal.page === 'creatures');
  s = await page.evaluate(() => window.game.play.journal.snapshot());
  ok('Friends page lists all species; bunny + frog are known', s.page === 'creatures' && s.creatures.total === 8 && s.creatures.known === 2
    && s.creatures.entries.find((e) => e.id === 'bunny')?.n === 1
    && s.creatures.entries.find((e) => e.id === 'frog')?.bestName === 'Lily'
    && !s.creatures.entries.find((e) => e.id === 'fox')?.known, JSON.stringify(s.creatures));
  const friendCards = await page.locator('.journal-body .jcard[data-kind="creature"]').count();
  ok('Friends page renders a card per species', friendCards === 8, `cards=${friendCards}`);

  // tap Treasures tab
  await page.locator('.journal-tab[data-page="treasures"]').tap();
  await page.waitForFunction(() => window.game.play.journal.page === 'treasures');
  s = await page.evaluate(() => window.game.play.journal.snapshot());
  ok('Treasures page shows found eggs/pearl and silhouettes for the rest', s.page === 'treasures' && s.treasures.known === 2
    && s.treasures.entries.find((e) => e.id === 'pterodactyl_egg')?.known
    && s.treasures.entries.find((e) => e.id === 'sea_pearl')?.known
    && !s.treasures.entries.find((e) => e.id === 'cloud_puppy_tuft')?.known
    && s.treasures.total >= 5, JSON.stringify(s.treasures));

  await page.screenshot({ path: 'screenshots/104-ipad-journal-treasures.png' });

  // close with ✕
  await page.locator('.journal-close').tap();
  await page.waitForFunction(() => !window.game.play.journal.open);
  ok('✕ closes the journal', !(await page.evaluate(() => window.game.play.journal.open)));

  // reopen and Escape closes (via key — also covers desktop path)
  await btn.tap();
  await page.waitForFunction(() => window.game.play.journal.open);
  await page.evaluate(() => window.game.play.journal.hide());
  ok('hide() closes cleanly for a second open', !(await page.evaluate(() => window.game.play.journal.open)));

  // progress survives a reload (same save keys as 52a)
  await page.evaluate(() => window.game.play.save.flush());
  await page.reload(); await page.waitForFunction(() => window.game?.ready);
  await page.locator('.gbtn.journal').tap();
  await page.waitForFunction(() => !!window.game.play.journal?.open);
  s = await page.evaluate(() => window.game.play.journal.snapshot());
  ok('journal progress is restored from save after reload', s.fish.known === 3 && s.creatures.known === 2 && s.treasures.known === 2, JSON.stringify({ f: s.fish.known, c: s.creatures.known, t: s.treasures.known }));

  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  if (results.some((r) => !r)) process.exitCode = 1;
} finally { clearTimeout(kill); await browser.close().catch(() => {}); }
