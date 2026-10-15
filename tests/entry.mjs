// Pure unit tests for entry name / DOB helpers (no browser).
// Mirrors src/ui/entryPlayer.ts — keep in sync when changing cleanName / save.
// Usage: node tests/entry.mjs

const NAME_MAX = 16;
const PLAYER_KEY = 'cozyIsland.player.v1';

function cleanName(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} '\u2019.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, NAME_MAX);
}
const finalName = (raw) => cleanName(raw).trim();
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function validDob(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? s : null;
}
function loadPlayer(store) {
  try {
    const d = JSON.parse(store.getItem(PLAYER_KEY) || 'null');
    if (d && typeof d === 'object') {
      return { v: 1, name: finalName(String(d.name ?? '')), dob: validDob(d.dob), seen: !!d.seen };
    }
  } catch { /* */ }
  return { v: 1, name: '', dob: null, seen: false };
}
function savePlayer(p, store) {
  try { store.setItem(PLAYER_KEY, JSON.stringify(p)); } catch { /* */ }
}
function ageOn(dob, now = new Date()) {
  const [y, m, d] = dob.split('-').map(Number);
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}
const isBirthday = (dob, now = new Date()) => {
  if (!dob) return false;
  const [, m, d] = dob.split('-').map(Number);
  return now.getMonth() + 1 === m && now.getDate() === d;
};

const results = [];
const ok = (n, c, x = '') => { results.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, x); };

ok('strips emoji / symbols', cleanName('Mia🎮!') === 'Mia');
ok('keeps unicode letters', cleanName('José') === 'José');
ok('collapses spaces', cleanName('A   B') === 'A B');
ok('max length', cleanName('ABCDEFGHIJKLMNOPQRSTUVWXYZ').length === NAME_MAX);
ok('finalName trims end', finalName('  Mia  ') === 'Mia');
ok('allows hyphen and apostrophe', cleanName("O'Neil-Smith").startsWith("O'Neil"));

ok('valid ISO', validDob('2018-06-15') === '2018-06-15');
ok('rejects bad month', validDob('2018-13-01') === null);
ok('rejects Feb 30', validDob('2019-02-30') === null);
ok('accepts leap day', validDob('2020-02-29') === '2020-02-29');
ok('rejects non-string', validDob(20180615) === null);

ok('ageOn before birthday', ageOn('2010-12-25', new Date(2026, 9, 15)) === 15);
ok('ageOn after birthday', ageOn('2010-03-01', new Date(2026, 9, 15)) === 16);
ok('isBirthday today', isBirthday('2012-10-15', new Date(2026, 9, 15)));
ok('isBirthday false', !isBirthday('2012-10-14', new Date(2026, 9, 15)));
ok('isBirthday null', !isBirthday(null, new Date(2026, 9, 15)));

const mem = new Map();
const store = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
};
const fresh = loadPlayer(store);
ok('fresh unseen', fresh.seen === false && fresh.name === '' && fresh.dob === null);
savePlayer({ v: 1, name: finalName('Ava✨'), dob: iso(2015, 4, 3), seen: true }, store);
ok('stored under key', mem.has(PLAYER_KEY));
const back = loadPlayer(store);
ok('roundtrip name', back.name === 'Ava');
ok('roundtrip dob', back.dob === '2015-04-03');
ok('roundtrip seen', back.seen === true);
mem.set(PLAYER_KEY, '{not-json');
const bad = loadPlayer(store);
ok('corrupt → fresh', bad.seen === false && bad.name === '');

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
