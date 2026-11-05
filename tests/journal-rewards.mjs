// Journal page completion rewards (Order 52c). Completing Fish / Friends / Treasures grants
// angler / buddybadge / collector once (save.journalReward flags). iPad touch viewport.
// Timeout + browser closed in finally. Usage: node tests/journal-rewards.mjs [baseUrl]
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

  // open journal once so the lazy chunk is loaded
  await page.locator('.gbtn.journal').tap();
  await page.waitForFunction(() => !!window.game.play.journal?.open);
  await page.locator('.journal-close').tap();
  await page.waitForFunction(() => !window.game.play.journal?.open);

  // seed a full fish page (all 16) without claiming yet
  const fishIds = await page.evaluate(() => {
    const ids = Object.keys(window.game.fish?.defs ? {} : {});
    // FISH lives on the journal snapshot total; pull ids from the module via a catch seed helper
    return null;
  });
  void fishIds;

  const seeded = await page.evaluate(() => {
    const d = window.game.play.save.data;
    // enumerate via an open journal snapshot of empty book — use known fish list from snapshot after seed build
    // Build from the journal's own FISH list by temporarily opening and reading entries once seeded from defs exposed on game
    const all = window.game.play.journal.snapshot().fish.entries.map((e) => e.id);
    d.fish = {};
    for (const id of all) d.fish[id] = { n: 1, best: 20 };
    d.journalReward = {};
    delete d.owned.angler;
    window.game.play.save.touch();
    return { total: all.length, ids: all };
  });
  ok('seeded every fish in the journal defs', seeded.total === 16, `total=${seeded.total}`);

  // claim fish page reward
  const claimed = await page.evaluate(() => {
    const pageId = window.game.play.checkJournalRewards();
    const d = window.game.play.save.data;
    return {
      pageId,
      flag: !!d.journalReward?.fish,
      owned: !!d.owned.angler,
      next: window.game.play.journal.snapshot().rewards.next,
    };
  });
  ok('completing Fish page claims the Angler\'s Cap once', claimed.pageId === 'fish' && claimed.flag && claimed.owned && claimed.next === null,
    JSON.stringify(claimed));

  // reward card should appear
  await page.waitForSelector('.reward.show, .reward.journal-reward, .reward', { timeout: 4000 }).catch(() => null);
  const rewardVisible = await page.locator('.reward.show').count();
  ok('journal reward card pops for the Angler\'s Cap', rewardVisible >= 1, `cards=${rewardVisible}`);
  if (rewardVisible) {
    await page.locator('.reward .btn-ok').tap();
    await page.waitForFunction(() => document.querySelectorAll('.reward.show').length === 0);
  }

  // second check is a no-op
  const again = await page.evaluate(() => window.game.play.checkJournalRewards());
  ok('re-checking after claim returns null (no double grant)', again === null, `again=${again}`);

  // open journal: Fish page shows claimed banner
  await page.locator('.gbtn.journal').tap();
  await page.waitForFunction(() => !!window.game.play.journal?.open);
  await page.evaluate(() => window.game.play.journal.setPage('fish'));
  const banner = await page.locator('.journal-done.claimed[data-page="fish"]').count();
  const bannerTxt = await page.locator('.journal-done.claimed[data-page="fish"]').textContent().catch(() => '');
  ok('Fish page shows a claimed completion banner', banner === 1 && /complete|claimed/i.test(bannerTxt ?? ''), `txt=${bannerTxt}`);

  // seed friends + treasures and claim sequentially
  const friendsClaim = await page.evaluate(() => {
    const d = window.game.play.save.data;
    const species = window.game.play.journal.snapshot().creatures.entries.map((e) => e.id);
    d.pets = {};
    species.forEach((sp, i) => { d.pets[`${sp}:${i}`] = { name: sp, sp, love: 5, lvl: 1, clean: 1, tricks: [] }; });
    delete d.owned.buddybadge;
    window.game.play.save.touch();
    const pageId = window.game.play.checkJournalRewards();
    return { pageId, n: species.length, owned: !!d.owned.buddybadge, flag: !!d.journalReward?.creatures };
  });
  ok('completing Friends page grants Buddy Badge', friendsClaim.pageId === 'creatures' && friendsClaim.n === 8 && friendsClaim.owned && friendsClaim.flag,
    JSON.stringify(friendsClaim));
  await page.waitForSelector('.reward.show', { timeout: 4000 }).catch(() => null);
  if (await page.locator('.reward.show').count()) {
    await page.locator('.reward .btn-ok').tap();
    await page.waitForFunction(() => document.querySelectorAll('.reward.show').length === 0);
  }

  const treasureClaim = await page.evaluate(() => {
    const d = window.game.play.save.data;
    const ids = window.game.play.journal.snapshot().treasures.entries.map((e) => e.id);
    d.treasures = ids.slice();
    delete d.owned.collector;
    window.game.play.save.touch();
    const pageId = window.game.play.checkJournalRewards();
    return { pageId, n: ids.length, owned: !!d.owned.collector, flag: !!d.journalReward?.treasures };
  });
  ok('completing Treasures page grants Collector Sprout', treasureClaim.pageId === 'treasures' && treasureClaim.n === 5 && treasureClaim.owned && treasureClaim.flag,
    JSON.stringify(treasureClaim));
  await page.waitForSelector('.reward.show', { timeout: 4000 }).catch(() => null);
  if (await page.locator('.reward.show').count()) {
    await page.locator('.reward .btn-ok').tap();
    await page.waitForFunction(() => document.querySelectorAll('.reward.show').length === 0);
  }

  // snapshot rewards all claimed
  const rewards = await page.evaluate(() => window.game.play.journal.snapshot().rewards);
  ok('all three journal pages marked complete + claimed', rewards.fish.complete && rewards.fish.claimed
    && rewards.creatures.complete && rewards.creatures.claimed
    && rewards.treasures.complete && rewards.treasures.claimed
    && rewards.next === null, JSON.stringify(rewards));

  await page.locator('.journal-close').tap();
  ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: 'screenshots/105-ipad-journal-reward.png', fullPage: true });
  console.log('screenshot screenshots/105-ipad-journal-reward.png');
} finally {
  clearTimeout(kill);
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
