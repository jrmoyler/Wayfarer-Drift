/** Versioned, validated local persistence. Corrupt data never crashes the game. */
import { TRAVELERS, UPGRADES, type RegionId, type TravelerId, type UpgradeDef } from './data';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  shake: number;
  reducedMotion: boolean;
  damageNumbers: boolean;
  assist: boolean;
  haptics: boolean;
}

export interface DailyRecord {
  score: number;
  wave: number;
  combo: number;
  rank: string;
  traveler: TravelerId;
  strip: string;
  perfects: number;
}

export interface SaveData {
  v: 3;
  coins: number;
  upgrades: Record<UpgradeDef['id'], number>;
  campaign: { traveler: TravelerId | null; region: number; active: boolean };
  completed: boolean;
  unlocked: number;
  settings: Settings;
  trials: Partial<Record<RegionId, number>>;
  daily: Record<string, { first: DailyRecord; best: DailyRecord }>;
  stats: { kills: number; perfects: number; runs: number; bestCombo: number; seconds: number };
  streak: { last: string; count: number };
}

const KEY = 'wayfarer-rift-save';

const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function defaults(): SaveData {
  return {
    v: 3,
    coins: 0,
    upgrades: { vitality: 0, edge: 0, focus: 0, stride: 0 },
    campaign: { traveler: null, region: 0, active: false },
    completed: false,
    unlocked: 1,
    settings: {
      master: 0.8, music: 0.6, sfx: 0.85, muted: false, shake: 1,
      reducedMotion: prefersReduced, damageNumbers: true, assist: false, haptics: true,
    },
    trials: {},
    daily: {},
    stats: { kills: 0, perfects: 0, runs: 0, bestCombo: 0, seconds: 0 },
    streak: { last: '', count: 0 },
  };
}

const num = (v: unknown, d: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const isTraveler = (v: unknown): v is TravelerId => typeof v === 'string' && (TRAVELERS as string[]).includes(v);

export function validate(raw: unknown): SaveData {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  d.coins = Math.floor(num(r.coins, 0, 0, 1e7));
  for (const u of UPGRADES) d.upgrades[u.id] = Math.floor(num(r.upgrades?.[u.id], 0, 0, u.max));
  if (r.campaign && typeof r.campaign === 'object') {
    d.campaign.traveler = isTraveler(r.campaign.traveler) ? r.campaign.traveler : null;
    d.campaign.region = Math.floor(num(r.campaign.region, 0, 0, 2));
    d.campaign.active = bool(r.campaign.active, false) && !!d.campaign.traveler;
  }
  d.completed = bool(r.completed, false);
  d.unlocked = Math.floor(num(r.unlocked, 1, 1, 3));
  const s = r.settings ?? {};
  d.settings = {
    master: num(s.master, d.settings.master, 0, 1),
    music: num(s.music, d.settings.music, 0, 1),
    sfx: num(s.sfx, d.settings.sfx, 0, 1),
    muted: bool(s.muted, false),
    shake: num(s.shake, 1, 0, 1),
    reducedMotion: bool(s.reducedMotion, d.settings.reducedMotion),
    damageNumbers: bool(s.damageNumbers, true),
    assist: bool(s.assist, false),
    haptics: bool(s.haptics, true),
  };
  for (const k of ['desert', 'tidal', 'highland'] as RegionId[]) {
    const v = num(r.trials?.[k], -1, 0);
    if (v >= 0) d.trials[k] = Math.floor(v);
  }
  if (r.daily && typeof r.daily === 'object') {
    for (const [day, rec] of Object.entries(r.daily as Record<string, any>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const f = cleanDaily(rec?.first), b = cleanDaily(rec?.best);
      if (f && b) d.daily[day] = { first: f, best: b };
    }
  }
  const st = r.stats ?? {};
  d.stats = {
    kills: Math.floor(num(st.kills, 0, 0)), perfects: Math.floor(num(st.perfects, 0, 0)),
    runs: Math.floor(num(st.runs, 0, 0)), bestCombo: Math.floor(num(st.bestCombo, 0, 0)), seconds: num(st.seconds, 0, 0),
  };
  if (r.streak && typeof r.streak.last === 'string') d.streak = { last: r.streak.last, count: Math.floor(num(r.streak.count, 0, 0)) };
  return d;
}

function cleanDaily(r: any): DailyRecord | null {
  if (!r || typeof r !== 'object' || !isTraveler(r.traveler)) return null;
  return {
    score: Math.floor(num(r.score, 0, 0)), wave: Math.floor(num(r.wave, 0, 0)), combo: Math.floor(num(r.combo, 0, 0)),
    rank: typeof r.rank === 'string' ? r.rank.slice(0, 3) : 'D', traveler: r.traveler,
    strip: typeof r.strip === 'string' ? r.strip.slice(0, 120) : '', perfects: Math.floor(num(r.perfects, 0, 0)),
  };
}

export function load(): SaveData {
  try {
    const text = localStorage.getItem(KEY);
    return text ? validate(JSON.parse(text)) : defaults();
  } catch {
    return defaults();
  }
}

export function store(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* Storage full or blocked (private mode): play on without persistence. */
  }
}
