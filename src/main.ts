import '@fontsource/cinzel/latin-700.css';
import '@fontsource/cinzel/latin-900.css';
import './styles.css';

import { animFrame, catalog, loadImages, url, type Images } from './assets';
import { AudioEngine, type Track } from './audio';
import { CutscenePlayer, type CutsceneId } from './cutscene';
import {
  CLASSES, JOURNAL_PROPS, MODIFIERS, REGIONS, TRAVELERS, UPGRADES, regionById, styleRank, upgradeCost,
  type CharacterId, type PropId, type RegionId, type TravelerId,
} from './data';
import { Input, moveFocus } from './input';
import { Renderer } from './render';
import { Rng, dayKey, dayNumber, hashString } from './rng';
import { load, store, type DailyRecord, type SaveData } from './save';
import { parseChallenge, shareRun, strip, type RunSummary } from './share';
import { NO_INPUT, STEP, World, type InputFrame, type Loadout, type SimEvent } from './simulation';

// ───────────────────────── DOM helpers ─────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  el.append(...kids);
  return el;
};

// ───────────────────────── state ─────────────────────────

type Mode =
  | { kind: 'campaign'; regionIndex: number }
  | { kind: 'daily'; day: number; key: string }
  | { kind: 'trial'; region: RegionId; beat?: number };

interface Session {
  world: World;
  mode: Mode;
  traveler: TravelerId;
  seed: number;
  waves: string;
  waveHit: boolean;
  seconds: number;
  ended: boolean;
  lastScore: number;
}

const save: SaveData = load();
const audio = new AudioEngine();
let images: Images;
let renderer: Renderer;
let input: Input;
let cutscenes: CutscenePlayer;

let session: Session | null = null;
let state: 'boot' | 'menu' | 'cutscene' | 'playing' | 'paused' | 'results' = 'boot';
let screenStack: string[] = [];
let pendingTraveler: TravelerId = save.campaign.traveler ?? 'sable';
let trialPick: { region: RegionId; traveler: TravelerId } = { region: 'desert', traveler: pendingTraveler };
let challenge = parseChallenge(location.search);

let acc = 0;
let hitstop = 0;
let slowT = 0;
let slowScale = 1;
let bossIntro = 0;
let bossFocus: { x: number; y: number } | null = null;
let deferredInstall: (Event & { prompt: () => Promise<void> }) | null = null;
let coinPitch = 1;
let coinPitchT = 0;

const persist = () => store(save);
const reduced = () => save.settings.reducedMotion;

// ───────────────────────── screens ─────────────────────────

function show(id: string, push = true): void {
  const current = $$('.screen.active').map((e) => e.id).find((x) => x !== 'pause' && x !== 'results');
  if (push && current && current !== id && current !== 'boot' && current !== 'cutscene') screenStack.push(current);
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
  document.body.dataset.screen = id;
  const root = $(`#${id}`);
  const first = ['[aria-checked="true"]', '.btn.primary:not([hidden])', 'button:not([hidden]):not(.back)']
    .map((q) => root.querySelector<HTMLElement>(q)).find(Boolean);
  if (first && id !== 'cutscene' && input?.device !== 'touch') setTimeout(() => first.focus({ preventScroll: true }), 60);
  if (['title', 'select', 'map', 'daily', 'trials', 'upgrades', 'journal', 'settings', 'credits'].includes(id)) {
    state = state === 'paused' ? 'paused' : 'menu';
  }
  refreshCoins();
}

function back(): void {
  if (state === 'paused' && $('#settings').classList.contains('active')) {
    showOverlay('pause');
    return;
  }
  const prev = screenStack.pop() ?? 'title';
  audio.sfx('ui_back');
  enterScreen(prev, false);
}

function showOverlay(id: 'pause' | 'results' | null): void {
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
  if (id) {
    const first = $(`#${id}`).querySelector<HTMLElement>('.btn');
    if (first && input.device !== 'touch') setTimeout(() => first.focus({ preventScroll: true }), 60);
  }
}

function enterScreen(id: string, push = true): void {
  switch (id) {
    case 'title': openTitle(); return;
    case 'select': buildSelect(); break;
    case 'map': buildMap(); break;
    case 'daily': buildDaily(); break;
    case 'trials': buildTrials(); break;
    case 'upgrades': buildUpgrades(); break;
    case 'journal': buildJournal('travelers'); break;
    case 'settings': buildSettings(); break;
    case 'credits': {
      const roll = $('.credits-roll');
      roll.style.animation = 'none';
      void roll.offsetWidth;
      roll.style.animation = '';
      break;
    }
  }
  show(id, push);
}

function toast(text: string, ms = 2600): void {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout((t as unknown as { _t: number })._t);
  (t as unknown as { _t: number })._t = window.setTimeout(() => t.classList.remove('show'), ms);
}

function refreshCoins(): void {
  for (const el of $$('.coin-count')) el.textContent = save.coins.toLocaleString();
}

// ───────────────────────── sprite previews ─────────────────────────

const previews = new Map<HTMLCanvasElement, { cls: CharacterId; anim: string; t: number; rift?: boolean; zoom?: number }>();

function preview(canvas: HTMLCanvasElement, cls: CharacterId, anim = 'idle', rift = false, zoom = 1): HTMLCanvasElement {
  previews.set(canvas, { cls, anim, t: Math.random(), rift, zoom });
  return canvas;
}

function drawPreviews(dt: number): void {
  for (const [c, p] of previews) {
    if (!c.isConnected || c.offsetParent === null) continue;
    p.t += dt;
    const ctx = c.getContext('2d')!;
    const sheet = catalog.characters[p.cls];
    let anim = sheet.anims[p.anim];
    let t = p.t;
    if (!anim.loop && t * anim.fps >= anim.count + 4) {
      p.anim = 'idle';
      p.t = 0;
      anim = sheet.anims.idle;
      t = 0;
    }
    const f = animFrame(anim, t);
    const img = p.rift && p.cls !== 'warden' ? images.rift[p.cls]! : images.chars[p.cls];
    ctx.clearRect(0, 0, c.width, c.height);
    const s = (c.height / (sheet.standHeight * 1.5)) * (p.zoom ?? 1);
    ctx.drawImage(img, (anim.start + f) * sheet.frameW, anim.row * sheet.frameH, sheet.frameW, sheet.frameH,
      c.width / 2 - sheet.pivotX * s, c.height * 0.86 - sheet.pivotY * s, sheet.frameW * s, sheet.frameH * s);
  }
}

// ───────────────────────── title ─────────────────────────

function dailySetup(date = new Date()) {
  const key = dayKey(date);
  const seed = hashString(`daily:${key}`);
  const rng = new Rng(seed);
  const traveler = rng.pick(TRAVELERS);
  const region = rng.pick(REGIONS).id;
  const a = rng.int(0, MODIFIERS.length - 1);
  let b = rng.int(0, MODIFIERS.length - 2);
  if (b >= a) b++;
  return { key, day: dayNumber(date), seed, traveler, region, mods: [MODIFIERS[a].id, MODIFIERS[b].id] };
}

function openTitle(): void {
  screenStack = [];
  state = 'menu';
  session = null;
  setHud(false);
  audio.music('title');
  const cont = $('[data-action="continue"]');
  cont.hidden = !save.campaign.active;
  $('[data-action="new"]').classList.toggle('primary', !save.campaign.active);
  const d = dailySetup();
  $('#daily-num').textContent = `#${d.day}`;
  const rec = save.daily[d.key];
  const mods = d.mods.map((m) => MODIFIERS.find((x) => x.id === m)!.name).join(' + ');
  $('#daily-teaser').textContent = rec
    ? `Today: ${rec.first.score.toLocaleString()} pts · ${save.streak.count > 1 ? `🔥 ${save.streak.count}-day streak` : 'Share it!'}`
    : `${CLASSES[d.traveler].name} · ${mods}`;
  $('#install-btn').hidden = !deferredInstall;
  show('title', false);
}

// ───────────────────────── select ─────────────────────────

function statBars(cls: TravelerId): HTMLElement {
  const c = CLASSES[cls];
  const rows: [string, number][] = [
    ['Health', c.maxHp / 140], ['Speed', c.speed / 260], ['Power', c.damage / 21], ['Reach', c.reach / 80],
  ];
  const el = h('div', { class: 'stats' });
  for (const [k, v] of rows) {
    const m = h('div', { class: 'meter' }, h('i'));
    (m.firstChild as HTMLElement).style.width = `${Math.round(v * 100)}%`;
    el.append(h('span', { textContent: k }), m);
  }
  return el;
}

function buildSelect(): void {
  const roster = $('.roster');
  roster.replaceChildren();
  for (const id of TRAVELERS) {
    const c = CLASSES[id];
    const canvas = preview(h('canvas', { class: 'preview', width: 240, height: 240 }), id);
    const card = h('button', { class: 'card' },
      canvas,
      h('span', { class: 'role', textContent: c.role }),
      h('h3', { textContent: `${c.name}, ${c.title}` }),
      h('p', { class: 'blurb', textContent: c.blurb }),
      h('p', { class: 'special-line' }, h('b', { textContent: c.specialName }), ` — ${c.specialText}`),
      statBars(id),
    );
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(id === pendingTraveler));
    const pick = () => {
      if (pendingTraveler !== id) audio.sfx('ui_move');
      pendingTraveler = id;
      for (const el of $$('.card', roster)) el.setAttribute('aria-checked', String(el === card));
      previews.set(canvas, { cls: id, anim: 'special', t: 0 });
    };
    card.addEventListener('click', pick);
    card.addEventListener('focus', pick);
    roster.append(card);
  }
}

function loadout(traveler: TravelerId): Loadout {
  const u = save.upgrades;
  return {
    traveler,
    hpMult: 1 + u.vitality * 0.12,
    dmgMult: 1 + u.edge * 0.1,
    cdMult: 1 - u.focus * 0.1,
    speedMult: 1 + u.stride * 0.06,
    dodgeCostMult: 1 - u.stride * 0.1,
  };
}

async function startCampaignNew(): Promise<void> {
  audio.sfx('ui_ok');
  save.campaign = { traveler: pendingTraveler, region: 0, active: true };
  persist();
  await playCutscene('prologue', pendingTraveler);
  startRun({ kind: 'campaign', regionIndex: 0 }, pendingTraveler);
}

// ───────────────────────── map ─────────────────────────

function buildMap(): void {
  const route = $('.route');
  route.replaceChildren();
  REGIONS.forEach((r, i) => {
    const done = save.completed || i < save.campaign.region;
    const current = !save.completed && i === save.campaign.region;
    const locked = !done && !current;
    const thumb = h('div', { class: 'thumb' });
    thumb.style.backgroundImage = `url(${url(catalog.backgrounds[r.id].thumb)})`;
    route.append(h('div', { class: `node ${done ? 'done' : ''} ${current ? 'current' : ''} ${locked ? 'locked' : ''}` },
      thumb,
      h('div', {},
        h('div', { class: 'num', textContent: `REGION ${r.numeral}` }),
        h('div', { class: 'nm', textContent: r.name }),
        h('div', { class: 'st', textContent: done ? 'Beacon lit' : current ? 'Next stop' : 'Uncharted' }),
      ),
    ));
  });
  $('#map-go').textContent = save.completed ? 'Replay Finale Region' : `Enter ${REGIONS[save.campaign.region].name}`;
}

// ───────────────────────── daily ─────────────────────────

function buildDaily(): void {
  const d = dailySetup();
  $('#daily-head-num').textContent = `#${d.day}`;
  $('#daily-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#daily-traveler').textContent = `${CLASSES[d.traveler].name}, ${CLASSES[d.traveler].title}`;
  $('#daily-region').textContent = regionById(d.region).name;
  $('.daily-hero').style.setProperty('--hero', `url(${url(catalog.backgrounds[d.region].thumb)})`);
  preview($<HTMLCanvasElement>('#daily-preview'), d.traveler, 'special');
  $('#daily-mods').replaceChildren(...d.mods.map((id) => {
    const m = MODIFIERS.find((x) => x.id === id)!;
    return h('li', {}, h('b', { textContent: `${m.glyph} ${m.name}` }), m.text);
  }));
  const rec = save.daily[d.key];
  const recs = $('#daily-records');
  recs.replaceChildren();
  if (rec) {
    recs.append(
      h('div', { class: 'rec' }, h('span', { textContent: 'Official run' }), h('b', { textContent: rec.first.score.toLocaleString() })),
      h('div', { class: 'rec' }, h('span', { textContent: 'Best today' }), h('b', { textContent: rec.best.score.toLocaleString() })),
      h('div', { class: 'rec' }, h('span', { textContent: 'Waves' }), h('b', { textContent: strip(rec.first.strip) || '—' })),
    );
  }
  if (save.streak.count > 0) recs.append(h('div', { class: 'rec' }, h('span', { textContent: 'Streak' }), h('b', { textContent: `🔥 ${save.streak.count}` })));
  $('#daily-share').hidden = !rec;
  $('#daily-go').textContent = rec ? 'Practice Run' : 'Enter the Rift';
}

// ───────────────────────── trials ─────────────────────────

function buildTrials(): void {
  const regions = $('.trial-regions');
  regions.replaceChildren();
  REGIONS.forEach((r, i) => {
    const unlocked = i < save.unlocked || save.completed;
    const b = h('button', { class: 'pick', disabled: !unlocked },
      h('img', { src: url(catalog.backgrounds[r.id].thumb), alt: '' }),
      h('b', { textContent: r.name }),
      h('small', { textContent: unlocked ? `Best ${(save.trials[r.id] ?? 0).toLocaleString()}` : 'Reach it in the campaign' }),
    );
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(trialPick.region === r.id));
    b.addEventListener('click', () => {
      trialPick.region = r.id;
      audio.sfx('ui_move');
      for (const el of $$('.pick', regions)) el.setAttribute('aria-checked', String(el === b));
    });
    regions.append(b);
  });
  const travelers = $('.trial-travelers');
  travelers.replaceChildren();
  for (const id of TRAVELERS) {
    const b = h('button', { class: 'pick' }, preview(h('canvas', { width: 160, height: 160 }), id), h('b', { textContent: CLASSES[id].name }));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(trialPick.traveler === id));
    b.addEventListener('click', () => {
      trialPick.traveler = id;
      audio.sfx('ui_move');
      for (const el of $$('.pick', travelers)) el.setAttribute('aria-checked', String(el === b));
    });
    travelers.append(b);
  }
}

// ───────────────────────── upgrades ─────────────────────────

function buildUpgrades(): void {
  const list = $('.upgrade-list');
  list.replaceChildren();
  for (const u of UPGRADES) {
    const lvl = save.upgrades[u.id];
    const maxed = lvl >= u.max;
    const cost = upgradeCost(u, lvl);
    const pips = h('div', { class: 'pips' }, ...Array.from({ length: u.max }, (_, i) => h('i', { class: i < lvl ? 'on' : '' })));
    const buy = h('button', { class: 'btn small', disabled: maxed || save.coins < cost, textContent: maxed ? 'Maxed' : `Buy · ${cost}` });
    buy.addEventListener('click', () => {
      if (save.coins < cost || maxed) return;
      save.coins -= cost;
      save.upgrades[u.id]++;
      persist();
      audio.sfx('heal');
      buildUpgrades();
      refreshCoins();
      $$<HTMLButtonElement>('.upg .btn')[UPGRADES.indexOf(u)]?.focus();
    });
    list.append(h('div', { class: 'upg' }, h('img', { src: url(catalog.ui[u.icon].src), alt: '' }), h('h3', { textContent: u.name }), h('p', { textContent: u.text }), pips, buy));
  }
}

// ───────────────────────── journal ─────────────────────────

const UI_NAMES: Record<string, string> = {
  panel: 'Field panel', button_normal: 'Brass plate', button_active: 'Lit plate', button_disabled: 'Spent plate',
  attack: 'Strike sigil', dash: 'Dodge sigil', special: 'Special sigil', shield: 'Ward sigil',
  health_frame: 'Vital gauge', stamina_frame: 'Stamina gauge', health_fill: 'Vital fill', stamina_fill: 'Tide fill',
  route_coin: 'Route coin', medkit: 'Field kit', battery: 'Relay cell', joystick: 'Compass stick',
};

function buildJournal(tab: string): void {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.tab === tab);
  const body = $('.journal-body');
  body.replaceChildren();
  if (tab === 'travelers' || tab === 'echoes') {
    const ids: CharacterId[] = tab === 'travelers' ? ['sable', 'rook', 'iona', 'warden'] : ['sable', 'rook', 'iona'];
    for (const id of ids) {
      const c = CLASSES[id];
      const canvas = preview(h('canvas', { width: 160, height: 160 }), id, 'idle', tab === 'echoes');
      canvas.addEventListener('click', () => previews.set(canvas, { cls: id, anim: 'special', t: 0, rift: tab === 'echoes' }));
      body.append(h('div', { class: 'entry' }, canvas,
        h('b', { textContent: tab === 'echoes' ? `${c.name}’s Echo` : `${c.name}` }),
        h('p', { textContent: tab === 'echoes'
          ? { sable: 'Lunges along a red line. Step off it.', rook: 'Drops slowing route-fields on your position.', iona: 'Charges a tide ring around itself. Back off or dodge through.' }[id as TravelerId]
          : `${c.title}. ${c.blurb}` }),
      ));
    }
    if (tab === 'echoes') body.append(h('div', { class: 'entry' }, h('b', { textContent: 'Elite Echoes' }), h('p', { textContent: 'Gold-ringed, tougher, and they ignore light hits while winding up. Read the tell, then punish.' })));
  } else if (tab === 'props') {
    for (const [id, text] of Object.entries(JOURNAL_PROPS) as [PropId, string][]) {
      body.append(h('div', { class: 'entry' }, h('img', { src: url(catalog.props.frames[id].src), alt: '' }), h('b', { textContent: id.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) }), h('p', { textContent: text })));
    }
  } else if (tab === 'ui') {
    for (const [id, meta] of Object.entries(catalog.ui)) {
      body.append(h('div', { class: 'entry' }, h('img', { src: url(meta.src), alt: '' }), h('b', { textContent: UI_NAMES[id] ?? id })));
    }
  } else {
    const s = save.stats;
    const rows: [string, string][] = [
      ['Echoes dispersed', s.kills.toLocaleString()], ['Perfect dodges', s.perfects.toLocaleString()],
      ['Best combo', String(s.bestCombo)], ['Runs', String(s.runs)],
      ['Time on the road', `${Math.floor(s.seconds / 60)}m`], ['Daily streak', `${save.streak.count}`],
      ...REGIONS.map((r) => [`${r.name} best`, (save.trials[r.id] ?? 0).toLocaleString()] as [string, string]),
    ];
    for (const [k, v] of rows) body.append(h('div', { class: 'entry stat' }, h('b', { textContent: v }), h('p', { textContent: k })));
  }
}

// ───────────────────────── settings ─────────────────────────

function buildSettings(): void {
  const form = $<HTMLFormElement>('.settings-form');
  const s = save.settings;
  for (const el of $$<HTMLInputElement>('input', form)) {
    const k = el.name as keyof typeof s;
    if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = String(s[k]);
  }
}

function applySettings(): void {
  const s = save.settings;
  audio.setVolumes(s.master, s.music, s.sfx, s.muted);
  document.body.classList.toggle('reduced-motion', s.reducedMotion);
  if (input) input.haptics = s.haptics;
}

// ───────────────────────── HUD ─────────────────────────

const hud = {
  hpFill: () => $('#hud .bar.hp .fill'),
  hpLag: () => $('#hud .bar.hp .lag'),
};
let hudCache: Record<string, string | number | boolean> = {};

function setHud(on: boolean): void {
  $('#hud').classList.toggle('active', on);
  $('#touch').classList.toggle('active', on);
  document.body.classList.toggle('playing', on);
  hudCache = {};
}

function setOnce(key: string, value: string | number | boolean, apply: () => void): void {
  if (hudCache[key] === value) return;
  hudCache[key] = value;
  apply();
}

function drawPortrait(t: TravelerId): void {
  const c = $<HTMLCanvasElement>('#hud .portrait');
  const ctx = c.getContext('2d')!;
  const sheet = catalog.characters[t];
  const a = sheet.anims.idle;
  ctx.clearRect(0, 0, c.width, c.height);
  const s = 0.95;
  ctx.save();
  ctx.beginPath();
  ctx.arc(36, 36, 34, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(images.chars[t], a.start * sheet.frameW, a.row * sheet.frameH, sheet.frameW, sheet.frameH,
    36 - sheet.pivotX * s, 36 + (sheet.standHeight - 30) * s - sheet.pivotY * s + 2, sheet.frameW * s, sheet.frameH * s);
  ctx.restore();
}

function updateHud(): void {
  if (!session) return;
  const w = session.world;
  const p = w.player;
  const hp = Math.max(0, p.hp / p.maxHp);
  setOnce('hp', Math.round(hp * 1000), () => {
    hud.hpFill().style.transform = `scaleX(${hp})`;
    hud.hpLag().style.transform = `scaleX(${hp})`;
    $('#hud .bar.hp .val').textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
    $('.hud-tl').classList.toggle('low', hp < 0.3);
  });
  setOnce('st', Math.round(p.stamina), () => ($('#hud .bar.st .fill').style.transform = `scaleX(${p.stamina / 100})`));
  const cd = p.specialCdMax ? p.specialCd / p.specialCdMax : 0;
  setOnce('cd', Math.round(cd * 100), () => {
    for (const el of $$('.act.special .cd, #btn-special .cd')) el.style.setProperty('--cd', String(cd));
    $('.act.special').classList.toggle('ready', cd <= 0);
    $('#btn-special').classList.toggle('ready', cd <= 0);
  });
  setOnce('score', w.score, () => {
    const s = $('#hud .score');
    s.textContent = w.score.toLocaleString();
    if (w.score - session!.lastScore > 90) {
      s.classList.remove('bump');
      void s.offsetWidth;
      s.classList.add('bump');
    }
    session!.lastScore = w.score;
  });
  setOnce('coins', w.coins, () => ($('#hud .run-coins').textContent = String(w.coins)));
  const waveText = Number.isFinite(w.waveTotal) ? `WAVE ${Math.min(w.wave, w.waveTotal)} / ${w.waveTotal}` : `WAVE ${w.wave}`;
  setOnce('wave', waveText, () => ($('#hud .wave-label').textContent = `${w.region.name.toUpperCase()} · ${waveText}`));

  const rank = styleRank(w.combo);
  const style = $('#hud .style');
  setOnce('combo', w.combo, () => {
    style.classList.toggle('on', w.combo >= 3);
    $('.style-combo').textContent = `${w.combo} hit${w.combo === 1 ? '' : 's'}`;
  });
  setOnce('rank', rank.letter, () => {
    const el = $('.style-rank');
    el.textContent = rank.letter;
    $('.style-name').textContent = rank.name;
    style.dataset.rank = rank.letter;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  });
  ($('.style-bar i') as HTMLElement).style.transform = `scaleX(${Math.max(0, w.comboT / 3.2)})`;

  const b = w.boss;
  setOnce('boss', !!b, () => ($('#hud .boss').hidden = !b));
  if (b) {
    const f = Math.max(0, b.hp / b.maxHp);
    setOnce('bosshp', Math.round(f * 1000), () => {
      $('#hud .boss-bar .fill').style.transform = `scaleX(${f})`;
      $('#hud .boss-bar .lag').style.transform = `scaleX(${f})`;
    });
  }
  const m = session.mode;
  if (m.kind === 'trial' && m.beat) {
    setOnce('target', w.score >= m.beat, () => {
      const el = $('#hud .target-label');
      el.hidden = false;
      el.textContent = w.score >= m.beat! ? `Target beaten! ${m.beat!.toLocaleString()}` : `Target ${m.beat!.toLocaleString()}`;
    });
  } else setOnce('target', 'none', () => ($('#hud .target-label').hidden = true));
}

function banner(kicker: string, title: string, sub = '', kind = ''): void {
  const b = $('#banner');
  b.className = '';
  $('.b-k', b).textContent = kicker;
  $('.b-t', b).textContent = title;
  $('.b-s', b).textContent = sub;
  void b.offsetWidth;
  b.className = `show ${kind}`;
}

// ───────────────────────── runs ─────────────────────────

function regionFor(mode: Mode): { region: RegionId; index: number } {
  if (mode.kind === 'campaign') return { region: REGIONS[mode.regionIndex].id, index: mode.regionIndex };
  if (mode.kind === 'daily') return { region: dailySetup().region, index: 1 };
  const index = REGIONS.findIndex((r) => r.id === mode.region);
  return { region: mode.region, index };
}

function startRun(mode: Mode, traveler: TravelerId, seed?: number): void {
  const { region, index } = regionFor(mode);
  const def = regionById(region);
  const daily = mode.kind === 'daily' ? dailySetup() : null;
  const s = seed ?? daily?.seed ?? ((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  const world = new World({
    region: def,
    regionIndex: index,
    loadout: loadout(traveler),
    seed: s,
    endless: mode.kind !== 'campaign',
    modifiers: daily?.mods ?? [],
    assist: save.settings.assist,
  });
  session = { world, mode, traveler, seed: s, waves: '', waveHit: false, seconds: 0, ended: false, lastScore: 0 };
  renderer.reset(def, world.player.x, world.player.y - 40);
  acc = 0;
  hitstop = 0;
  slowT = 0;
  bossIntro = 0;
  bossFocus = null;
  input.clear();
  input.enabled = true;
  state = 'playing';
  showOverlay(null);
  setHud(true);
  drawPortrait(traveler);
  audio.music(def.id);
  audio.setIntensity(0.3);
  const kicker = mode.kind === 'daily' ? `Daily Rift #${daily!.day}` : mode.kind === 'trial' ? 'Arena Trial' : `Region ${def.numeral}`;
  const sub = mode.kind === 'daily' ? daily!.mods.map((m) => MODIFIERS.find((x) => x.id === m)!.name).join(' · ') : def.tagline;
  banner(kicker, def.name, sub);
  save.stats.runs++;
  persist();
}

function handleEvents(events: SimEvent[]): void {
  if (!session) return;
  const w = session.world;
  const opts = renderOpts();
  renderer.consume(events, w, opts);
  for (const e of events) {
    switch (e.type) {
      case 'swing':
        audio.sfx('swing', { pitch: e.who === 'player' ? 1 + e.step * 0.15 : 0.7, vol: e.who === 'player' ? 1 : 0.6 });
        break;
      case 'hit':
        if (e.team === 'echo') {
          audio.sfx(e.finisher || e.crit ? 'heavy' : 'hit', { pitch: 0.9 + Math.random() * 0.2 });
          if (e.finisher) renderer.kick(0.4);
        }
        break;
      case 'hurt':
        audio.sfx('hurt');
        input.vibrate(45);
        session.waveHit = true;
        break;
      case 'kill':
        audio.sfx('kill', { pitch: e.elite ? 0.7 : 1 });
        input.vibrate(15);
        save.stats.kills++;
        break;
      case 'dodge':
        audio.sfx('dodge');
        break;
      case 'perfect':
        audio.sfx('perfect');
        input.vibrate([10, 30, 10]);
        save.stats.perfects++;
        break;
      case 'special':
        if (e.team === 'player') {
          audio.sfx(`special_${e.cls}`);
          renderer.kick(0.6);
        } else audio.sfx('whoosh', { vol: 0.5 });
        break;
      case 'telegraph':
        audio.sfx(['slam', 'lanes', 'ring', 'summon'].includes(e.move) ? 'horn' : 'telegraph', { vol: 0.7, pitch: e.move === 'ring' ? 1.3 : 1 });
        break;
      case 'impact':
        audio.sfx('slam', { vol: e.big ? 1 : 0.6 });
        break;
      case 'pickup':
        if (e.kind === 'coin') {
          coinPitch = coinPitchT > 0 ? Math.min(2, coinPitch + 0.05) : 1;
          coinPitchT = 0.4;
          audio.sfx('coin', { pitch: coinPitch, vol: 0.7 });
        } else if (e.kind === 'medkit') audio.sfx('heal');
        else audio.sfx('ready');
        break;
      case 'propBreak':
        audio.sfx('break');
        break;
      case 'spawn':
        audio.sfx('spawn', { vol: 0.5 });
        break;
      case 'waveStart':
        session.waveHit = false;
        if (e.boss) {
          bossIntro = 2.6;
          bossFocus = null;
          audio.music('boss');
          audio.sfx('roar');
          banner(CLASSES.warden.title, CLASSES.warden.name, '', 'boss');
        } else if (e.wave > 1 || session.mode.kind !== 'campaign') {
          audio.sfx('wave');
          if (e.wave > 1) banner(Number.isFinite(w.waveTotal) && e.wave === w.waveTotal ? 'Final wave' : `Wave ${e.wave}`, e.wave % 5 === 0 && !Number.isFinite(w.waveTotal) ? 'The Rift surges' : 'Echoes incoming');
        }
        break;
      case 'waveClear':
        session.waves += session.waveHit ? 'h' : 'c';
        audio.sfx('clear');
        if (w.status === 'playing') banner('', 'Wave Cleared', session.waveHit ? '' : 'Untouched!', 'clear');
        if (w.region.id && session.mode.kind === 'campaign' && w.status === 'playing') audio.music(w.region.id);
        if (!Number.isFinite(w.waveTotal) && w.boss === null) audio.music(w.region.id);
        break;
      case 'bossPhase':
        audio.sfx('roar');
        banner('The Gatewarden', e.phase === 2 ? 'Route Lock Rising' : 'Meridian Overload', '', 'boss');
        break;
      case 'stagger':
        audio.sfx('heavy');
        break;
      case 'hitstop':
        hitstop = Math.max(hitstop, reduced() ? e.time * 0.5 : e.time);
        break;
      case 'slowmo':
        slowT = reduced() ? e.time * 0.4 : e.time;
        slowScale = e.scale;
        break;
      case 'staminaEmpty': {
        audio.sfx('empty');
        const st = $('#hud .bar.st');
        st.classList.remove('empty');
        void st.offsetWidth;
        st.classList.add('empty');
        break;
      }
      case 'specialReady':
        audio.sfx('ready', { vol: 0.6 });
        break;
      case 'victory':
        audio.sfx('victory');
        banner(session.mode.kind === 'campaign' ? 'Beacon relit' : '', session.mode.kind === 'campaign' ? 'Region Reclaimed' : 'Victory', '', 'clear');
        break;
      case 'defeat':
        session.waves += 'x';
        audio.sfx('defeat');
        audio.music('none');
        input.vibrate([60, 40, 120]);
        break;
      default:
        break;
    }
  }
}

function renderOpts() {
  return {
    reducedMotion: save.settings.reducedMotion,
    shakeScale: save.settings.shake,
    damageNumbers: save.settings.damageNumbers,
    focus: bossIntro > 0 && session?.world.boss ? { x: session.world.boss.x, y: session.world.boss.y - 80, zoom: 1.25 } : bossFocus,
  };
}

function stepGame(rdt: number): void {
  if (!session) return;
  const w = session.world;
  session.seconds += rdt;
  coinPitchT -= rdt;
  if (bossIntro > 0) bossIntro -= rdt;

  let frame: InputFrame = bossIntro > 0 ? NO_INPUT : input.poll();
  if (hitstop > 0) {
    hitstop -= rdt;
    renderer.draw(w, 0, renderOpts());
    updateHud();
    return;
  }
  let scale = 1;
  if (slowT > 0) {
    slowT -= rdt;
    scale = slowScale + (1 - slowScale) * Math.max(0, 1 - slowT / 0.3) * (slowT < 0.3 ? 1 : 0);
  }
  acc += rdt * scale;
  let steps = 0;
  while (acc >= STEP && steps < 6) {
    w.step(frame);
    frame = { ...frame, attack: false, dodge: false, special: false };
    acc -= STEP;
    steps++;
    handleEvents(w.drainEvents());
    if (hitstop > 0) { acc = 0; break; }
  }
  if (steps === 6) acc = 0;

  const echoes = w.fighters.filter((f) => f.team === 'echo' && f.state !== 'dead').length;
  audio.setIntensity(Math.min(1, echoes / 6 + w.combo / 40 + (w.boss ? 0.5 : 0)));
  renderer.draw(w, rdt * scale, renderOpts());
  updateHud();

  if (w.status !== 'playing' && !session.ended && w.endT > (w.status === 'won' ? 2.4 : 2.0)) {
    session.ended = true;
    finishRun();
  }
}

function rankFor(w: World): string {
  // Run rank blends best combo, damage avoided and perfect dodges.
  const avoid = Math.max(0, 1 - w.damageTaken / (w.player.maxHp * 2));
  const v = w.maxCombo * 0.6 + avoid * 30 + w.perfects * 3;
  return v >= 60 ? 'SS' : v >= 45 ? 'S' : v >= 32 ? 'A' : v >= 20 ? 'B' : v >= 10 ? 'C' : 'D';
}

function finishRun(): void {
  if (!session) return;
  const s = session;
  const w = s.world;
  const won = w.status === 'won';
  input.enabled = false;
  state = 'results';
  save.coins += w.coins;
  save.stats.bestCombo = Math.max(save.stats.bestCombo, w.maxCombo);
  save.stats.seconds += s.seconds;
  const rank = rankFor(w);
  const summary: RunSummary = {
    mode: s.mode.kind, day: s.mode.kind === 'daily' ? s.mode.day : undefined, region: w.region.id, traveler: s.traveler,
    score: w.score, wave: w.wave, maxCombo: w.maxCombo, perfects: w.perfects, kills: w.kills, rank,
    modifiers: s.mode.kind === 'daily' ? dailySetup().mods : [], waves: s.waves || 'x', seed: s.seed,
  };

  let best = false;
  let kicker = '';
  let title = '';
  const buttons: [string, () => void, boolean?][] = [];

  if (s.mode.kind === 'campaign') {
    const ri = s.mode.regionIndex;
    kicker = `Region ${w.region.numeral} · ${w.region.name}`;
    if (won) {
      title = ri === 2 ? 'The Gate Is Open' : 'Region Reclaimed';
      const next = ri + 1;
      save.unlocked = Math.max(save.unlocked, Math.min(3, next + 1));
      if (next >= 3) {
        save.completed = true;
        save.campaign.active = false;
        save.campaign.region = 2;
        buttons.push(['Watch the Ending', async () => {
          await playCutscene('finale', s.traveler);
          enterScreen('credits');
          audio.music('title');
        }, true]);
      } else {
        save.campaign.region = next;
        buttons.push(['Continue the Route', async () => {
          await playCutscene(next === 1 ? 'tidal' : 'highland', s.traveler);
          startRun({ kind: 'campaign', regionIndex: next }, s.traveler);
        }, true]);
        buttons.push(['Outfitter', () => { setHud(false); enterScreen('upgrades'); screenStack = ['map']; }]);
        buttons.push(['Route Map', () => { setHud(false); enterScreen('map'); screenStack = ['title']; }]);
      }
    } else {
      title = 'You Fell';
      buttons.push(['Try Again', () => startRun(s.mode, s.traveler), true]);
      buttons.push(['Outfitter', () => { setHud(false); enterScreen('upgrades'); screenStack = ['map']; }]);
      buttons.push(['Route Map', () => { setHud(false); enterScreen('map'); screenStack = ['title']; }]);
    }
  } else if (s.mode.kind === 'daily') {
    const key = s.mode.key;
    const rec: DailyRecord = { score: w.score, wave: w.wave, combo: w.maxCombo, rank, traveler: s.traveler, strip: summary.waves, perfects: w.perfects };
    const existing = save.daily[key];
    if (!existing) {
      save.daily[key] = { first: rec, best: rec };
      const yesterday = dayKey(new Date(Date.now() - 86_400_000));
      save.streak = { last: key, count: save.streak.last === yesterday ? save.streak.count + 1 : 1 };
      best = true;
    } else if (rec.score > existing.best.score) {
      existing.best = rec;
      best = true;
    }
    // Keep the daily table small.
    const keys = Object.keys(save.daily).sort();
    while (keys.length > 60) delete save.daily[keys.shift()!];
    kicker = `Daily Rift #${s.mode.day}${existing ? ' · practice' : ' · official'}`;
    title = `Wave ${w.wave}`;
    buttons.push(['Share Result', () => doShare(summary), true]);
    buttons.push(['Run It Back', () => startRun(s.mode, s.traveler)]);
    buttons.push(['Title', () => openTitle()]);
  } else {
    const prev = save.trials[w.region.id] ?? 0;
    if (w.score > prev) {
      save.trials[w.region.id] = w.score;
      best = true;
    }
    kicker = `Arena Trial · ${w.region.name}`;
    const beat = s.mode.beat;
    title = beat ? (w.score >= beat ? 'Challenge Beaten!' : 'So Close') : `Wave ${w.wave}`;
    buttons.push(['Challenge a Friend', () => doShare(summary), true]);
    buttons.push(['Again', () => startRun(s.mode, s.traveler, beat ? s.seed : undefined)]);
    buttons.push(['Title', () => openTitle()]);
  }
  persist();

  $('.r-kicker').textContent = kicker;
  $('.r-title').textContent = title;
  $('.r-rank').textContent = rank;
  $('.r-best').hidden = !best;
  const scoreEl = $('.r-score b');
  countUp(scoreEl, w.score, 1.1);
  $('.r-strip').replaceChildren(...[...summary.waves].map((c, i) => {
    const el = h('i', { class: c, title: c === 'c' ? 'Clean wave' : c === 'h' ? 'Wave cleared' : 'Fell here' });
    el.style.animationDelay = `${0.5 + i * 0.06}s`;
    return el;
  }));
  const stats: [string, string][] = [
    ['Echoes dispersed', String(w.kills)], ['Max combo', String(w.maxCombo)],
    ['Perfect dodges', String(w.perfects)], ['Damage taken', String(Math.round(w.damageTaken))],
    ['Route coins', `+${w.coins}`], ['Time', `${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds % 60)).padStart(2, '0')}`],
  ];
  $('.r-stats').replaceChildren(...stats.map(([k, v]) => h('div', {}, h('dt', { textContent: k }), h('dd', { textContent: v }))));
  const box = $('.r-buttons');
  box.replaceChildren(...buttons.map(([label, fn, primary], i) => {
    const b = h('button', { class: `btn ${primary ? 'primary wide' : 'small'}`, textContent: label });
    b.addEventListener('click', () => {
      audio.sfx('ui_ok');
      fn();
    });
    if (i === 0 && buttons.length === 1) b.classList.add('wide');
    return b;
  }));
  showOverlay('results');
}

function countUp(el: HTMLElement, to: number, seconds: number): void {
  const start = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / (seconds * 1000));
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function doShare(s: RunSummary): Promise<void> {
  const r = await shareRun(s, images);
  if (r === 'copied') toast('Result copied — card image downloaded. Paste it anywhere!');
  else if (r === 'failed') toast('Could not open the share sheet on this device.');
}

// ───────────────────────── pause ─────────────────────────

function pause(): void {
  if (state !== 'playing' || !session || session.ended) return;
  state = 'paused';
  input.enabled = false;
  audio.sfx('ui_back');
  audio.suspend();
  const w = session.world;
  $('.pause-info').textContent = `${w.region.name} · Wave ${w.wave} · ${w.score.toLocaleString()} pts`;
  showOverlay('pause');
}

function resume(): void {
  if (state !== 'paused' || !session) return;
  audio.resume();
  state = 'playing';
  input.clear();
  input.enabled = true;
  showOverlay(null);
  setHud(true);
}

async function playCutscene(id: CutsceneId, traveler: TravelerId): Promise<void> {
  state = 'cutscene';
  input.enabled = false;
  setHud(false);
  show('cutscene', false);
  await cutscenes.play(id, traveler);
  state = 'menu';
}

// ───────────────────────── wiring ─────────────────────────

function wire(): void {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const a = el.dataset.action!;
    if (a !== 'back') audio.sfx('ui_ok');
    switch (a) {
      case 'back': back(); break;
      case 'title': openTitle(); break;
      case 'continue':
        pendingTraveler = save.campaign.traveler ?? 'sable';
        enterScreen('map');
        break;
      case 'new':
        if (save.campaign.active && !confirm('Start a new campaign? Your current route progress will be reset (coins and upgrades are kept).')) return;
        enterScreen('select');
        break;
      case 'daily': enterScreen('daily'); break;
      case 'trials': enterScreen('trials'); break;
      case 'upgrades': enterScreen('upgrades'); break;
      case 'journal': enterScreen('journal'); break;
      case 'settings':
        if (state === 'paused') { buildSettings(); show('settings', false); state = 'paused'; }
        else enterScreen('settings');
        break;
      case 'credits': enterScreen('credits'); break;
      case 'resume': resume(); break;
      case 'restart':
        if (session) { audio.resume(); startRun(session.mode, session.traveler, session.mode.kind === 'campaign' ? undefined : session.seed); }
        break;
      case 'quit':
        audio.resume();
        if (session && !session.ended) {
          save.coins += session.world.coins;
          persist();
        }
        openTitle();
        break;
    }
  });
  $('#select-go').addEventListener('click', () => startCampaignNew());
  $('#map-go').addEventListener('click', () => {
    audio.sfx('ui_ok');
    const t = save.campaign.traveler ?? pendingTraveler;
    startRun({ kind: 'campaign', regionIndex: save.completed ? 2 : save.campaign.region }, t);
  });
  $('#daily-go').addEventListener('click', () => {
    audio.sfx('ui_ok');
    const d = dailySetup();
    startRun({ kind: 'daily', day: d.day, key: d.key }, d.traveler);
  });
  $('#daily-share').addEventListener('click', () => {
    const d = dailySetup();
    const rec = save.daily[d.key]?.first;
    if (!rec) return;
    doShare({
      mode: 'daily', day: d.day, region: d.region, traveler: rec.traveler, score: rec.score, wave: rec.wave, maxCombo: rec.combo,
      perfects: rec.perfects, kills: 0, rank: rec.rank, modifiers: d.mods, waves: rec.strip, seed: d.seed,
    });
  });
  $('#trial-go').addEventListener('click', () => {
    audio.sfx('ui_ok');
    startRun({ kind: 'trial', region: trialPick.region }, trialPick.traveler);
  });
  for (const t of $$('.tab')) t.addEventListener('click', () => { audio.sfx('ui_move'); buildJournal(t.dataset.tab!); });
  $('.pause-btn').addEventListener('click', (e) => { e.stopPropagation(); pause(); });

  const form = $<HTMLFormElement>('.settings-form');
  form.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.name as keyof SaveData['settings'];
    (save.settings as unknown as Record<string, number | boolean>)[k] = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
    applySettings();
    persist();
    if (el.type === 'range') audio.sfx('ui_move');
  });

  document.addEventListener('ui-back', () => {
    if (state === 'paused' && $('#pause').classList.contains('active')) resume();
    else if (state === 'menu' && !$('#title').classList.contains('active')) back();
  });
  document.addEventListener('ui-move', () => audio.sfx('ui_move', { vol: 0.6 }));
  window.addEventListener('keydown', (e) => {
    if (state === 'menu' || state === 'paused' || state === 'results') {
      const onRange = (e.target as HTMLElement).matches?.('input[type="range"]');
      if (!onRange) {
        const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.code as 'ArrowUp'];
        if (dir) { e.preventDefault(); moveFocus(dir); }
      }
      if (e.code === 'Escape' && state === 'menu' && !$('#title').classList.contains('active')) back();
    }
  });

  // First gesture unlocks audio.
  const unlock = () => {
    audio.unlock();
    applySettings();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state === 'playing') pause();
      audio.suspend();
    } else if (state !== 'paused') audio.resume();
  });
  window.addEventListener('blur', () => { if (state === 'playing') pause(); });
  window.addEventListener('resize', () => {
    renderer.resize();
    cutscenes.resize();
    if (state === 'paused' && session) renderer.draw(session.world, 0, renderOpts());
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as Event & { prompt: () => Promise<void> };
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!deferredInstall) return;
    await deferredInstall.prompt();
    deferredInstall = null;
    $('#install-btn').hidden = true;
  });
}

// ───────────────────────── loop ─────────────────────────

let last = performance.now();
function frame(now: number): void {
  const rdt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  input.update(rdt, state !== 'playing');
  if (cutscenes.active) cutscenes.update(rdt);
  else if (state === 'playing' || (state === 'results' && session && !reduced())) {
    if (state === 'playing') stepGame(rdt);
    else if (session) renderer.draw(session.world, rdt * 0.25, renderOpts());
  }
  drawPreviews(rdt);
  requestAnimationFrame(frame);
}

// ───────────────────────── boot ─────────────────────────

async function boot(): Promise<void> {
  const fill = $('#boot-fill');
  try {
    images = await loadImages((f) => (fill.style.width = `${Math.round(f * 100)}%`));
    await document.fonts?.ready;
  } catch (err) {
    $('#boot-text').textContent = 'Could not load the route maps. Check your connection and reload.';
    console.error(err);
    return;
  }
  const canvas = $<HTMLCanvasElement>('#game');
  renderer = new Renderer(canvas, images);
  input = new Input($('#app'));
  input.bindCanvas(canvas);
  input.onPause = () => {
    if (state === 'playing') pause();
    else if (state === 'paused' && $('#pause').classList.contains('active')) resume();
  };
  input.onDeviceChange = (d) => document.body.classList.toggle('touch', d === 'touch');
  if (matchMedia('(pointer: coarse)').matches) {
    input.device = 'touch';
    document.body.classList.add('touch');
  }
  cutscenes = new CutscenePlayer($('#cutscene'), $<HTMLCanvasElement>('#cs-canvas'), images, audio, reduced);
  applySettings();
  wire();
  requestAnimationFrame(frame);

  if (challenge) {
    const c = challenge;
    challenge = null;
    history.replaceState(null, '', location.pathname);
    openTitle();
    trialPick = { region: c.region, traveler: c.traveler };
    toast(`Challenge accepted: beat ${c.beat.toLocaleString()} as ${CLASSES[c.traveler].name} in ${regionById(c.region).name}. Tap to begin!`, 6000);
    const go = () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      startRun({ kind: 'trial', region: c.region, beat: c.beat }, c.traveler, c.seed);
    };
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return;
  }
  openTitle();
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Expose a tiny hook for automated playtests (no gameplay effect).
declare global {
  interface Window { __wayfarer?: { state: () => string; world: () => World | null; music: (t: Track) => void } }
}
window.__wayfarer = { state: () => state, world: () => session?.world ?? null, music: (t) => audio.music(t) };
