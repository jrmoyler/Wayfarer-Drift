// Automated browser playtest: drives the real build through every screen,
// fights, and captures screenshots to evidence/. Fails on console errors.
//   npm run build && npm run playtest
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('../evidence/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4173;
const BASE = `http://localhost:${PORT}/`;
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && resolve());
  server.on('exit', reject);
  setTimeout(resolve, 6000);
});

const errors = [];
const log = [];
const step = (m) => { log.push(m); console.log('•', m); };
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return p;
}
const state = (p) => p.evaluate(() => window.__wayfarer?.state());
const world = (p, fn) => p.evaluate(fn);

try {
  // ───────────── desktop ─────────────
  const p = await page({ viewport: { width: 1280, height: 720 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await p.goto(BASE);
  await p.waitForFunction(() => window.__wayfarer?.state() === 'menu', null, { timeout: 20000 });
  await wait(1600);
  await p.screenshot({ path: `${OUT}01-title.png` });
  step('title screen');

  await p.click('[data-action="new"]');
  await wait(700);
  await p.screenshot({ path: `${OUT}02-select.png` });
  step('traveler select');
  await p.click('.card:nth-child(1)');
  await p.click('#select-go');
  await wait(400);
  for (const [i, t] of [[1, 2500], [2, 6000], [3, 3800], [4, 5200], [5, 4600]]) {
    await wait(t);
    await p.screenshot({ path: `${OUT}03-cutscene-${i}.png` });
  }
  step('prologue cutscene frames');
  await p.keyboard.down('Escape');
  await wait(1100);
  await p.keyboard.up('Escape');
  await p.waitForFunction(() => window.__wayfarer?.state() === 'playing', null, { timeout: 30000 });
  await wait(2600);
  await p.screenshot({ path: `${OUT}04-combat-start.png` });
  step('combat started');

  // Fight: move toward Echoes and strike.
  const fight = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const dir = await p.evaluate(() => {
        const w = window.__wayfarer.world();
        if (!w) return null;
        const e = w.fighters.filter((f) => f.team === 'echo' && f.state !== 'dead' && f.state !== 'spawn');
        if (!e.length) return null;
        e.sort((a, b) => Math.hypot(a.x - w.player.x, a.y - w.player.y) - Math.hypot(b.x - w.player.x, b.y - w.player.y));
        const t = e[0];
        return { dx: t.x - w.player.x, dy: t.y - w.player.y, d: Math.hypot(t.x - w.player.x, t.y - w.player.y), cd: w.player.specialCd };
      });
      if (!dir) { await wait(150); continue; }
      const keys = [];
      if (dir.d > 70) {
        if (dir.dx > 20) keys.push('KeyD');
        if (dir.dx < -20) keys.push('KeyA');
        if (dir.dy > 20) keys.push('KeyS');
        if (dir.dy < -20) keys.push('KeyW');
      }
      for (const k of keys) await p.keyboard.down(k);
      await wait(90);
      for (const k of keys) await p.keyboard.up(k);
      if (dir.d < 120) await p.keyboard.press('KeyJ');
      if (dir.d < 160 && dir.cd <= 0) await p.keyboard.press('KeyK');
      if (Math.random() < 0.08) await p.keyboard.press('Space');
    }
  };
  await fight(5000);
  await p.screenshot({ path: `${OUT}05-combat-mid.png` });
  const s1 = await world(p, () => { const w = window.__wayfarer.world(); return { wave: w.wave, kills: w.kills, hp: w.player.hp, score: w.score, combo: w.maxCombo }; });
  step(`after 5s fighting: ${JSON.stringify(s1)}`);
  await fight(9000);
  await p.screenshot({ path: `${OUT}06-combat-late.png` });
  const s2 = await world(p, () => { const w = window.__wayfarer.world(); return { wave: w.wave, kills: w.kills, hp: w.player.hp, score: w.score, combo: w.maxCombo, status: w.status }; });
  step(`after 14s fighting: ${JSON.stringify(s2)}`);
  if (s2.kills === 0) errors.push('No kills landed in 14 seconds of scripted combat');

  // Pause freezes the simulation.
  await p.keyboard.press('Escape');
  await wait(300);
  const tA = await world(p, () => window.__wayfarer.world().time);
  await wait(600);
  const tB = await world(p, () => window.__wayfarer.world().time);
  await p.screenshot({ path: `${OUT}07-pause.png` });
  if (tA !== tB) errors.push('Simulation advanced while paused');
  step(`pause freezes sim (${tA === tB})`);
  await p.click('[data-action="resume"]');
  await wait(200);

  // Fast-forward to the region end by clearing Echoes (test hook only).
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => {
      const w = window.__wayfarer.world();
      for (const f of w.fighters) if (f.team === 'echo' && f.state !== 'dead' && f.state !== 'spawn') w.damage(f, 9999, w.player, {});
      w.player.hp = w.player.maxHp;
    });
    await wait(1700);
  }
  await p.waitForFunction(() => window.__wayfarer?.state() === 'results', null, { timeout: 20000 });
  await wait(1500);
  await p.screenshot({ path: `${OUT}08-results.png` });
  step('region results');

  // Continue → interlude cutscene.
  await p.click('.r-buttons .btn.primary');
  await wait(3000);
  await p.screenshot({ path: `${OUT}09-cutscene-tidal.png` });
  await wait(6000);
  await p.screenshot({ path: `${OUT}09b-cutscene-tidal.png` });
  step('tidal interlude');
  await p.keyboard.down('Escape');
  await wait(1100);
  await p.keyboard.up('Escape');
  await p.waitForFunction(() => window.__wayfarer?.state() === 'playing', null, { timeout: 30000 });
  await wait(2500);
  await fight(4000);
  await p.screenshot({ path: `${OUT}10-tidal-combat.png` });
  step('tidal combat');
  await p.keyboard.press('Escape');
  await p.click('[data-action="quit"]');
  await wait(800);

  // Highland boss via trial-like campaign jump.
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('wayfarer-rift-save'));
    s.campaign = { traveler: 'iona', region: 2, active: true };
    s.unlocked = 3;
    localStorage.setItem('wayfarer-rift-save', JSON.stringify(s));
  });
  await p.reload();
  await p.waitForFunction(() => window.__wayfarer?.state() === 'menu', null, { timeout: 20000 });
  await p.click('[data-action="continue"]');
  await wait(800);
  await p.screenshot({ path: `${OUT}11-map.png` });
  step('route map');
  await p.click('#map-go');
  await wait(2500);
  for (let i = 0; i < 12; i++) {
    const hasBoss = await p.evaluate(() => {
      const w = window.__wayfarer.world();
      if (w.boss) return true;
      for (const f of w.fighters) if (f.team === 'echo' && f.state !== 'dead' && f.state !== 'spawn') w.damage(f, 9999, w.player, {});
      w.player.hp = w.player.maxHp;
      return false;
    });
    if (hasBoss) break;
    await wait(1200);
  }
  await p.waitForFunction(() => !!window.__wayfarer.world()?.boss, null, { timeout: 20000 });
  await wait(1200);
  await p.screenshot({ path: `${OUT}12-boss-intro.png` });
  await wait(2400);
  await fight(7000);
  await p.screenshot({ path: `${OUT}13-boss-fight.png` });
  const b = await world(p, () => { const w = window.__wayfarer.world(); return { boss: w.boss && Math.round(w.boss.hp), hazards: w.hazards.length, hp: w.player.hp }; });
  step(`boss fight: ${JSON.stringify(b)}`);
  await p.evaluate(() => {
    const w = window.__wayfarer.world();
    if (w.boss) w.damage(w.boss, w.boss.maxHp * 0.45, w.player, {});
  });
  await wait(1500);
  await p.screenshot({ path: `${OUT}14-boss-phase.png` });
  await p.keyboard.press('Escape');
  await p.click('[data-action="quit"]');
  await wait(600);

  // Daily briefing + journal + upgrades + settings.
  await p.click('[data-action="daily"]');
  await wait(700);
  await p.screenshot({ path: `${OUT}15-daily.png` });
  await p.click('#daily-go');
  await wait(3000);
  await fight(3000);
  await p.evaluate(() => { const w = window.__wayfarer.world(); w.damage(w.player, 9999, w.fighters.find((f) => f.team === 'echo') ?? w.player, {}); });
  await p.waitForFunction(() => window.__wayfarer?.state() === 'results', null, { timeout: 20000 });
  await wait(1600);
  await p.screenshot({ path: `${OUT}16-daily-results.png` });
  step('daily run + results');
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('.r-buttons .btn.primary')]);
  await download.saveAs(`${OUT}16b-share-card.png`);
  const shared = await p.evaluate(() => navigator.clipboard.readText());
  writeFileSync(`${OUT}share-text.txt`, shared);
  if (!shared.includes('Daily Rift')) errors.push('Share text missing');
  step('share card + text');
  await p.click('.r-buttons .btn:last-child');
  await wait(600);
  for (const [name, sel] of [['17-journal', 'journal'], ['18-upgrades', 'upgrades'], ['19-settings', 'settings'], ['20-trials', 'trials']]) {
    await p.click(`[data-action="${sel}"]`);
    await wait(700);
    if (sel === 'journal') { await p.click('[data-tab="props"]'); await wait(300); }
    await p.screenshot({ path: `${OUT}${name}.png` });
    await p.click(`#${sel} .back`);
    await wait(400);
  }
  step('journal / upgrades / settings / trials');

  // ───────────── phone portrait (touch) ─────────────
  const m = await page({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(BASE);
  await m.waitForFunction(() => window.__wayfarer?.state() === 'menu', null, { timeout: 20000 });
  await wait(1500);
  await m.screenshot({ path: `${OUT}21-phone-title.png` });
  await m.tap('[data-action="trials"]');
  await wait(600);
  await m.screenshot({ path: `${OUT}22-phone-trials.png` });
  await m.tap('#trial-go');
  await wait(3200);
  await m.tap('#btn-attack');
  await wait(400);
  await m.screenshot({ path: `${OUT}23-phone-combat.png` });
  step('phone portrait');

  // ───────────── phone landscape ─────────────
  const l = await page({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await l.goto(BASE);
  await l.waitForFunction(() => window.__wayfarer?.state() === 'menu', null, { timeout: 20000 });
  await wait(1200);
  await l.screenshot({ path: `${OUT}24-landscape-title.png` });
  await l.tap('[data-action="trials"]');
  await wait(500);
  await l.tap('#trial-go');
  await wait(3500);
  await l.screenshot({ path: `${OUT}25-landscape-combat.png` });
  step('phone landscape');
} catch (e) {
  errors.push(`[script] ${e.stack || e}`);
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(`${OUT}playtest.json`, JSON.stringify({ when: new Date().toISOString(), steps: log, errors }, null, 2));
if (errors.length) {
  console.error('\nERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nPlaytest passed with no console errors.');
