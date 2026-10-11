/**
 * Deterministic combat simulation. No DOM, no rendering, no clocks: the host
 * steps it at a fixed 60 Hz and reads `events` after every step to drive
 * audio, camera and effects. Same seed + same inputs = same outcome.
 */
import { Rng } from './rng';
import {
  CLASSES, type CharacterId, type PropId, type RegionDef, type TravelerId, type WaveSpawn,
} from './data';

export const STEP = 1 / 60;

export type Dir = 's' | 'e' | 'n' | 'w';
export type FState =
  | 'spawn' | 'idle' | 'move' | 'attack' | 'windup' | 'special' | 'dodge' | 'hurt' | 'stagger' | 'dead';
export type Team = 'player' | 'echo';
export type EchoMove = 'melee' | 'lunge' | 'beacon' | 'pulse' | 'slam' | 'lanes' | 'ring' | 'summon' | 'sweep';

export interface InputFrame {
  /** Movement vector, magnitude ≤ 1. */
  mx: number;
  my: number;
  attack: boolean;
  dodge: boolean;
  special: boolean;
}

export const NO_INPUT: InputFrame = { mx: 0, my: 0, attack: false, dodge: false, special: false };

export interface Fighter {
  id: number;
  team: Team;
  cls: CharacterId;
  elite: boolean;
  x: number; y: number;
  vx: number; vy: number;
  kx: number; ky: number;
  fx: number; fy: number;
  dir: Dir;
  hp: number; maxHp: number;
  stamina: number; staminaDelay: number;
  speed: number; damage: number; reach: number; arc: number; radius: number;
  state: FState;
  t: number;
  dur: number;
  invuln: number;
  flash: number;
  slow: number;
  comboStep: number;
  queued: boolean;
  hitSet: Set<number>;
  specialCd: number;
  specialCdMax: number;
  perfectUsed: boolean;
  /** Echo / boss brain. */
  move: EchoMove;
  think: number;
  cooldown: number;
  moveCd: Record<string, number>;
  strafe: number;
  token: boolean;
  aimX: number; aimY: number;
  poise: number;
  phase: number;
  /** Boss crossed a phase threshold and owes a summon at the next chance. */
  pendingSummon: boolean;
  removeAt: number;
  scale: number;
}

export type HazardKind = 'circle' | 'lane' | 'ring' | 'field' | 'beacon' | 'pulse';

export interface Hazard {
  id: number;
  kind: HazardKind;
  team: Team;
  x: number; y: number;
  /** Lane end point. */
  x2: number; y2: number;
  r: number;
  width: number;
  arm: number;
  armMax: number;
  life: number;
  damage: number;
  hitSet: Set<number>;
  tick: number;
}

export type PickupKind = 'coin' | 'medkit' | 'battery';
export interface Pickup { id: number; kind: PickupKind; x: number; y: number; z: number; vz: number; vx: number; vy: number; t: number; value: number }

export interface Prop {
  id: number; prop: PropId; x: number; y: number; r: number;
  breakable: boolean; hp: number; broken: boolean; flash: number;
}

export type SimEvent =
  | { type: 'swing'; who: Team; cls: CharacterId; x: number; y: number; fx: number; fy: number; step: number }
  | { type: 'hit'; x: number; y: number; dmg: number; team: Team; finisher: boolean; crit: boolean; cls: CharacterId; fx: number; fy: number }
  | { type: 'kill'; x: number; y: number; cls: CharacterId; elite: boolean; score: number }
  | { type: 'hurt'; x: number; y: number; dmg: number }
  | { type: 'dodge'; x: number; y: number }
  | { type: 'perfect'; x: number; y: number }
  | { type: 'special'; cls: CharacterId; x: number; y: number; fx: number; fy: number; team: Team }
  | { type: 'telegraph'; move: EchoMove; x: number; y: number }
  | { type: 'impact'; x: number; y: number; big: boolean }
  | { type: 'pickup'; kind: PickupKind; x: number; y: number; value: number }
  | { type: 'propBreak'; x: number; y: number; prop: PropId }
  | { type: 'spawn'; x: number; y: number; cls: CharacterId; elite: boolean }
  | { type: 'waveStart'; wave: number; total: number; boss: boolean }
  | { type: 'waveClear'; wave: number }
  | { type: 'bossPhase'; phase: number }
  | { type: 'stagger'; x: number; y: number }
  | { type: 'hitstop'; time: number }
  | { type: 'slowmo'; time: number; scale: number }
  | { type: 'shake'; power: number }
  | { type: 'staminaEmpty' }
  | { type: 'specialReady' }
  | { type: 'victory' }
  | { type: 'defeat' };

export interface Loadout {
  traveler: TravelerId;
  hpMult: number;
  dmgMult: number;
  cdMult: number;
  speedMult: number;
  dodgeCostMult: number;
}

export interface WorldOptions {
  region: RegionDef;
  regionIndex: number;
  loadout: Loadout;
  seed: number;
  /** Endless waves (daily / trials) instead of the region's three. */
  endless: boolean;
  modifiers: string[];
  assist: boolean;
  /** Carry HP between campaign regions; undefined = full. */
  startHp?: number;
}

const DODGE_TIME = 0.3;
const DODGE_IFRAMES = 0.24;
const DODGE_SPEED = 620;
const PERFECT_WINDOW = 0.2;
const STAMINA_MAX = 100;
const DODGE_COST = 30;
const COMBO_TIMEOUT = 3.2;
const MAX_TOKENS = 2;

const ATTACK_CHAIN = [
  { dur: 0.36, from: 0.1, to: 0.2, dmg: 1.0, knock: 140, lunge: 120 },
  { dur: 0.34, from: 0.09, to: 0.19, dmg: 1.15, knock: 160, lunge: 140 },
  { dur: 0.5, from: 0.16, to: 0.28, dmg: 1.75, knock: 430, lunge: 230 },
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const len = (x: number, y: number) => Math.hypot(x, y);

export function dirOf(fx: number, fy: number): Dir {
  if (Math.abs(fx) > Math.abs(fy) * 1.05) return fx > 0 ? 'e' : 'w';
  return fy >= 0 ? 's' : 'n';
}

export class World {
  readonly rng: Rng;
  readonly region: RegionDef;
  readonly regionIndex: number;
  readonly opts: WorldOptions;
  readonly mods: Set<string>;

  player: Fighter;
  fighters: Fighter[] = [];
  hazards: Hazard[] = [];
  pickups: Pickup[] = [];
  props: Prop[] = [];
  events: SimEvent[] = [];

  time = 0;
  wave = 0;
  waveTotal: number;
  wavePhase: 'intro' | 'fight' | 'clear' = 'intro';
  phaseT = 0;
  pending: { spawn: WaveSpawn; at: number; gate: number }[] = [];

  score = 0;
  combo = 0;
  comboT = 0;
  maxCombo = 0;
  kills = 0;
  coins = 0;
  damageTaken = 0;
  perfects = 0;
  hitsLanded = 0;
  status: 'playing' | 'won' | 'lost' = 'playing';
  endT = 0;
  boss: Fighter | null = null;

  private nextId = 1;
  private buffer = { attack: 0, dodge: 0, special: 0 };

  constructor(opts: WorldOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.region = opts.region;
    this.regionIndex = opts.regionIndex;
    this.mods = new Set(opts.modifiers);
    this.waveTotal = opts.endless ? Infinity : opts.region.waves.length;

    const [x0, y0, x1, y1] = opts.region.bounds;
    this.player = this.makeFighter(opts.loadout.traveler, 'player', (x0 + x1) / 2, y0 + (y1 - y0) * 0.62, false);
    const L = opts.loadout;
    this.player.maxHp = Math.round(CLASSES[L.traveler].maxHp * L.hpMult);
    this.player.hp = opts.startHp !== undefined ? clamp(opts.startHp, 1, this.player.maxHp) : this.player.maxHp;
    this.player.damage *= L.dmgMult;
    this.player.speed *= L.speedMult;
    this.player.specialCdMax = CLASSES[L.traveler].specialCd * L.cdMult * (this.mods.has('overcharge') ? 0.5 : 1);
    this.player.specialCd = 0;
    this.player.fy = 1;
    this.fighters.push(this.player);

    for (const p of opts.region.props) {
      this.props.push({
        id: this.nextId++, prop: p.id, x: p.x, y: p.y, r: propRadius(p.id),
        breakable: !!p.breakable, hp: 30, broken: false, flash: 0,
      });
    }
    this.startWave();
  }

  // ───────────────────────── construction ─────────────────────────

  makeFighter(cls: CharacterId, team: Team, x: number, y: number, elite: boolean): Fighter {
    const c = CLASSES[cls];
    const boss = cls === 'warden';
    const echo = team === 'echo';
    const ri = this.regionIndex;
    const endlessScale = this.opts.endless ? 1 + Math.max(0, this.wave - 1) * 0.07 : 1;
    let hp = c.maxHp;
    let dmg = c.damage;
    if (echo && !boss) {
      hp = c.maxHp * 0.62 * (1 + ri * 0.22) * (elite ? 3 : 1) * endlessScale;
      dmg = c.damage * 0.72 * (1 + ri * 0.14) * (elite ? 1.3 : 1) * Math.min(1.8, endlessScale);
      if (this.mods.has('swarm')) hp *= 0.55;
      if (this.mods.has('gold')) dmg *= 1.3;
    }
    if (boss) {
      hp = c.maxHp * (this.opts.endless ? 0.55 * endlessScale : 1);
      dmg = c.damage;
    }
    const speedMod = this.mods.has('tailwind') ? 1.25 : 1;
    return {
      id: this.nextId++, team, cls, elite,
      x, y, vx: 0, vy: 0, kx: 0, ky: 0, fx: 0, fy: 1, dir: 's',
      hp, maxHp: hp, stamina: STAMINA_MAX, staminaDelay: 0,
      speed: c.speed * speedMod * (echo && !boss ? 0.78 : 1) * (elite ? 1.08 : 1),
      damage: dmg, reach: c.reach * (elite ? 1.1 : 1), arc: c.arc,
      radius: boss ? 46 : elite ? 26 : 22,
      state: team === 'player' ? 'idle' : 'spawn', t: 0, dur: team === 'player' ? 0 : 0.8,
      invuln: 0, flash: 0, slow: 0, comboStep: 0, queued: false, hitSet: new Set(),
      specialCd: echo ? 2 : 0, specialCdMax: c.specialCd, perfectUsed: false,
      move: 'melee', think: 0, cooldown: 0.6, moveCd: {}, strafe: 1, token: false,
      aimX: x, aimY: y, poise: 0, phase: 1, pendingSummon: false, removeAt: 0, scale: elite ? 1.18 : 1,
    };
  }

  // ───────────────────────── waves ─────────────────────────

  private startWave(): void {
    this.wave += 1;
    this.wavePhase = 'intro';
    this.phaseT = 0;
    const spawns = this.opts.endless ? this.endlessWave(this.wave) : this.region.waves[this.wave - 1];
    const boss = spawns.some((s) => s.cls === 'warden');
    this.pending = spawns.map((spawn, i) => ({
      spawn,
      at: 1.2 + (boss ? 0.6 : 0) + i * 0.38,
      gate: boss ? 0 : (i + this.rng.int(0, 3)) % this.region.gates.length,
    }));
    this.events.push({
      type: 'waveStart', wave: this.wave,
      total: Number.isFinite(this.waveTotal) ? this.waveTotal : 0, boss,
    });
  }

  private endlessWave(n: number): WaveSpawn[] {
    if (n % 6 === 0) return [{ cls: 'warden' }, ...(n >= 12 ? [{ cls: 'sable' as const }] : [])];
    const pool: CharacterId[] = ['sable', 'rook', 'iona'];
    let count = Math.min(9, 2 + Math.floor(n * 0.8));
    if (this.mods.has('swarm')) count = Math.round(count * 1.6);
    const wave: WaveSpawn[] = [];
    for (let i = 0; i < count; i++) wave.push({ cls: this.rng.pick(pool) });
    if (n % 3 === 0 || this.mods.has('elite')) wave.push({ cls: this.rng.pick(pool), elite: true });
    return wave;
  }

  private updateWave(dt: number): void {
    this.phaseT += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.phaseT >= p.at) {
        this.pending.splice(i, 1);
        this.spawnEcho(p.spawn, p.gate);
      }
    }
    const alive = this.fighters.some((f) => f.team === 'echo' && f.state !== 'dead');
    if (this.wavePhase === 'intro' && this.pending.length === 0) this.wavePhase = 'fight';
    if (this.wavePhase === 'fight' && !alive && this.pending.length === 0) {
      this.wavePhase = 'clear';
      this.phaseT = 0;
      this.events.push({ type: 'waveClear', wave: this.wave });
      if (this.wave >= this.waveTotal) {
        this.status = 'won';
        this.events.push({ type: 'victory' });
      }
    }
    if (this.wavePhase === 'clear' && this.phaseT > 2.2 && this.status === 'playing') this.startWave();
  }

  spawnEcho(spawn: WaveSpawn, gateIndex: number): Fighter {
    const boss = spawn.cls === 'warden';
    const [gx, gy] = boss ? [627, (this.region.bounds[1] + this.region.bounds[3]) / 2 - 140] : this.region.gates[gateIndex];
    const f = this.makeFighter(spawn.cls, 'echo', gx + this.rng.range(-30, 30), gy + this.rng.range(-20, 20), !!spawn.elite);
    f.dur = boss ? 1.6 : 0.8;
    f.invuln = f.dur;
    f.specialCd = this.rng.range(2.5, 5);
    f.strafe = this.rng.chance(0.5) ? 1 : -1;
    if (boss) {
      this.boss = f;
      f.cooldown = 1.2;
    }
    this.fighters.push(f);
    this.events.push({ type: 'spawn', x: f.x, y: f.y, cls: f.cls, elite: f.elite });
    return f;
  }

  // ───────────────────────── main step ─────────────────────────

  step(input: InputFrame): void {
    const dt = STEP;
    this.time += dt;
    if (input.attack) this.buffer.attack = 0.2;
    if (input.dodge) this.buffer.dodge = 0.16;
    if (input.special) this.buffer.special = 0.2;

    if (this.status === 'playing') this.updateWave(dt);
    else this.endT += dt;

    this.updatePlayer(input, dt);
    this.assignTokens();
    for (const f of this.fighters) if (f.team === 'echo') this.updateEcho(f, dt);
    for (const f of this.fighters) this.integrate(f, dt);
    this.separate();
    this.updateHazards(dt);
    this.updatePickups(dt);
    for (const p of this.props) p.flash = Math.max(0, p.flash - dt);

    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    this.buffer.attack -= dt;
    this.buffer.dodge -= dt;
    this.buffer.special -= dt;

    this.fighters = this.fighters.filter((f) => !(f.state === 'dead' && f.team === 'echo' && this.time > f.removeAt));
  }

  // ───────────────────────── player ─────────────────────────

  private updatePlayer(input: InputFrame, dt: number): void {
    const p = this.player;
    p.t += dt;
    p.invuln = Math.max(0, p.invuln - dt);
    p.flash = Math.max(0, p.flash - dt);
    const wasCd = p.specialCd;
    p.specialCd = Math.max(0, p.specialCd - dt);
    if (wasCd > 0 && p.specialCd === 0) this.events.push({ type: 'specialReady' });

    if (p.staminaDelay > 0) p.staminaDelay -= dt;
    else p.stamina = Math.min(STAMINA_MAX, p.stamina + 34 * dt);

    if (p.state === 'dead') {
      p.vx = p.vy = 0;
      return;
    }

    const mvLen = Math.min(1, len(input.mx, input.my));
    const mx = mvLen > 0.12 ? input.mx : 0;
    const my = mvLen > 0.12 ? input.my : 0;

    const canAct = p.state === 'idle' || p.state === 'move';
    const inRecovery = p.state === 'attack' && p.t > ATTACK_CHAIN[p.comboStep].to;

    // Dodge: available from neutral, and as an attack/hurt cancel.
    if (this.buffer.dodge > 0 && (canAct || inRecovery || (p.state === 'hurt' && p.t > 0.12))) {
      const cost = DODGE_COST * this.opts.loadout.dodgeCostMult * (this.mods.has('perfect') ? 2 : 1);
      if (p.stamina >= cost * 0.5) {
        this.buffer.dodge = 0;
        p.stamina = Math.max(0, p.stamina - cost);
        p.staminaDelay = 0.55;
        let dx = mx, dy = my;
        if (!dx && !dy) { dx = p.fx; dy = p.fy; }
        const l = len(dx, dy) || 1;
        p.fx = dx / l; p.fy = dy / l;
        this.setState(p, 'dodge', DODGE_TIME);
        p.invuln = DODGE_IFRAMES;
        p.perfectUsed = false;
        this.events.push({ type: 'dodge', x: p.x, y: p.y });
        return;
      } else if (this.buffer.dodge > 0.14) {
        this.events.push({ type: 'staminaEmpty' });
      }
    }

    if (this.buffer.special > 0 && (canAct || inRecovery) && p.specialCd <= 0) {
      this.buffer.special = 0;
      this.aimAtNearest(p, 320);
      if (mx || my) { const l = len(mx, my); p.fx = mx / l; p.fy = my / l; }
      this.setState(p, 'special', p.cls === 'sable' ? 0.52 : 0.6);
      p.specialCd = p.specialCdMax;
      p.hitSet.clear();
      if (p.cls === 'sable') p.invuln = 0.42;
      this.events.push({ type: 'special', cls: p.cls, x: p.x, y: p.y, fx: p.fx, fy: p.fy, team: 'player' });
      return;
    }

    if (this.buffer.attack > 0) {
      if (canAct) {
        this.buffer.attack = 0;
        this.beginAttack(p, 0, mx, my);
      } else if (p.state === 'attack' && p.t > ATTACK_CHAIN[p.comboStep].from) {
        p.queued = true;
        this.buffer.attack = 0;
      }
    }

    switch (p.state) {
      case 'idle':
      case 'move': {
        const sp = p.speed;
        p.vx = mx * sp;
        p.vy = my * sp;
        if (mx || my) {
          const l = len(mx, my);
          p.fx = mx / l; p.fy = my / l;
          if (p.state !== 'move') this.setState(p, 'move', 0);
        } else if (p.state !== 'idle') this.setState(p, 'idle', 0);
        break;
      }
      case 'attack': {
        const a = ATTACK_CHAIN[p.comboStep];
        const lunge = p.t < a.to ? a.lunge * (1 - p.t / a.to) : 0;
        p.vx = p.fx * lunge + mx * 30;
        p.vy = p.fy * lunge + my * 30;
        if (p.t >= a.from && p.t <= a.to) this.meleeHits(p, a.dmg, a.knock, p.comboStep === 2);
        if (p.t >= a.dur) {
          if (p.queued && p.comboStep < 2) this.beginAttack(p, p.comboStep + 1, mx, my);
          else this.setState(p, mx || my ? 'move' : 'idle', 0);
        } else if (p.queued && p.t >= a.to + 0.04 && p.comboStep < 2) {
          this.beginAttack(p, p.comboStep + 1, mx, my);
        }
        break;
      }
      case 'dodge': {
        const k = 1 - p.t / DODGE_TIME;
        const sp = DODGE_SPEED * (0.35 + 0.65 * k);
        p.vx = p.fx * sp;
        p.vy = p.fy * sp;
        if (p.t >= DODGE_TIME) this.setState(p, mx || my ? 'move' : 'idle', 0);
        break;
      }
      case 'special':
        this.updatePlayerSpecial(p);
        break;
      case 'hurt':
        p.vx = p.vy = 0;
        if (p.t >= p.dur) this.setState(p, 'idle', 0);
        break;
      default:
        break;
    }
    p.dir = dirOf(p.fx, p.fy);
  }

  private beginAttack(p: Fighter, step: number, mx: number, my: number): void {
    if (mx || my) {
      const l = len(mx, my);
      p.fx = mx / l; p.fy = my / l;
    }
    this.aimAtNearest(p, p.reach + 130);
    p.comboStep = step;
    p.queued = false;
    p.hitSet.clear();
    this.setState(p, 'attack', ATTACK_CHAIN[step].dur);
    this.events.push({ type: 'swing', who: 'player', cls: p.cls, x: p.x, y: p.y, fx: p.fx, fy: p.fy, step });
  }

  private aimAtNearest(p: Fighter, range: number): void {
    let best: Fighter | null = null;
    let bestScore = Infinity;
    for (const e of this.fighters) {
      if (e.team === p.team || e.state === 'dead' || e.state === 'spawn') continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = len(dx, dy);
      if (d > range + e.radius) continue;
      // Prefer targets roughly where the player is already facing.
      const facing = (dx * p.fx + dy * p.fy) / (d || 1);
      const score = d * (1.4 - facing * 0.6);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      const dx = best.x - p.x, dy = best.y - p.y;
      const l = len(dx, dy) || 1;
      p.fx = dx / l; p.fy = dy / l;
    }
  }

  private updatePlayerSpecial(p: Fighter): void {
    const fire = (at: number) => p.t >= at && p.t - STEP < at;
    p.vx = p.vy = 0;
    if (p.cls === 'sable') {
      // Startup, then a fast blink along the heading.
      if (p.t > 0.08 && p.t < 0.3) {
        const sp = 1350;
        p.vx = p.fx * sp;
        p.vy = p.fy * sp;
        for (const e of this.fighters) {
          if (e.team === 'player' || e.state === 'dead' || e.state === 'spawn' || p.hitSet.has(e.id)) continue;
          if (len(e.x - p.x, e.y - p.y) < 62 + e.radius) {
            p.hitSet.add(e.id);
            this.damage(e, p.damage * 2.3, p, { knock: 260, finisher: true });
          }
        }
        for (const prop of this.props) if (len(prop.x - p.x, prop.y - p.y) < 60 + prop.r) this.hitProp(prop, 99);
      }
    } else if (p.cls === 'rook') {
      if (fire(0.26)) {
        const bx = p.x + p.fx * 40, by = p.y + p.fy * 40;
        this.addHazard({ kind: 'beacon', team: 'player', x: bx, y: by, r: 165, arm: 0, life: 5.5, damage: p.damage * 0.7 });
        for (const e of this.fighters) {
          if (e.team === 'player' || e.state === 'dead' || e.state === 'spawn') continue;
          if (len(e.x - bx, e.y - by) < 165 + e.radius) this.damage(e, p.damage * 1.5, { x: bx, y: by }, { knock: 200 });
        }
        this.events.push({ type: 'impact', x: bx, y: by, big: true });
        this.events.push({ type: 'shake', power: 8 });
      }
    } else if (p.cls === 'iona') {
      if (fire(0.3)) {
        this.addHazard({ kind: 'pulse', team: 'player', x: p.x, y: p.y, r: 190, arm: 0, life: 0.5, damage: 0 });
        for (const e of this.fighters) {
          if (e.team === 'player' || e.state === 'dead' || e.state === 'spawn') continue;
          if (len(e.x - p.x, e.y - p.y) < 190 + e.radius) this.damage(e, p.damage * 2.0, p, { knock: 560, finisher: true });
        }
        for (const prop of this.props) if (len(prop.x - p.x, prop.y - p.y) < 190 + prop.r) this.hitProp(prop, 99);
        const heal = Math.round(p.maxHp * 0.1);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        this.events.push({ type: 'pickup', kind: 'medkit', x: p.x, y: p.y, value: heal });
        this.events.push({ type: 'shake', power: 12 });
        this.events.push({ type: 'hitstop', time: 0.06 });
      }
    }
    if (p.t >= p.dur) this.setState(p, 'idle', 0);
  }

  private meleeHits(a: Fighter, mult: number, knock: number, finisher: boolean): void {
    const cx = a.x + a.fx * a.reach * 0.62;
    const cy = a.y + a.fy * a.reach * 0.62 - 6;
    for (const e of this.fighters) {
      if (e.team === a.team || e.state === 'dead' || e.state === 'spawn' || a.hitSet.has(e.id)) continue;
      if (len(e.x - cx, e.y - cy) < a.arc + e.radius) {
        a.hitSet.add(e.id);
        this.damage(e, a.damage * mult, a, { knock, finisher });
      }
    }
    if (a.team === 'player') {
      for (const prop of this.props) {
        if (prop.broken || a.hitSet.has(prop.id)) continue;
        if (len(prop.x - cx, prop.y - cy) < a.arc + prop.r) {
          a.hitSet.add(prop.id);
          this.hitProp(prop, a.damage * mult);
        }
      }
    }
  }

  // ───────────────────────── damage ─────────────────────────

  damage(target: Fighter, raw: number, from: { x: number; y: number }, o: { knock?: number; finisher?: boolean; hazard?: boolean } = {}): boolean {
    if (target.state === 'dead') return false;
    if (target.invuln > 0) {
      if (target === this.player && target.state === 'dodge' && target.t <= PERFECT_WINDOW && !target.perfectUsed) {
        this.perfectDodge();
      }
      return false;
    }
    let dmg = raw;
    const playerHit = target.team === 'player';
    if (playerHit) {
      if (this.opts.assist) dmg *= 0.5;
      if (this.mods.has('glass')) dmg *= 2;
    } else {
      if (this.mods.has('glass')) dmg *= 2;
      dmg *= 0.92 + this.rng.next() * 0.16;
    }
    const crit = !playerHit && this.combo >= 20 && this.rng.chance(0.15);
    if (crit) dmg *= 1.5;
    dmg = Math.max(1, Math.round(dmg));
    const lost = Math.min(dmg, Math.max(0, target.hp));

    target.hp -= dmg;
    target.flash = 0.12;
    const dx = target.x - from.x, dy = target.y - from.y;
    const l = len(dx, dy) || 1;
    const knock = (o.knock ?? 120) * (target.cls === 'warden' ? 0.15 : target.elite ? 0.6 : 1);
    target.kx += (dx / l) * knock;
    target.ky += (dy / l) * knock;

    this.events.push({
      type: 'hit', x: target.x, y: target.y - 50 * target.scale, dmg, team: target.team,
      finisher: !!o.finisher, crit, cls: target.cls, fx: dx / l, fy: dy / l,
    });

    if (playerHit) {
      this.damageTaken += lost;
      this.combo = 0;
      target.invuln = 0.7;
      this.events.push({ type: 'hurt', x: target.x, y: target.y, dmg });
      this.events.push({ type: 'shake', power: 10 });
      this.events.push({ type: 'hitstop', time: 0.07 });
      if (target.state !== 'special') this.setState(target, 'hurt', 0.22);
    } else {
      this.hitsLanded++;
      this.combo++;
      this.comboT = COMBO_TIMEOUT;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += Math.round(10 * (1 + this.combo / 8));
      this.player.specialCd = Math.max(0, this.player.specialCd - 0.12);
      this.events.push({ type: 'hitstop', time: o.finisher ? 0.085 : 0.045 });
      if (o.finisher) this.events.push({ type: 'shake', power: 5 });
      if (target.cls === 'warden') {
        const frac = Math.max(0, target.hp) / target.maxHp;
        const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
        if (phase > target.phase && target.hp > 0) {
          target.phase = phase;
          target.pendingSummon = true;
          target.cooldown = Math.min(target.cooldown, 0.4);
          this.events.push({ type: 'bossPhase', phase });
          this.events.push({ type: 'shake', power: 14 });
        }
        target.poise += dmg;
        if (target.poise > 280 && target.state !== 'stagger') {
          target.poise = 0;
          this.setState(target, 'stagger', 2.0);
          this.clearEchoHazards(target);
          this.events.push({ type: 'stagger', x: target.x, y: target.y });
        }
      } else if (target.state !== 'windup' || o.finisher || !target.elite) {
        // Elites shrug off chip damage while winding up — read the tell.
        if (target.state !== 'special') this.setState(target, 'hurt', o.finisher ? 0.42 : 0.26);
      }
    }

    if (target.hp <= 0) this.kill(target);
    return true;
  }

  private perfectDodge(): void {
    const p = this.player;
    p.perfectUsed = true;
    p.invuln = Math.max(p.invuln, 0.5);
    this.perfects++;
    this.combo += 3;
    this.comboT = COMBO_TIMEOUT;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += 150;
    p.specialCd = Math.max(0, p.specialCd - 2.5);
    p.stamina = Math.min(STAMINA_MAX, p.stamina + 25);
    if (this.mods.has('perfect')) p.hp = Math.min(p.maxHp, p.hp + 8);
    this.events.push({ type: 'perfect', x: p.x, y: p.y });
    this.events.push({ type: 'slowmo', time: 0.7, scale: 0.3 });
  }

  private kill(f: Fighter): void {
    f.hp = 0;
    this.setState(f, 'dead', 99);
    f.removeAt = this.time + (f.cls === 'warden' ? 99 : 2.4);
    f.vx = f.vy = 0;
    if (f.team === 'player') {
      this.status = 'lost';
      this.events.push({ type: 'defeat' });
      this.events.push({ type: 'slowmo', time: 1.2, scale: 0.25 });
      return;
    }
    this.kills++;
    this.clearEchoHazards(f);
    const rankMult = 1 + Math.min(this.combo, 64) / 16;
    const base = f.cls === 'warden' ? 5000 : f.elite ? 400 : 100;
    const gained = Math.round(base * rankMult);
    this.score += gained;
    this.events.push({ type: 'kill', x: f.x, y: f.y, cls: f.cls, elite: f.elite, score: gained });
    this.events.push({ type: 'hitstop', time: f.cls === 'warden' ? 0.25 : 0.1 });
    if (f.cls === 'warden') {
      this.events.push({ type: 'slowmo', time: 2.2, scale: 0.2 });
      this.events.push({ type: 'shake', power: 22 });
      this.boss = null;
      // The Rift lets go of everything at once.
      for (const e of this.fighters) if (e.team === 'echo' && e.state !== 'dead') this.kill(e);
    } else {
      const last = !this.fighters.some((e) => e.team === 'echo' && e.state !== 'dead' && e !== f) && this.pending.length === 0;
      if (last) this.events.push({ type: 'slowmo', time: 0.9, scale: 0.3 });
    }
    if (this.mods.has('vampiric')) this.player.hp = Math.min(this.player.maxHp, this.player.hp + 4);
    const coins = f.cls === 'warden' ? 30 : f.elite ? 8 : this.rng.int(1, 3);
    for (let i = 0; i < coins; i++) this.dropPickup('coin', f.x, f.y);
    if (this.rng.chance(f.elite ? 0.6 : 0.1)) this.dropPickup('medkit', f.x, f.y);
    else if (this.rng.chance(0.08)) this.dropPickup('battery', f.x, f.y);
  }

  private hitProp(prop: Prop, dmg: number): void {
    if (prop.broken) return;
    prop.flash = 0.12;
    if (!prop.breakable) return;
    prop.hp -= dmg;
    if (prop.hp <= 0) {
      prop.broken = true;
      this.events.push({ type: 'propBreak', x: prop.x, y: prop.y, prop: prop.prop });
      const n = prop.prop === 'travel_chest' ? 10 : 3;
      for (let i = 0; i < n; i++) this.dropPickup('coin', prop.x, prop.y - 10);
      if (prop.prop === 'supply_crate' || this.rng.chance(0.3)) this.dropPickup('medkit', prop.x, prop.y);
      if (prop.prop === 'luggage') this.dropPickup('battery', prop.x, prop.y);
    }
  }

  private dropPickup(kind: PickupKind, x: number, y: number): void {
    const a = this.rng.range(0, Math.PI * 2);
    const sp = this.rng.range(60, 190);
    const value = kind === 'coin' ? (this.mods.has('gold') ? 3 : 1) : kind === 'medkit' ? 22 : 1;
    this.pickups.push({ id: this.nextId++, kind, x, y, z: 10, vz: this.rng.range(180, 320), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, t: 0, value });
  }

  // ───────────────────────── echo AI ─────────────────────────

  private assignTokens(): void {
    const p = this.player;
    const echoes = this.fighters.filter((f) => f.team === 'echo' && f.state !== 'dead' && f.state !== 'spawn' && f.cls !== 'warden');
    echoes.sort((a, b) => len(a.x - p.x, a.y - p.y) - len(b.x - p.x, b.y - p.y));
    let given = 0;
    const max = this.boss ? 1 : MAX_TOKENS + (this.regionIndex >= 1 ? 1 : 0) + (this.opts.endless && this.wave >= 8 ? 1 : 0);
    for (const e of echoes) {
      const busy = e.state === 'windup' || e.state === 'attack' || e.state === 'special';
      e.token = busy || given < max;
      if (e.token) given++;
    }
  }

  private updateEcho(e: Fighter, dt: number): void {
    e.t += dt;
    e.invuln = Math.max(0, e.invuln - dt);
    e.flash = Math.max(0, e.flash - dt);
    e.slow = Math.max(0, e.slow - dt);
    e.cooldown -= dt;
    e.specialCd -= dt;
    e.think -= dt;
    for (const k in e.moveCd) e.moveCd[k] -= dt;
    const p = this.player;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = len(dx, dy) || 1;
    const playerDown = p.state === 'dead';
    const slowMul = e.slow > 0 ? 0.5 : 1;

    switch (e.state) {
      case 'spawn':
        e.vx = e.vy = 0;
        if (e.t >= e.dur) this.setState(e, 'idle', 0);
        return;
      case 'dead':
        e.vx = e.vy = 0;
        return;
      case 'hurt':
      case 'stagger':
        e.vx = e.vy = 0;
        if (e.t >= e.dur) {
          this.setState(e, 'idle', 0);
          e.cooldown = Math.max(e.cooldown, 0.35);
        }
        return;
      case 'windup':
        e.vx = e.vy = 0;
        if (e.move === 'melee' || e.move === 'sweep') {
          // Track the player during the first half, then commit.
          if (e.t < e.dur * 0.45) { e.fx = dx / d; e.fy = dy / d; }
        }
        if (e.t >= e.dur) this.releaseMove(e);
        e.dir = dirOf(e.fx, e.fy);
        return;
      case 'attack':
        this.updateEchoAttack(e);
        e.dir = dirOf(e.fx, e.fy);
        return;
      case 'special':
        e.vx = e.vy = 0;
        if (e.move === 'lunge' && e.t < 0.26) {
          e.vx = e.fx * 1150; e.vy = e.fy * 1150;
          if (!e.hitSet.has(p.id) && len(p.x - e.x, p.y - e.y) < 48 + p.radius) {
            e.hitSet.add(p.id);
            this.damage(p, e.damage * 1.3, e, { knock: 260 });
          }
        }
        if (e.t >= e.dur) this.setState(e, 'idle', 0);
        return;
      default:
        break;
    }

    if (playerDown) {
      e.vx *= 0.9; e.vy *= 0.9;
      this.setState(e, 'idle', 0);
      return;
    }

    if (e.cls === 'warden') {
      this.bossBrain(e, d, dx, dy, slowMul);
      return;
    }

    // Decide on an action.
    if (e.cooldown <= 0 && e.token) {
      const special = this.pickEchoSpecial(e, d);
      if (special) {
        this.beginMove(e, special);
        return;
      }
      if (d < e.reach + 26 + p.radius) {
        this.beginMove(e, 'melee');
        return;
      }
    }

    if (e.think <= 0) {
      e.think = this.rng.range(0.25, 0.6);
      if (this.rng.chance(0.18)) e.strafe *= -1;
    }
    // Movement: tokens close in, everyone else orbits at a respectful range.
    const want = e.token ? e.reach * 0.75 : e.cls === 'rook' ? 230 : 190;
    const radial = clamp((d - want) / 80, -1, 1);
    const tx = dx / d, ty = dy / d;
    let vx = tx * radial + -ty * e.strafe * (e.token ? 0.25 : 0.7);
    let vy = ty * radial + tx * e.strafe * (e.token ? 0.25 : 0.7);
    const vl = len(vx, vy);
    if (vl > 1) { vx /= vl; vy /= vl; }
    const sp = e.speed * slowMul;
    e.vx += (vx * sp - e.vx) * Math.min(1, dt * 8);
    e.vy += (vy * sp - e.vy) * Math.min(1, dt * 8);
    e.fx = tx; e.fy = ty;
    const moving = len(e.vx, e.vy) > 20;
    if (moving && e.state !== 'move') this.setState(e, 'move', 0);
    if (!moving && e.state !== 'idle') this.setState(e, 'idle', 0);
    e.dir = dirOf(len(e.vx, e.vy) > 20 ? e.vx : e.fx, len(e.vx, e.vy) > 20 ? e.vy : e.fy);
  }

  private pickEchoSpecial(e: Fighter, d: number): EchoMove | null {
    if (e.specialCd > 0) return null;
    if (e.cls === 'sable' && d > 140 && d < 380) return 'lunge';
    if (e.cls === 'rook' && d > 90 && d < 420) return 'beacon';
    if (e.cls === 'iona' && d < 150) return 'pulse';
    return null;
  }

  private telegraphTime(e: Fighter, base: number): number {
    let t = base * (e.elite ? 0.85 : 1);
    if (e.cls === 'warden' && e.phase >= 3) t *= 0.8;
    if (this.opts.assist) t *= 1.25;
    return t;
  }

  private beginMove(e: Fighter, move: EchoMove): void {
    const p = this.player;
    e.move = move;
    e.hitSet.clear();
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = len(dx, dy) || 1;
    e.fx = dx / d; e.fy = dy / d;
    e.aimX = p.x; e.aimY = p.y;
    switch (move) {
      case 'melee':
        this.setState(e, 'windup', this.telegraphTime(e, 0.55));
        break;
      case 'sweep':
        this.setState(e, 'windup', this.telegraphTime(e, 0.75));
        break;
      case 'lunge':
        this.setState(e, 'windup', this.telegraphTime(e, 0.62));
        break;
      case 'beacon': {
        const t = this.telegraphTime(e, 1.0);
        this.setState(e, 'windup', 0.45);
        this.addHazard({ kind: 'field', team: 'echo', x: p.x, y: p.y, r: 105, arm: t, life: 3.2, damage: e.damage * 0.9 }, e.id);
        break;
      }
      case 'pulse': {
        const t = this.telegraphTime(e, 0.85);
        this.setState(e, 'windup', t);
        this.addHazard({ kind: 'circle', team: 'echo', x: e.x, y: e.y, r: 135, arm: t, life: 0.3, damage: e.damage * 1.2 }, e.id);
        break;
      }
      case 'slam': {
        const t = this.telegraphTime(e, 1.0);
        this.setState(e, 'windup', t);
        const lead = 0.25;
        const ax = clamp(p.x + p.vx * lead, this.region.bounds[0], this.region.bounds[2]);
        const ay = clamp(p.y + p.vy * lead, this.region.bounds[1], this.region.bounds[3]);
        this.addHazard({ kind: 'circle', team: 'echo', x: ax, y: ay, r: 125, arm: t, life: 0.3, damage: e.damage * 1.25 }, e.id);
        if (e.phase >= 3) {
          const a = this.rng.range(0, Math.PI * 2);
          this.addHazard({ kind: 'circle', team: 'echo', x: ax + Math.cos(a) * 200, y: ay + Math.sin(a) * 200, r: 110, arm: t + 0.35, life: 0.3, damage: e.damage * 1.1 }, e.id);
        }
        break;
      }
      case 'lanes': {
        const t = this.telegraphTime(e, 1.15);
        this.setState(e, 'windup', t);
        const [x0, y0, x1, y1] = this.region.bounds;
        const vertical = this.rng.chance(0.5);
        const n = e.phase >= 2 ? 3 : 2;
        // Lanes snap to the player's row/column so standing still is never safe.
        const offs = [0, 210, -210, 420, -420].slice(0, n);
        for (const o of offs) {
          if (vertical) {
            const x = clamp(p.x + o, x0 + 30, x1 - 30);
            this.addHazard({ kind: 'lane', team: 'echo', x, y: y0 - 40, x2: x, y2: y1 + 40, r: 0, width: 92, arm: t + Math.abs(o) / 2000, life: 0.35, damage: e.damage }, e.id);
          } else {
            const y = clamp(p.y + o, y0 + 30, y1 - 30);
            this.addHazard({ kind: 'lane', team: 'echo', x: x0 - 40, y, x2: x1 + 40, y2: y, r: 0, width: 92, arm: t + Math.abs(o) / 2000, life: 0.35, damage: e.damage }, e.id);
          }
        }
        break;
      }
      case 'ring': {
        const t = this.telegraphTime(e, 0.9);
        this.setState(e, 'windup', t);
        this.addHazard({ kind: 'ring', team: 'echo', x: e.x, y: e.y, r: 0, width: 46, arm: t, life: 2.4, damage: e.damage * 1.1 }, e.id);
        break;
      }
      case 'summon':
        this.setState(e, 'windup', 0.9);
        break;
    }
    this.events.push({ type: 'telegraph', move, x: e.x, y: e.y });
  }

  private releaseMove(e: Fighter): void {
    switch (e.move) {
      case 'melee':
      case 'sweep':
        this.setState(e, 'attack', e.cls === 'warden' ? 0.55 : 0.42);
        this.events.push({ type: 'swing', who: 'echo', cls: e.cls, x: e.x, y: e.y, fx: e.fx, fy: e.fy, step: 0 });
        break;
      case 'lunge':
        this.setState(e, 'special', 0.5);
        this.events.push({ type: 'special', cls: e.cls, x: e.x, y: e.y, fx: e.fx, fy: e.fy, team: 'echo' });
        e.specialCd = this.rng.range(5, 8);
        e.cooldown = 1.4;
        break;
      case 'beacon':
      case 'pulse':
        this.setState(e, 'special', 0.5);
        this.events.push({ type: 'special', cls: e.cls, x: e.x, y: e.y, fx: e.fx, fy: e.fy, team: 'echo' });
        e.specialCd = this.rng.range(6, 9);
        e.cooldown = 1.2;
        break;
      case 'slam':
      case 'lanes':
      case 'ring':
        this.setState(e, 'special', e.move === 'slam' ? 0.55 : 0.6);
        e.cooldown = e.phase >= 3 ? 0.55 : e.phase === 2 ? 0.85 : 1.15;
        break;
      case 'summon': {
        this.setState(e, 'special', 0.6);
        const n = e.phase >= 3 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const cls = this.rng.pick(['sable', 'rook', 'iona'] as const);
          this.spawnEcho({ cls }, 1 + (i % 3));
        }
        e.cooldown = 1.0;
        break;
      }
    }
  }

  private updateEchoAttack(e: Fighter): void {
    e.vx = e.vy = 0;
    const boss = e.cls === 'warden';
    const from = boss ? 0.12 : 0.1;
    const to = boss ? 0.26 : 0.22;
    if (e.t < to) {
      const lunge = boss ? 60 : 160;
      e.vx = e.fx * lunge;
      e.vy = e.fy * lunge;
    }
    if (e.t >= from && e.t <= to) this.meleeHits(e, e.move === 'sweep' ? 1.3 : 1, boss ? 380 : 220, false);
    if (e.t >= e.dur) {
      this.setState(e, 'idle', 0);
      e.cooldown = boss ? 0.5 : this.rng.range(0.55, 1.15) * (e.elite ? 0.7 : 1);
    }
  }

  private bossBrain(e: Fighter, d: number, dx: number, dy: number, slowMul: number): void {
    const phase = e.phase;
    if (e.pendingSummon) {
      e.pendingSummon = false;
      this.beginMove(e, 'summon');
      e.moveCd.summon = 14;
      return;
    }
    e.fx = dx / d; e.fy = dy / d;
    if (e.cooldown <= 0) {
      const options: EchoMove[] = [];
      if (d < e.reach + 50) options.push('sweep', 'sweep');
      if (!(e.moveCd.slam > 0)) options.push('slam', 'slam');
      if (!(e.moveCd.lanes > 0)) options.push('lanes');
      if (phase >= 2 && !(e.moveCd.ring > 0)) options.push('ring');
      if (phase >= 2 && !(e.moveCd.summon > 0) && this.fighters.filter((f) => f.team === 'echo' && f.state !== 'dead').length < 3) options.push('summon');
      if (options.length) {
        const m = this.rng.pick(options);
        e.moveCd[m] = m === 'slam' ? 2.2 : m === 'lanes' ? 5 : m === 'ring' ? 6.5 : m === 'summon' ? 16 : 0;
        this.beginMove(e, m);
        return;
      }
    }
    // Lumber toward the player, but hold a little distance to cast.
    const want = 120;
    const radial = clamp((d - want) / 90, -0.6, 1);
    const sp = e.speed * slowMul * (phase >= 3 ? 1.25 : 1);
    e.vx = (dx / d) * radial * sp;
    e.vy = (dy / d) * radial * sp;
    const moving = Math.abs(radial) > 0.1;
    if (moving && e.state !== 'move') this.setState(e, 'move', 0);
    if (!moving && e.state !== 'idle') this.setState(e, 'idle', 0);
    e.dir = dirOf(e.fx, e.fy);
  }

  // ───────────────────────── hazards ─────────────────────────

  private addHazard(h: Partial<Hazard> & Pick<Hazard, 'kind' | 'team' | 'x' | 'y' | 'arm' | 'life' | 'damage'>, owner = 0): void {
    this.hazards.push({
      id: owner || this.nextId++, x2: h.x, y2: h.y, r: 0, width: 0, hitSet: new Set(), tick: 0,
      armMax: h.arm, ...h,
    } as Hazard);
  }

  private clearEchoHazards(f: Fighter): void {
    // Telegraphs that have not fired yet die with their caster (or on stagger).
    this.hazards = this.hazards.filter((h) => !(h.id === f.id && h.arm > 0));
  }

  private updateHazards(dt: number): void {
    const p = this.player;
    for (const h of this.hazards) {
      if (h.arm > 0) {
        h.arm -= dt;
        if (h.arm <= 0) {
          if (h.kind === 'circle' || h.kind === 'lane') {
            this.events.push({ type: 'impact', x: h.x, y: h.y, big: h.kind === 'circle' });
            this.events.push({ type: 'shake', power: h.kind === 'lane' ? 6 : 9 });
          }
        }
        continue;
      }
      h.life -= dt;
      h.tick -= dt;
      switch (h.kind) {
        case 'circle':
          if (!h.hitSet.has(p.id) && len(p.x - h.x, p.y - h.y) < h.r + p.radius * 0.5) {
            h.hitSet.add(p.id);
            this.damage(p, h.damage, h, { knock: 300, hazard: true });
          }
          break;
        case 'lane': {
          if (!h.hitSet.has(p.id) && distToSegment(p.x, p.y, h.x, h.y, h.x2, h.y2) < h.width / 2 + p.radius * 0.4) {
            h.hitSet.add(p.id);
            this.damage(p, h.damage, { x: p.x - (h.y2 - h.y), y: p.y + (h.x2 - h.x) }, { knock: 120, hazard: true });
          }
          break;
        }
        case 'ring': {
          h.r += 400 * dt;
          const d = len(p.x - h.x, p.y - h.y);
          if (!h.hitSet.has(p.id) && Math.abs(d - h.r) < h.width / 2 + p.radius * 0.4) {
            if (this.damage(p, h.damage, h, { knock: 260, hazard: true })) h.hitSet.add(p.id);
            else if (p.invuln > 0) h.hitSet.add(p.id);
          }
          break;
        }
        case 'field':
          if (len(p.x - h.x, p.y - h.y) < h.r) {
            p.slow = 0.2;
            if (!h.hitSet.has(p.id)) {
              h.hitSet.add(p.id);
              this.damage(p, h.damage, h, { knock: 40, hazard: true });
            }
          }
          break;
        case 'beacon':
          for (const e of this.fighters) {
            if (e.team !== 'echo' || e.state === 'dead' || e.state === 'spawn') continue;
            if (len(e.x - h.x, e.y - h.y) < h.r + e.radius) {
              e.slow = 0.25;
              if (h.tick <= 0) this.damage(e, h.damage, { x: h.x, y: h.y }, { knock: 30 });
            }
          }
          if (h.tick <= 0) h.tick = 0.5;
          break;
        case 'pulse':
          h.r += 900 * dt;
          break;
      }
    }
    this.hazards = this.hazards.filter((h) => h.arm > 0 || h.life > 0);
  }

  // ───────────────────────── pickups ─────────────────────────

  private updatePickups(dt: number): void {
    const p = this.player;
    const [x0, y0, x1, y1] = this.region.bounds;
    const vacuum = this.wavePhase === 'clear' || this.status === 'won';
    for (const k of this.pickups) {
      k.t += dt;
      k.vz -= 900 * dt;
      k.z = Math.max(0, k.z + k.vz * dt);
      if (k.z === 0) { k.vz = Math.abs(k.vz) > 80 ? -k.vz * 0.35 : 0; k.vx *= 0.86; k.vy *= 0.86; }
      const dx = p.x - k.x, dy = p.y - (k.y + 0);
      const d = len(dx, dy) || 1;
      const pull = vacuum ? 1600 : d < 120 && k.t > 0.4 ? 1100 : 0;
      if (pull && p.state !== 'dead') {
        k.vx += (dx / d) * pull * dt;
        k.vy += (dy / d) * pull * dt;
      }
      k.x = clamp(k.x + k.vx * dt, x0, x1);
      k.y = clamp(k.y + k.vy * dt, y0, y1);
      if (d < 30 && k.t > 0.3 && p.state !== 'dead') {
        k.t = -999;
        if (k.kind === 'coin') this.coins += k.value;
        if (k.kind === 'medkit') p.hp = Math.min(p.maxHp, p.hp + k.value);
        if (k.kind === 'battery') p.specialCd = 0;
        this.events.push({ type: 'pickup', kind: k.kind, x: k.x, y: k.y, value: k.value });
      }
    }
    this.pickups = this.pickups.filter((k) => k.t > -1 && k.t < 25);
  }

  // ───────────────────────── physics ─────────────────────────

  private integrate(f: Fighter, dt: number): void {
    const [x0, y0, x1, y1] = this.region.bounds;
    const slow = f.team === 'player' && f.slow > 0 ? 0.6 : 1;
    if (f.team === 'player') f.slow = Math.max(0, f.slow - dt);
    f.x += (f.vx * slow + f.kx) * dt;
    f.y += (f.vy * slow + f.ky) * dt;
    const decay = Math.exp(-10 * dt);
    f.kx *= decay;
    f.ky *= decay;
    if (Math.abs(f.kx) < 1) f.kx = 0;
    if (Math.abs(f.ky) < 1) f.ky = 0;
    f.x = clamp(f.x, x0 + f.radius * 0.5, x1 - f.radius * 0.5);
    f.y = clamp(f.y, y0, y1);
    for (const prop of this.props) {
      if (prop.broken) continue;
      const dx = f.x - prop.x, dy = (f.y - prop.y) * 1.6;
      const d = len(dx, dy);
      const min = prop.r + f.radius * 0.6;
      if (d < min && d > 0.001) {
        f.x = prop.x + (dx / d) * min;
        f.y = prop.y + (dy / d) * min / 1.6;
      }
    }
  }

  private separate(): void {
    const list = this.fighters;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === 'dead') continue;
        // The player slips through Echoes while dodging or blinking.
        const ghost = (a === this.player || b === this.player) && (this.player.state === 'dodge' || this.player.state === 'special');
        if (ghost) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = len(dx, dy);
        const min = (a.radius + b.radius) * 0.8;
        if (d < min && d > 0.001) {
          const push = (min - d) / 2;
          const wa = a.cls === 'warden' ? 0.1 : a === this.player ? 0.3 : 1;
          const wb = b.cls === 'warden' ? 0.1 : b === this.player ? 0.3 : 1;
          const sum = wa + wb;
          a.x -= (dx / d) * push * (2 * wa / sum);
          a.y -= (dy / d) * push * (2 * wa / sum);
          b.x += (dx / d) * push * (2 * wb / sum);
          b.y += (dy / d) * push * (2 * wb / sum);
        }
      }
    }
  }

  private setState(f: Fighter, s: FState, dur: number): void {
    f.state = s;
    f.t = 0;
    f.dur = dur;
  }

  get playerSpecialFraction(): number {
    const p = this.player;
    return p.specialCdMax ? 1 - p.specialCd / p.specialCdMax : 1;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
  return len(px - (ax + vx * t), py - (ay + vy * t));
}

export function propRadius(id: PropId): number {
  switch (id) {
    case 'sandstone_barricade': return 56;
    case 'expedition_tent': return 62;
    case 'coliving_bench': return 44;
    case 'boulder': return 50;
    case 'slate_debris': return 36;
    case 'solar_charger': return 34;
    case 'travel_chest': return 29;
    case 'luggage': return 28;
    case 'supply_crate': return 28;
    case 'weather_antenna': return 22;
    case 'harbor_bollard': return 28;
    case 'barrel': return 20;
    case 'relay_battery': return 19;
    case 'route_beacon': return 30;
    case 'portal_arch': return 60;
    case 'shrub': return 26;
  }
}
