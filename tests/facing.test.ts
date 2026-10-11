import { describe, expect, it } from 'vitest';
import { catalog } from '../src/assets';
import { REGIONS, type TravelerId } from '../src/data';
import { poseOf } from '../src/pose';
import { NO_INPUT, World, type InputFrame } from '../src/simulation';

const DIRS = {
  up: { mx: 0, my: -1, dir: 'n' },
  down: { mx: 0, my: 1, dir: 's' },
  left: { mx: -1, my: 0, dir: 'w' },
  right: { mx: 1, my: 0, dir: 'e' },
} as const;

const make = (traveler: TravelerId) => {
  const w = new World({
    region: REGIONS[0], regionIndex: 0, seed: 9, endless: false, modifiers: [], assist: false,
    loadout: { traveler, hpMult: 1, dmgMult: 1, cdMult: 1, speedMult: 1, dodgeCostMult: 1 },
  });
  w.pending = [];
  w.fighters = [w.player];
  w.wavePhase = 'fight';
  return w;
};

/** Facing the screen = any south-authored animation. */
const facesScreen = (anim: string) => ['idle', 'walk_s', 'attack', 'special', 'hurt'].includes(anim);

/** Every frame of `frames` steps holding `held`, firing `action` on the first. */
function poses(w: World, held: InputFrame, action: Partial<InputFrame>, frames: number) {
  const sheet = catalog.characters[w.player.cls];
  const out: { state: string; anim: string }[] = [];
  for (let i = 0; i < frames; i++) {
    w.step(i === 0 ? { ...held, ...action } : held);
    w.drainEvents();
    out.push({ state: w.player.state, anim: poseOf(w.player, sheet, w.time).anim });
  }
  return out;
}

describe('player facing follows the pressed direction', () => {
  for (const t of ['sable', 'rook', 'iona'] as TravelerId[]) {
    for (const [name, d] of Object.entries(DIRS)) {
      const held: InputFrame = { ...NO_INPUT, mx: d.mx, my: d.my };
      for (const [label, action] of [['moving', {}], ['striking', { attack: true }], ['dodging', { dodge: true }], ['using special', { special: true }]] as const) {
        it(`${t} faces ${name} while ${label}`, () => {
          const w = make(t);
          const seen = poses(w, held, action, 40);
          expect(w.player.dir).toBe(d.dir);
          for (const p of seen) {
            if (d.dir === 's') expect(facesScreen(p.anim)).toBe(true);
            else expect(p.anim, `${p.state} showed ${p.anim}`).toBe(`walk_${d.dir}`);
          }
        });
      }
    }
  }

  it('a held direction beats strike aim assist', () => {
    const w = make('rook');
    const e = w.spawnEcho({ cls: 'sable' }, 0);
    e.x = w.player.x + 70; // Echo to the right…
    e.y = w.player.y;
    e.state = 'idle';
    e.cooldown = 99;
    w.drainEvents();
    poses(w, { ...NO_INPUT, mx: 0, my: -1 }, { attack: true }, 3); // …player holds up.
    expect(w.player.dir).toBe('n');
  });

  it('turns toward the input even while flinching', () => {
    const w = make('iona');
    w.damage(w.player, 5, { x: w.player.x, y: w.player.y - 50 });
    const seen = poses(w, { ...NO_INPUT, mx: -1, my: 0 }, {}, 5);
    expect(seen[0].state).toBe('hurt');
    expect(seen.every((p) => p.anim === 'walk_w')).toBe(true);
  });

  it('faces the screen when idle', () => {
    const w = make('sable');
    poses(w, { ...NO_INPUT, mx: 1, my: 0 }, {}, 10);
    const seen = poses(w, NO_INPUT, {}, 5);
    expect(seen.at(-1)).toEqual({ state: 'idle', anim: 'idle' });
  });
});
