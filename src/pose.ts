/**
 * Which animation frame a fighter shows. Pure, so it can be unit-tested.
 *
 * Facing rule for the player: the sprite always faces the direction being
 * pressed. The south-facing (toward-the-screen) art is used only when the
 * player is idle or facing south. The pack's strike/special/hurt art is
 * authored south-only, so when the player acts while facing north, east or
 * west we build the action from that direction's walk frames instead (a
 * planted lunge stride), and the rotated slash effect shows the swing.
 */
import { animFrame, type CharSheet } from './assets';
import type { Fighter } from './simulation';

export interface Pose { anim: string; frame: number; flip: boolean }

/** Stride frames for a directional strike: plant, lunge, hold, recover. */
const STRIKE_STRIDE = [0, 1, 2, 2, 2, 1];

export function poseOf(f: Fighter, sheet: CharSheet, time: number): Pose {
  const A = sheet.anims;
  const flip = f.fx < -0.3;
  const frac = f.dur > 0 ? Math.min(0.999, f.t / f.dur) : 0;
  const walk = `walk_${f.dir}`;
  const directional = f.team === 'player' && f.dir !== 's';

  if (directional) {
    switch (f.state) {
      case 'attack':
        return { anim: walk, frame: STRIKE_STRIDE[Math.min(5, Math.floor(frac * 6))], flip: false };
      case 'special':
        return { anim: walk, frame: animFrame(A[walk], f.t, 2.4), flip: false };
      case 'hurt':
      case 'stagger':
        return { anim: walk, frame: 0, flip: false };
      default:
        break;
    }
  }

  switch (f.state) {
    case 'move':
      return { anim: walk, frame: animFrame(A[walk], time + f.id * 0.13, f.cls === 'warden' ? 0.7 : 1), flip: false };
    case 'dodge':
      return { anim: walk, frame: animFrame(A[walk], f.t, 2.4), flip: false };
    case 'attack':
      return { anim: 'attack', frame: Math.min(5, 1 + Math.floor(frac * 5)), flip };
    case 'windup':
      if (f.cls === 'warden' && f.move !== 'sweep') return { anim: 'special', frame: frac < 0.5 ? 0 : 1, flip };
      return { anim: 'attack', frame: frac < 0.55 ? 0 : 1, flip };
    case 'special':
      if (f.cls === 'warden') return { anim: f.move === 'slam' ? 'attack' : 'special', frame: Math.min(5, 2 + Math.floor(frac * 4)), flip };
      return { anim: 'special', frame: Math.min(5, Math.floor(frac * 6)), flip };
    case 'hurt':
      return { anim: 'hurt', frame: Math.min(2, Math.floor(frac * 3)), flip };
    case 'stagger':
      return { anim: 'hurt', frame: 2, flip };
    case 'dead':
      return { anim: 'defeat', frame: Math.min(2, Math.floor(f.t / 0.22)), flip };
    default:
      return { anim: 'idle', frame: animFrame(A.idle, time + f.id * 0.31), flip: false };
  }
}
