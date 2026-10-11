/**
 * Unified input: keyboard, mouse, gamepad and touch all collapse into one
 * InputFrame per simulation step. Edge-triggered actions are latched until
 * the next poll so a tap shorter than a frame is never lost.
 */
import type { InputFrame } from './simulation';

export type Device = 'keyboard' | 'touch' | 'gamepad';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const ATTACK_KEYS = new Set(['KeyJ', 'KeyZ']);
const DODGE_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyX']);
const SPECIAL_KEYS = new Set(['KeyK', 'KeyC', 'KeyL']);

export class Input {
  device: Device = 'keyboard';
  enabled = false;
  onPause: () => void = () => {};
  onDeviceChange: (d: Device) => void = () => {};

  private held = new Set<string>();
  private latch = { attack: false, dodge: false, special: false };
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private padPrev: boolean[] = [];
  private padMenuCd = 0;
  private stickEl: HTMLElement;
  private knobEl: HTMLElement;

  constructor(private root: HTMLElement) {
    this.stickEl = root.querySelector('#stick')!;
    this.knobEl = root.querySelector('#stick-knob')!;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
    this.bindTouch();
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setDevice('touch');
    }, { capture: true });
  }

  private setDevice(d: Device): void {
    if (d !== this.device) {
      this.device = d;
      this.onDeviceChange(d);
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.repeat && down) {
      if (MOVE_KEYS[e.code] && this.enabled) e.preventDefault();
      return;
    }
    if (down) this.setDevice('keyboard');
    if (down) this.held.add(e.code);
    else this.held.delete(e.code);
    if (!this.enabled) return;
    if (MOVE_KEYS[e.code] || DODGE_KEYS.has(e.code)) e.preventDefault();
    if (!down) return;
    if (ATTACK_KEYS.has(e.code)) this.latch.attack = true;
    if (DODGE_KEYS.has(e.code)) this.latch.dodge = true;
    if (SPECIAL_KEYS.has(e.code)) this.latch.special = true;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      this.onPause();
    }
  }

  /** Mouse buttons on the play field. */
  bindCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.latch.attack = true;
      if (e.button === 2) this.latch.dodge = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindTouch(): void {
    const zone = this.root.querySelector<HTMLElement>('#stick-zone')!;
    const R = 56;
    const place = () => {
      this.stickEl.style.transform = `translate(${this.stick.ox}px, ${this.stick.oy}px)`;
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      this.stickEl.classList.add('active');
      place();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.x = e.clientX;
      this.stick.y = e.clientY;
      // Let the base trail a thumb that drags far away.
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R * 1.6) {
        this.stick.ox = this.stick.x - (dx / d) * R * 1.6;
        this.stick.oy = this.stick.y - (dy / d) * R * 1.6;
      }
      place();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = -1;
      this.stick.x = this.stick.ox;
      this.stick.y = this.stick.oy;
      this.stickEl.classList.remove('active');
      place();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);

    const bindBtn = (sel: string, action: keyof Input['latch']) => {
      const el = this.root.querySelector<HTMLElement>(sel)!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.latch[action] = true;
        el.classList.add('pressed');
        this.vibrate(8);
      });
      const up = () => el.classList.remove('pressed');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    bindBtn('#btn-attack', 'attack');
    bindBtn('#btn-dodge', 'dodge');
    bindBtn('#btn-special', 'special');
  }

  haptics = true;
  vibrate(ms: number | number[]): void {
    if (this.haptics && this.device === 'touch' && 'vibrate' in navigator) navigator.vibrate(ms);
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Called every animation frame; handles gamepad edges and menu navigation. */
  update(dt: number, inMenu: boolean): void {
    const p = this.pad();
    if (!p) return;
    const b = p.buttons.map((x) => x.pressed);
    const edge = (i: number) => b[i] && !this.padPrev[i];
    const any = b.some(Boolean) || Math.abs(p.axes[0] ?? 0) > 0.5 || Math.abs(p.axes[1] ?? 0) > 0.5;
    if (any) this.setDevice('gamepad');
    if (this.enabled && !inMenu) {
      if (edge(0) || edge(2)) this.latch.attack = true;
      if (edge(1) || edge(4) || edge(6) || edge(7)) this.latch.dodge = true;
      if (edge(3) || edge(5)) this.latch.special = true;
    }
    if (edge(9)) this.onPause();
    if (inMenu) {
      this.padMenuCd -= dt;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      let dir: 'up' | 'down' | 'left' | 'right' | null = null;
      if (b[12] || ay < -0.6) dir = 'up';
      else if (b[13] || ay > 0.6) dir = 'down';
      else if (b[14] || ax < -0.6) dir = 'left';
      else if (b[15] || ax > 0.6) dir = 'right';
      if (dir && this.padMenuCd <= 0) {
        this.padMenuCd = 0.2;
        moveFocus(dir);
      } else if (!dir) this.padMenuCd = 0;
      if (edge(0)) (document.activeElement as HTMLElement | null)?.click();
      if (edge(1)) document.dispatchEvent(new CustomEvent('ui-back'));
    }
    this.padPrev = b;
  }

  poll(): InputFrame {
    let mx = 0, my = 0;
    for (const code of this.held) {
      const v = MOVE_KEYS[code];
      if (v) { mx += v[0]; my += v[1]; }
    }
    if (this.stick.id !== -1) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > 8) {
        const k = Math.min(1, d / 56);
        mx = (dx / d) * k;
        my = (dy / d) * k;
      }
    }
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      const d = Math.hypot(ax, ay);
      if (d > 0.18) {
        const k = Math.min(1, (d - 0.18) / 0.72);
        mx = (ax / d) * k;
        my = (ay / d) * k;
      }
      if (p.buttons[12]?.pressed) my = -1;
      if (p.buttons[13]?.pressed) my = 1;
      if (p.buttons[14]?.pressed) mx = -1;
      if (p.buttons[15]?.pressed) mx = 1;
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const frame: InputFrame = { mx, my, ...this.latch };
    this.latch = { attack: false, dodge: false, special: false };
    return frame;
  }

  clear(): void {
    this.latch = { attack: false, dodge: false, special: false };
    this.held.clear();
  }
}

/** Spatial focus navigation for gamepad / arrow keys in menus. */
export function moveFocus(dir: 'up' | 'down' | 'left' | 'right'): void {
  const screen = document.querySelector('.screen.active');
  if (!screen) return;
  const items = [...screen.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')]
    .filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !items.includes(cur)) {
    items[0].focus();
    return;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const q = el.getBoundingClientRect();
    const dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 4) continue;
    const score = along + across * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) best.focus();
  else if (dir === 'down' || dir === 'right') items[(items.indexOf(cur) + 1) % items.length].focus();
  else items[(items.indexOf(cur) - 1 + items.length) % items.length].focus();
  document.dispatchEvent(new CustomEvent('ui-move'));
}
