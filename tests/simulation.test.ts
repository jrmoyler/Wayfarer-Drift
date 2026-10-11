import { describe, expect, it } from 'vitest';
import { REGIONS, type TravelerId } from '../src/data';
import { NO_INPUT, World, type Fighter, type InputFrame, type SimEvent } from '../src/simulation';

const make = (traveler: TravelerId = 'sable', o: Partial<{ region: number; endless: boolean; mods: string[]; seed: number; assist: boolean }> = {}) =>
  new World({
    region: REGIONS[o.region ?? 0],
    regionIndex: o.region ?? 0,
    loadout: { traveler, hpMult: 1, dmgMult: 1, cdMult: 1, speedMult: 1, dodgeCostMult: 1 },
    seed: o.seed ?? 1234,
    endless: o.endless ?? false,
    modifiers: o.mods ?? [],
    assist: o.assist ?? false,
  });

const input = (p: Partial<InputFrame>): InputFrame => ({ ...NO_INPUT, ...p });

function run(w: World, frames: number, inp: InputFrame = NO_INPUT): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < frames; i++) {
    w.step(i === 0 ? inp : { ...inp, attack: false, dodge: false, special: false });
    all.push(...w.drainEvents());
  }
  return all;
}

/** Remove scheduled wave spawns so a test controls every Echo. */
function quiet(w: World): void {
  w.pending = [];
  w.fighters = [w.player];
  w.wavePhase = 'fight';
}

function echoAt(w: World, cls: 'sable' | 'rook' | 'iona', x: number, y: number, elite = false): Fighter {
  const e = w.spawnEcho({ cls, elite }, 0);
  e.x = x;
  e.y = y;
  e.state = 'idle';
  e.invuln = 0;
  e.cooldown = 99;
  e.specialCd = 99;
  w.drainEvents();
  return e;
}

describe('movement', () => {
  it('stays inside the walkable floor', () => {
    const w = make();
    quiet(w);
    run(w, 400, input({ mx: -1, my: -1 }));
    const [x0, y0] = w.region.bounds;
    expect(w.player.x).toBeGreaterThanOrEqual(x0);
    expect(w.player.y).toBeGreaterThanOrEqual(y0);
  });

  it('collides with props', () => {
    const w = make();
    quiet(w);
    const prop = w.props[0];
    w.player.x = prop.x - 120;
    w.player.y = prop.y;
    run(w, 120, input({ mx: 1 }));
    expect(Math.hypot((w.player.x - prop.x), (w.player.y - prop.y) * 1.6)).toBeGreaterThan(prop.r);
  });
});

describe('stamina and dodge', () => {
  it('spends stamina and grants invulnerability', () => {
    const w = make();
    quiet(w);
    const ev = run(w, 2, input({ dodge: true, mx: 1 }));
    expect(ev.some((e) => e.type === 'dodge')).toBe(true);
    expect(w.player.stamina).toBeLessThan(80);
    expect(w.player.invuln).toBeGreaterThan(0);
  });

  it('refuses to dodge when exhausted', () => {
    const w = make();
    quiet(w);
    w.player.stamina = 5;
    w.player.staminaDelay = 5;
    const ev = run(w, 2, input({ dodge: true }));
    expect(ev.some((e) => e.type === 'dodge')).toBe(false);
  });
});

describe('melee', () => {
  it('hits a target once per swing and chains a three-hit combo', () => {
    const w = make('rook');
    quiet(w);
    const e = echoAt(w, 'iona', w.player.x, w.player.y + 50, true);
    e.maxHp = e.hp = 9999;
    const first = run(w, 30, input({ attack: true }));
    expect(first.filter((x) => x.type === 'hit').length).toBe(1);
    // Queue two more strikes.
    const chain: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      w.step(input({ attack: i % 12 === 0 }));
      chain.push(...w.drainEvents());
    }
    const swings = chain.filter((x) => x.type === 'swing' && x.who === 'player');
    expect(swings.length).toBeGreaterThanOrEqual(2);
    expect(chain.some((x) => x.type === 'hit' && x.finisher)).toBe(true);
    expect(w.maxCombo).toBeGreaterThanOrEqual(3);
  });

  it('auto-aims toward a nearby Echo', () => {
    const w = make('sable');
    quiet(w);
    echoAt(w, 'rook', w.player.x - 80, w.player.y);
    run(w, 3, input({ attack: true }));
    expect(w.player.fx).toBeLessThan(-0.9);
  });

  it('breaks props and drops coins', () => {
    const w = make('iona');
    quiet(w);
    const crate = w.props.find((p) => p.breakable)!;
    w.player.x = crate.x;
    w.player.y = crate.y + crate.r + 30;
    w.player.fx = 0;
    w.player.fy = -1;
    for (let i = 0; i < 6 && !crate.broken; i++) run(w, 40, input({ attack: true }));
    expect(crate.broken).toBe(true);
    expect(w.pickups.some((p) => p.kind === 'coin')).toBe(true);
  });
});

describe('perfect dodge', () => {
  it('turns a last-moment dodge into slow-motion and special charge', () => {
    const w = make('sable');
    quiet(w);
    const e = echoAt(w, 'sable', w.player.x, w.player.y - 50);
    e.cooldown = 0;
    e.token = true;
    w.player.specialCd = 5;
    let perfect = false;
    for (let i = 0; i < 120 && !perfect; i++) {
      // Dodge the instant the Echo commits to its swing.
      const dodge = e.state === 'windup' && e.t > e.dur - 0.05;
      w.step(input({ dodge }));
      perfect = w.drainEvents().some((x) => x.type === 'perfect');
    }
    expect(perfect).toBe(true);
    expect(w.player.hp).toBe(w.player.maxHp);
    expect(w.player.specialCd).toBeLessThan(5);
  });
});

describe('specials', () => {
  for (const t of ['sable', 'rook', 'iona'] as TravelerId[]) {
    it(`${t} special damages nearby Echoes and goes on cooldown`, () => {
      const w = make(t);
      quiet(w);
      const e = echoAt(w, 'iona', w.player.x, w.player.y + 70, true);
      const hp = e.hp;
      w.player.fx = 0;
      w.player.fy = 1;
      run(w, 60, input({ special: true }));
      expect(e.hp).toBeLessThan(hp);
      expect(w.player.specialCd).toBeGreaterThan(0);
    });
  }

  it('Iona’s pulse heals', () => {
    const w = make('iona');
    quiet(w);
    w.player.hp = 50;
    run(w, 60, input({ special: true }));
    expect(w.player.hp).toBeGreaterThan(50);
  });
});

describe('campaign flow', () => {
  it('clears every wave of a region and reports victory', () => {
    const w = make('iona');
    let won = false;
    for (let i = 0; i < 60 * 120 && !won; i++) {
      w.step(NO_INPUT);
      for (const f of w.fighters) if (f.team === 'echo' && f.state !== 'dead' && f.state !== 'spawn') w.damage(f, 9999, w.player);
      w.player.hp = w.player.maxHp;
      won = w.drainEvents().some((e) => e.type === 'victory');
    }
    expect(won).toBe(true);
    expect(w.status).toBe('won');
    expect(w.wave).toBe(3);
  });

  it('ends the run when the player falls', () => {
    const w = make();
    quiet(w);
    w.damage(w.player, 999, { x: 0, y: 0 });
    expect(w.status).toBe('lost');
    expect(w.damageTaken).toBe(w.player.maxHp);
  });

  it('assist mode halves incoming damage', () => {
    const a = make('rook', { assist: true });
    const b = make('rook');
    a.damage(a.player, 20, { x: 0, y: 0 });
    b.damage(b.player, 20, { x: 0, y: 0 });
    expect(a.damageTaken).toBe(10);
    expect(b.damageTaken).toBe(20);
  });
});

describe('Gatewarden', () => {
  it('telegraphs attacks with hazards and shifts phases', () => {
    const w = make('sable', { region: 2 });
    quiet(w);
    const b = w.spawnEcho({ cls: 'warden' }, 0);
    const events: SimEvent[] = [];
    let sawHazard = false;
    for (let i = 0; i < 60 * 12; i++) {
      w.step(NO_INPUT);
      w.player.hp = w.player.maxHp;
      events.push(...w.drainEvents());
      if (w.hazards.some((h) => h.team === 'echo' && h.arm > 0)) sawHazard = true;
    }
    expect(sawHazard).toBe(true);
    expect(events.some((e) => e.type === 'telegraph')).toBe(true);
    b.invuln = 0;
    w.damage(b, b.maxHp * 0.5, w.player);
    run(w, 5);
    expect(b.phase).toBe(2);
  });

  it('staggers under sustained pressure', () => {
    const w = make('iona', { region: 2 });
    quiet(w);
    const b = w.spawnEcho({ cls: 'warden' }, 0);
    run(w, 120);
    b.invuln = 0;
    let staggered = false;
    for (let i = 0; i < 24 && !staggered; i++) {
      w.damage(b, 20, w.player);
      staggered = w.drainEvents().some((e) => e.type === 'stagger');
    }
    expect(staggered).toBe(true);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed and inputs', () => {
    const script = (w: World) => {
      for (let i = 0; i < 60 * 20; i++) {
        const t = i % 90;
        w.step(input({ mx: Math.sin(i / 50), my: Math.cos(i / 70), attack: t === 0 || t === 10 || t === 20, dodge: t === 45, special: t === 60 }));
        w.drainEvents();
      }
      return [w.score, w.kills, Math.round(w.player.hp), Math.round(w.player.x), w.wave];
    };
    expect(script(make('rook', { endless: true, seed: 77 }))).toEqual(script(make('rook', { endless: true, seed: 77 })));
  });
});
