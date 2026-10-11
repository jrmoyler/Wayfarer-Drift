/**
 * Cinematic engine: animated, skippable cutscenes composed from the pack art.
 *
 * A cutscene is a list of shots. Each shot frames a background (title art or
 * an arena) with an eased camera move, stages animated sprite actors on it,
 * layers weather/light/rift effects, and times subtitles, title cards and
 * sound cues. Subtitles and cards are live DOM text (crisp, screen-reader
 * friendly); everything else is drawn on a canvas at display refresh rate.
 */
import { animFrame, catalog, type Images } from './assets';
import type { AudioEngine } from './audio';
import { CLASSES, type CharacterId, type PropId, type RegionId, type TravelerId } from './data';

type Bg = RegionId | 'title' | 'black';
type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
} satisfies Record<string, Ease>;

interface Cam { x: number; y: number; zoom: number }

interface Actor {
  cls: CharacterId | PropId;
  rift?: boolean;
  anim?: string;
  /** Normalised image coords (0..1). */
  x: number; y: number;
  x2?: number; y2?: number;
  /** Seconds within the shot. */
  enter?: number;
  move?: [number, number];
  scale?: number;
  /** Switch to this anim at this time (one-shot). */
  then?: { at: number; anim: string };
  spawnFx?: boolean;
  glow?: string;
}

type FxName = 'riftTear' | 'riftClose' | 'flash' | 'shake' | 'rays' | 'beacon' | 'pulse' | 'fadeIn' | 'fadeOut';

interface Shot {
  dur: number;
  bg: Bg;
  from: Cam;
  to: Cam;
  ease?: Ease;
  weather?: 'sand' | 'spray' | 'snow' | 'motes' | 'embers';
  actors?: Actor[];
  fx?: { at: number; name: FxName; x?: number; y?: number; dur?: number }[];
  lines?: { at: number; who?: string; text: string }[];
  card?: { at: number; kicker: string; title: string; sub?: string };
  sfx?: { at: number; name: string }[];
  grade?: string;
}

export type CutsceneId = 'prologue' | 'tidal' | 'highland' | 'finale';

const VOICE: Record<TravelerId, Record<'intro' | 'tidal' | 'highland' | 'finale', string>> = {
  sable: {
    intro: 'Dark beacons mean lost couriers. Not on my route.',
    tidal: 'Salt air and Echoes. Tidal Port never changes.',
    highland: 'Then I’ll carve a new route. Straight through you.',
    finale: 'Delivery complete. Sign here, big guy.',
  },
  rook: {
    intro: 'A map is a promise. I intend to keep this one.',
    tidal: 'The harbor charts are wrong. The Rift is redrawing the coast.',
    highland: 'Every lock has a key. Mine happens to be a staff.',
    finale: 'I’ll need a bigger map. The world just got wider.',
  },
  iona: {
    intro: 'The tide always comes back. So do I.',
    tidal: 'My harbor. They are standing on my harbor.',
    highland: 'Big and slow. I’ve moved harbors heavier than you.',
    finale: 'Easy now. Nobody’s locking you up again.',
  },
};

function script(id: CutsceneId, who: TravelerId): Shot[] {
  const me = CLASSES[who].name;
  switch (id) {
    case 'prologue':
      return [
        {
          dur: 7.5, bg: 'title', weather: 'motes', ease: ease.inOut,
          from: { x: 0.24, y: 0.7, zoom: 1.55 }, to: { x: 0.62, y: 0.66, zoom: 1.42 },
          fx: [{ at: 0, name: 'fadeIn', dur: 1.4 }, { at: 0, name: 'rays' }],
          lines: [
            { at: 0.8, text: 'Every route on the old map was drawn by someone who walked it first.' },
            { at: 4.2, text: 'Couriers. Cartographers. Tidekeepers. Wayfarers.' },
          ],
        },
        {
          dur: 6.5, bg: 'highland', weather: 'embers', ease: ease.out,
          from: { x: 0.5, y: 0.26, zoom: 1.35 }, to: { x: 0.5, y: 0.2, zoom: 1.7 },
          fx: [{ at: 0.6, name: 'riftTear', x: 0.5, y: 0.2, dur: 2.0 }, { at: 2.4, name: 'shake' }, { at: 2.5, name: 'flash' }],
          sfx: [{ at: 0.5, name: 'rift' }],
          lines: [
            { at: 0.4, text: 'Then the Rift opened above the Meridian…' },
            { at: 3.2, text: '…and the routes began to walk back.' },
          ],
          grade: 'rgba(80, 20, 90, 0.18)',
        },
        {
          dur: 7, bg: 'desert', weather: 'sand', ease: ease.inOut,
          from: { x: 0.5, y: 0.48, zoom: 1.45 }, to: { x: 0.5, y: 0.5, zoom: 1.75 },
          actors: [
            { cls: 'sable', rift: true, x: 0.42, y: 0.55, enter: 0.6, spawnFx: true },
            { cls: 'rook', rift: true, x: 0.5, y: 0.5, enter: 1.1, spawnFx: true },
            { cls: 'iona', rift: true, x: 0.58, y: 0.55, enter: 1.6, spawnFx: true },
          ],
          sfx: [{ at: 0.6, name: 'spawn' }, { at: 1.1, name: 'spawn' }, { at: 1.6, name: 'spawn' }],
          lines: [
            { at: 0.5, text: 'Echoes. Rift-made copies of every traveler who ever crossed it.' },
            { at: 3.8, text: 'They hold the relays now. Every beacon from the desert to the high gate has gone dark.' },
          ],
        },
        {
          dur: 7, bg: 'desert', weather: 'sand', ease: ease.out,
          from: { x: 0.5, y: 0.66, zoom: 1.6 }, to: { x: 0.5, y: 0.6, zoom: 1.45 },
          actors: [
            { cls: 'sable', rift: true, x: 0.42, y: 0.55 },
            { cls: 'rook', rift: true, x: 0.5, y: 0.5 },
            { cls: 'iona', rift: true, x: 0.58, y: 0.55 },
            { cls: who, anim: 'walk_n', x: 0.5, y: 0.9, x2: 0.5, y2: 0.7, move: [0, 2.6], then: { at: 2.6, anim: 'idle' } },
          ],
          lines: [
            { at: 0.6, who: me, text: VOICE[who].intro },
            { at: 3.4, text: 'Relight the beacons. Close the Rift.' },
          ],
          card: { at: 4.6, kicker: 'Region I', title: 'The Desert Relay', sub: 'Sand-scoured waystation where the first beacon went dark.' },
          fx: [{ at: 6.3, name: 'fadeOut', dur: 0.7 }],
        },
      ];
    case 'tidal':
      return [
        {
          dur: 5.5, bg: 'desert', weather: 'sand', ease: ease.out,
          from: { x: 0.5, y: 0.5, zoom: 1.9 }, to: { x: 0.5, y: 0.47, zoom: 1.65 },
          actors: [
            { cls: 'route_beacon', x: 0.5, y: 0.5, scale: 1.4, glow: '127, 243, 238' },
            { cls: who, x: 0.43, y: 0.54 },
          ],
          fx: [{ at: 0, name: 'fadeIn', dur: 0.8 }, { at: 0.8, name: 'beacon', x: 0.5, y: 0.5 }, { at: 0, name: 'rays' }],
          sfx: [{ at: 0.8, name: 'ready' }],
          lines: [{ at: 0.6, text: 'The first beacon burns. Far to the west, a harbor answers.' }],
        },
        {
          dur: 7, bg: 'tidal', weather: 'spray', ease: ease.inOut,
          from: { x: 0.5, y: 0.22, zoom: 1.7 }, to: { x: 0.5, y: 0.52, zoom: 1.45 },
          actors: [
            { cls: 'iona', rift: true, x: 0.4, y: 0.45 },
            { cls: 'sable', rift: true, x: 0.6, y: 0.47 },
            { cls: who, anim: 'walk_n', x: 0.5, y: 0.8, x2: 0.5, y2: 0.62, move: [1.2, 4], then: { at: 4, anim: 'idle' } },
          ],
          lines: [{ at: 2.0, who: me, text: VOICE[who].tidal }],
          card: { at: 4.4, kicker: 'Region II', title: 'The Tidal Port', sub: 'Copper domes, salt spray, and a harbor that remembers every ship.' },
          fx: [{ at: 6.3, name: 'fadeOut', dur: 0.7 }],
        },
      ];
    case 'highland':
      return [
        {
          dur: 5, bg: 'tidal', weather: 'spray', ease: ease.out,
          from: { x: 0.5, y: 0.5, zoom: 1.9 }, to: { x: 0.5, y: 0.42, zoom: 1.6 },
          actors: [
            { cls: 'route_beacon', x: 0.5, y: 0.5, scale: 1.4, glow: '127, 243, 238' },
            { cls: who, x: 0.57, y: 0.54 },
          ],
          fx: [{ at: 0, name: 'fadeIn', dur: 0.8 }, { at: 0.6, name: 'beacon', x: 0.5, y: 0.5 }, { at: 0, name: 'rays' }],
          sfx: [{ at: 0.6, name: 'ready' }],
          lines: [{ at: 0.5, text: 'Two beacons lit. One road left — up.' }],
        },
        {
          dur: 9, bg: 'highland', weather: 'snow', ease: ease.inOut,
          from: { x: 0.5, y: 0.16, zoom: 1.8 }, to: { x: 0.5, y: 0.5, zoom: 1.5 },
          actors: [
            { cls: 'warden', x: 0.5, y: 0.47, scale: 1.25, then: { at: 3.4, anim: 'special' } },
            { cls: who, anim: 'walk_n', x: 0.5, y: 0.95, x2: 0.5, y2: 0.74, move: [4.6, 6.6], then: { at: 6.6, anim: 'idle' } },
          ],
          fx: [{ at: 4.1, name: 'shake' }, { at: 4.1, name: 'pulse', x: 0.5, y: 0.47 }],
          sfx: [{ at: 3.4, name: 'roar' }, { at: 4.1, name: 'slam' }],
          lines: [
            { at: 0.6, text: 'Highland Station. The Meridian Gate — and the thing that guards it.' },
            { at: 3.4, who: 'The Gatewarden', text: 'ROUTE LOCKED. NO TRAVELER PASSES.' },
            { at: 6.0, who: me, text: VOICE[who].highland },
          ],
          card: { at: 7.2, kicker: 'Region III', title: 'Highland Station', sub: 'Above the clouds, the Meridian Gate.' },
          grade: 'rgba(120, 150, 220, 0.10)',
        },
      ];
    case 'finale':
      return [
        {
          dur: 6.5, bg: 'highland', weather: 'snow', ease: ease.out,
          from: { x: 0.5, y: 0.45, zoom: 2.1 }, to: { x: 0.5, y: 0.45, zoom: 1.7 },
          actors: [
            { cls: 'warden', x: 0.5, y: 0.47, scale: 1.25, anim: 'defeat' },
            { cls: who, x: 0.42, y: 0.62 },
          ],
          fx: [{ at: 0, name: 'fadeIn', dur: 0.8 }, { at: 1.8, name: 'riftClose', x: 0.5, y: 0.12, dur: 2.2 }, { at: 4.1, name: 'flash' }],
          sfx: [{ at: 1.6, name: 'rift' }, { at: 4.1, name: 'victory' }],
          lines: [
            { at: 0.5, text: 'The lock breaks. The Gatewarden kneels — and for the first time in an age, it is still.' },
            { at: 4.4, who: me, text: VOICE[who].finale },
          ],
        },
        {
          dur: 9.5, bg: 'title', weather: 'motes', ease: ease.inOut,
          from: { x: 0.52, y: 0.56, zoom: 1.6 }, to: { x: 0.5, y: 0.5, zoom: 1.0 },
          fx: [{ at: 0, name: 'rays' }, { at: 0, name: 'fadeIn', dur: 1.2 }, { at: 8.6, name: 'fadeOut', dur: 0.9 }],
          lines: [
            { at: 0.8, text: 'The beacons burn from the desert to the gate. The routes are ours again.' },
            { at: 4.2, who: 'The Gatewarden', text: '…ROUTE OPEN. WELCOME HOME, WAYFARERS.' },
          ],
          card: { at: 6.0, kicker: 'The Rift Campaign', title: 'Complete' },
        },
      ];
  }
}

interface Mote { x: number; y: number; vx: number; vy: number; s: number; a: number; p: number }

export class CutscenePlayer {
  private ctx: CanvasRenderingContext2D;
  private shots: Shot[] = [];
  private shotIndex = 0;
  private t = 0;
  private total = 0;
  private elapsed = 0;
  private lineIndex = 0;
  private typing: { text: string; shown: number } | null = null;
  private sfxFired = new Set<string>();
  private cardShown = -1;
  private motes: Mote[] = [];
  private shake = 0;
  private holding = 0;
  private done: (() => void) | null = null;
  private running = false;
  private letterbox = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;

  constructor(
    private root: HTMLElement,
    private canvas: HTMLCanvasElement,
    private images: Images,
    private audio: AudioEngine,
    private reduced: () => boolean,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    const advance = (e: Event) => {
      if (!this.running) return;
      e.preventDefault();
      this.advance();
    };
    root.addEventListener('click', advance);
    window.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyJ') advance(e);
      if (e.code === 'Escape') this.holding = Math.max(this.holding, 0.0001);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Escape') this.holding = 0;
    });
    const skip = root.querySelector<HTMLElement>('.cs-skip')!;
    skip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.holding = 0.0001;
    });
    const release = () => (this.holding = 0);
    skip.addEventListener('pointerup', release);
    skip.addEventListener('pointerleave', release);
    skip.addEventListener('click', (e) => e.stopPropagation());
  }

  get active(): boolean {
    return this.running;
  }

  play(id: CutsceneId, traveler: TravelerId): Promise<void> {
    this.shots = script(id, traveler);
    this.total = this.shots.reduce((s, x) => s + x.dur, 0);
    this.shotIndex = 0;
    this.t = 0;
    this.elapsed = 0;
    this.lineIndex = 0;
    this.typing = null;
    this.sfxFired.clear();
    this.cardShown = -1;
    this.holding = 0;
    this.letterbox = 0;
    this.running = true;
    this.resize();
    this.seedMotes();
    this.root.querySelector('.cs-sub')!.classList.remove('show');
    this.root.querySelector('.cs-card')!.classList.remove('show');
    this.audio.music('cutscene');
    return new Promise((resolve) => (this.done = resolve));
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  private seedMotes(): void {
    this.motes = Array.from({ length: 80 }, () => ({
      x: Math.random(), y: Math.random(), vx: 0, vy: 0, s: Math.random() * 2 + 0.6, a: Math.random() * 0.6 + 0.2, p: Math.random() * 6.28,
    }));
  }

  /** Tap: finish the line being typed, else jump ahead to the next beat. */
  private advance(): void {
    const sub = this.root.querySelector<HTMLElement>('.cs-sub-text')!;
    if (this.typing && this.typing.shown < this.typing.text.length) {
      this.typing.shown = this.typing.text.length;
      sub.textContent = this.typing.text;
      return;
    }
    const shot = this.shots[this.shotIndex];
    const next = shot.lines?.find((l, i) => i >= this.lineIndex && l.at > this.t);
    if (next && next.at - this.t > 0.3) this.t = next.at - 0.05;
    else this.nextShot();
    this.audio.sfx('ui_move');
  }

  private nextShot(): void {
    if (this.shotIndex >= this.shots.length - 1) {
      this.finish();
      return;
    }
    this.elapsed += this.shots[this.shotIndex].dur - this.t;
    this.shotIndex++;
    this.t = 0;
    this.lineIndex = 0;
    this.sfxFired.clear();
    this.root.querySelector('.cs-sub')!.classList.remove('show');
  }

  finish(): void {
    if (!this.running) return;
    this.running = false;
    this.root.querySelector('.cs-sub')!.classList.remove('show');
    this.root.querySelector('.cs-card')!.classList.remove('show');
    const d = this.done;
    this.done = null;
    d?.();
  }

  update(dt: number): void {
    if (!this.running) return;
    const shot = this.shots[this.shotIndex];
    this.t += dt;
    this.elapsed += dt;
    this.letterbox = Math.min(1, this.letterbox + dt * 1.6);

    // Hold-to-skip ring.
    const ring = this.root.querySelector<SVGCircleElement>('.cs-skip circle.fg')!;
    if (this.holding > 0) {
      this.holding += dt;
      if (this.holding > 0.8) {
        this.finish();
        return;
      }
    }
    ring.style.strokeDashoffset = String(113 * (1 - Math.min(1, this.holding / 0.8)));
    const bar = this.root.querySelector<HTMLElement>('.cs-progress i')!;
    bar.style.transform = `scaleX(${Math.min(1, this.elapsed / this.total)})`;

    // Subtitles.
    const lines = shot.lines ?? [];
    const subEl = this.root.querySelector<HTMLElement>('.cs-sub')!;
    const whoEl = this.root.querySelector<HTMLElement>('.cs-who')!;
    const textEl = this.root.querySelector<HTMLElement>('.cs-sub-text')!;
    while (this.lineIndex < lines.length && lines[this.lineIndex].at <= this.t) {
      const l = lines[this.lineIndex++];
      this.typing = { text: l.text, shown: 0 };
      whoEl.textContent = l.who ?? '';
      whoEl.hidden = !l.who;
      subEl.classList.toggle('boss', l.who === 'The Gatewarden');
      textEl.textContent = '';
      subEl.classList.add('show');
      textEl.setAttribute('aria-label', l.who ? `${l.who}: ${l.text}` : l.text);
    }
    if (this.typing && this.typing.shown < this.typing.text.length) {
      const before = Math.floor(this.typing.shown);
      this.typing.shown = Math.min(this.typing.text.length, this.typing.shown + dt * 46);
      const now = Math.floor(this.typing.shown);
      if (now > before) {
        textEl.textContent = this.typing.text.slice(0, now);
        if (now % 3 === 0) this.audio.sfx('type', { vol: 0.6 });
      }
    }

    // Title card.
    const cardEl = this.root.querySelector<HTMLElement>('.cs-card')!;
    if (shot.card && this.t >= shot.card.at && this.cardShown !== this.shotIndex) {
      this.cardShown = this.shotIndex;
      cardEl.querySelector('.k')!.textContent = shot.card.kicker;
      cardEl.querySelector('.t')!.textContent = shot.card.title;
      cardEl.querySelector('.s')!.textContent = shot.card.sub ?? '';
      cardEl.classList.remove('show');
      void cardEl.offsetWidth;
      cardEl.classList.add('show');
      subEl.classList.remove('show');
      this.audio.sfx('horn', { vol: 0.6 });
    }

    for (const s of shot.sfx ?? []) {
      const key = `${this.shotIndex}:${s.at}:${s.name}`;
      if (this.t >= s.at && !this.sfxFired.has(key)) {
        this.sfxFired.add(key);
        this.audio.sfx(s.name);
      }
    }
    for (const f of shot.fx ?? []) {
      const key = `fx:${this.shotIndex}:${f.at}:${f.name}`;
      if (f.name === 'shake' && this.t >= f.at && !this.sfxFired.has(key)) {
        this.sfxFired.add(key);
        if (!this.reduced()) this.shake = 18;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 30);

    if (this.t >= shot.dur) this.nextShot();
    this.draw(dt);
  }

  // ───────────────────────── drawing ─────────────────────────

  private bgImage(bg: Bg): HTMLImageElement | null {
    if (bg === 'black') return null;
    if (bg === 'title') return this.images.title;
    return this.images.arenas[bg];
  }

  private draw(dt: number): void {
    if (!this.running) return;
    const ctx = this.ctx;
    const shot = this.shots[this.shotIndex];
    const W = this.w, H = this.h;
    const reduced = this.reduced();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);

    const img = this.bgImage(shot.bg);
    const k = Math.min(1, this.t / shot.dur);
    const e = (shot.ease ?? ease.inOut)(reduced ? 0.5 : k);
    const cam = {
      x: shot.from.x + (shot.to.x - shot.from.x) * e,
      y: shot.from.y + (shot.to.y - shot.from.y) * e,
      zoom: shot.from.zoom + (shot.to.zoom - shot.from.zoom) * e,
    };
    let iw = W, ih = H, scale = 1;
    if (img) {
      iw = img.naturalWidth;
      ih = img.naturalHeight;
      scale = Math.max(W / iw, H / ih) * cam.zoom;
    }
    // Clamp so the frame never leaves the image.
    const halfW = W / 2 / scale, halfH = H / 2 / scale;
    const cx = Math.min(Math.max(cam.x * iw, halfW), iw - halfW);
    const cy = Math.min(Math.max(cam.y * ih, halfH), ih - halfH);
    const sx = (Math.random() * 2 - 1) * this.shake, sy = (Math.random() * 2 - 1) * this.shake;
    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    if (img) ctx.drawImage(img, 0, 0, iw, ih);

    // World-space layers.
    const actors = [...(shot.actors ?? [])].sort((a, b) => this.actorY(a) - this.actorY(b));
    for (const a of actors) this.drawActor(a, iw, ih);
    for (const f of shot.fx ?? []) this.drawWorldFx(f, iw, ih, scale);
    ctx.restore();

    // Screen-space layers.
    this.drawWeather(shot.weather, dt, reduced);
    if (shot.fx?.some((f) => f.name === 'rays')) this.drawRays();
    if (shot.grade) {
      ctx.fillStyle = shot.grade;
      ctx.fillRect(0, 0, W, H);
    }
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(3, 3, 8, 0.7)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    for (const f of shot.fx ?? []) this.drawScreenFx(f);

    // Letterbox.
    const bar = Math.round(Math.min(H * 0.11, 90) * ease.out(this.letterbox));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  }

  private actorY(a: Actor): number {
    return a.y2 !== undefined && a.move ? Math.max(a.y, a.y2) : a.y;
  }

  private drawActor(a: Actor, iw: number, ih: number): void {
    const ctx = this.ctx;
    if (a.enter !== undefined && this.t < a.enter) return;
    let x = a.x, y = a.y;
    if (a.move && a.x2 !== undefined && a.y2 !== undefined) {
      const m = Math.min(1, Math.max(0, (this.t - a.move[0]) / (a.move[1] - a.move[0])));
      x = a.x + (a.x2 - a.x) * m;
      y = a.y + (a.y2 - a.y) * m;
    }
    const px = x * iw, py = y * ih;
    // Art pixels → image pixels: arena art is 1254 wide and sprites are
    // authored for it, title art is not used with actors.
    const s = (a.scale ?? 1) * (iw / 1254);
    const since = a.enter !== undefined ? this.t - a.enter : this.t;
    const alpha = a.spawnFx ? Math.min(1, since / 0.6) : 1;

    if (a.cls in catalog.props.frames) {
      const fr = catalog.props.frames[a.cls as PropId];
      if (a.glow) {
        const g = ctx.createRadialGradient(px, py - fr.pivotY * s * 0.8, 4, px, py - fr.pivotY * s * 0.8, 120 * s);
        const pulse = 0.6 + 0.4 * Math.sin(this.t * 4);
        g.addColorStop(0, `rgba(${a.glow}, ${0.55 * pulse})`);
        g.addColorStop(1, `rgba(${a.glow}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(px - 140 * s, py - 260 * s, 280 * s, 300 * s);
      }
      ctx.drawImage(this.images.props, fr.x, fr.y, fr.w, fr.h, px - fr.pivotX * s, py - fr.pivotY * s, fr.w * s, fr.h * s);
      return;
    }
    const cls = a.cls as CharacterId;
    const sheet = catalog.characters[cls];
    let animName = a.anim ?? 'idle';
    let at = this.t + px * 0.01;
    if (a.then && this.t >= a.then.at) {
      animName = a.then.anim;
      at = this.t - a.then.at;
    }
    if (a.anim === 'defeat' || animName === 'defeat') at = this.t;
    const anim = sheet.anims[animName];
    const fr = animFrame(anim, at);
    const img = a.rift && cls !== 'warden' ? this.images.rift[cls]! : this.images.chars[cls];

    if (a.spawnFx && since < 0.9) {
      const g = ctx.createRadialGradient(px, py - 60 * s, 2, px, py - 60 * s, 110 * s);
      g.addColorStop(0, `rgba(255, 150, 240, ${0.8 * (1 - since / 0.9)})`);
      g.addColorStop(1, 'rgba(110, 30, 200, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - 120 * s, py - 180 * s, 240 * s, 240 * s);
    }
    ctx.fillStyle = 'rgba(10, 8, 12, 0.35)';
    ctx.beginPath();
    ctx.ellipse(px, py + 2, 30 * s * (cls === 'warden' ? 1.6 : 1), 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (anim.start + fr) * sheet.frameW, anim.row * sheet.frameH, sheet.frameW, sheet.frameH,
      px - sheet.pivotX * s, py - sheet.pivotY * s, sheet.frameW * s, sheet.frameH * s);
    ctx.globalAlpha = 1;
  }

  private drawWorldFx(f: NonNullable<Shot['fx']>[number], iw: number, ih: number, scale: number): void {
    const ctx = this.ctx;
    const local = this.t - f.at;
    if (local < 0) return;
    const x = (f.x ?? 0.5) * iw, y = (f.y ?? 0.5) * ih;
    switch (f.name) {
      case 'riftTear':
      case 'riftClose': {
        const dur = f.dur ?? 2;
        let g = Math.min(1, local / dur);
        if (f.name === 'riftClose') g = 1 - g;
        if (g <= 0) return;
        const span = iw * 0.32 * ease.out(g);
        const flicker = 0.75 + 0.25 * Math.sin(this.t * 40) * Math.sin(this.t * 13);
        // Deterministic jagged crack.
        const pts: [number, number][] = [];
        const n = 22;
        for (let i = 0; i <= n; i++) {
          const u = i / n - 0.5;
          const jag = Math.sin(i * 12.9898) * 43758.5453;
          const off = (jag - Math.floor(jag) - 0.5) * 28 * (1 - Math.abs(u) * 1.4);
          pts.push([x + u * span * 2, y + off + Math.sin(u * 5) * 10]);
        }
        const width = 14 * g * (1 / Math.max(0.6, scale)) + 4;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(220, 90, 255, 0.95)';
        ctx.shadowBlur = 40 * flicker;
        for (const [w, c] of [[width * 3, `rgba(150, 40, 220, ${0.35 * flicker})`], [width, `rgba(255, 120, 230, ${0.9 * flicker})`], [width * 0.35, 'rgba(255, 245, 255, 1)']] as const) {
          ctx.lineWidth = w;
          ctx.strokeStyle = c;
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.stroke();
        }
        ctx.restore();
        // Falling rift sparks.
        ctx.fillStyle = 'rgba(255, 160, 240, 0.9)';
        for (let i = 0; i < 40 * g; i++) {
          const seed = Math.sin(i * 78.233) * 43758.5453;
          const r = seed - Math.floor(seed);
          const fall = ((this.t * (60 + r * 80) + r * 400) % 300);
          ctx.globalAlpha = 1 - fall / 300;
          ctx.fillRect(x + (r - 0.5) * span * 2, y + fall, 2.5, 2.5);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'beacon': {
        const g = Math.min(1, local / 0.8);
        const pulse = 0.7 + 0.3 * Math.sin(this.t * 5);
        const grad = ctx.createLinearGradient(x, y - 900, x, y);
        grad.addColorStop(0, 'rgba(127, 243, 238, 0)');
        grad.addColorStop(1, `rgba(127, 243, 238, ${0.45 * g * pulse})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x - 26 * g, y - 900, 52 * g, 840);
        const r = ctx.createRadialGradient(x, y - 70, 2, x, y - 70, 160 * g + 1);
        r.addColorStop(0, `rgba(200, 255, 250, ${0.8 * g})`);
        r.addColorStop(1, 'rgba(127, 243, 238, 0)');
        ctx.fillStyle = r;
        ctx.fillRect(x - 200, y - 270, 400, 400);
        break;
      }
      case 'pulse': {
        const g = Math.min(1, local / 1.2);
        if (g >= 1) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, 0.55);
        ctx.strokeStyle = `rgba(255, 190, 90, ${1 - g})`;
        ctx.lineWidth = 16 * (1 - g) + 2;
        ctx.beginPath();
        ctx.arc(0, 0, 40 + g * 520, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }
      default:
        break;
    }
  }

  private drawScreenFx(f: NonNullable<Shot['fx']>[number]): void {
    const ctx = this.ctx;
    const local = this.t - f.at;
    if (local < 0) return;
    const W = this.w, H = this.h;
    switch (f.name) {
      case 'flash': {
        const a = Math.max(0, 1 - local / 0.7) * (this.reduced() ? 0.35 : 1);
        if (a > 0) {
          ctx.fillStyle = `rgba(255, 244, 236, ${a})`;
          ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      case 'fadeIn': {
        const a = 1 - Math.min(1, local / (f.dur ?? 1));
        if (a > 0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
          ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      case 'fadeOut': {
        const a = Math.min(1, local / (f.dur ?? 1));
        ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      default:
        break;
    }
  }

  private drawRays(): void {
    const ctx = this.ctx;
    const W = this.w, H = this.h;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(-W * 0.1, -H * 0.2);
    for (let i = 0; i < 6; i++) {
      const a = 0.35 + i * 0.13 + Math.sin(this.t * 0.4 + i) * 0.03;
      const len = Math.hypot(W, H) * 1.3;
      const wdt = 40 + i * 18;
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, `rgba(255, 200, 140, ${0.09 + 0.03 * Math.sin(this.t + i * 2)})`);
      g.addColorStop(1, 'rgba(255, 200, 140, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -wdt);
      ctx.lineTo(len, wdt);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawWeather(kind: Shot['weather'], dt: number, reduced: boolean): void {
    if (!kind) return;
    const ctx = this.ctx;
    const W = this.w, H = this.h;
    const conf = {
      sand: { vx: 0.12, vy: 0.01, c: '255, 214, 160' },
      spray: { vx: 0.01, vy: -0.03, c: '220, 245, 255' },
      snow: { vx: -0.02, vy: 0.07, c: '255, 255, 255' },
      motes: { vx: 0.01, vy: -0.015, c: '255, 220, 170' },
      embers: { vx: 0.015, vy: -0.05, c: '255, 140, 220' },
    }[kind];
    for (const m of this.motes) {
      if (!reduced) {
        m.x += (conf.vx + Math.sin(this.t + m.p) * 0.01) * dt * (0.5 + m.s * 0.3);
        m.y += conf.vy * dt * (0.5 + m.s * 0.3);
      }
      if (m.x > 1.02) m.x -= 1.04;
      if (m.x < -0.02) m.x += 1.04;
      if (m.y > 1.02) m.y -= 1.04;
      if (m.y < -0.02) m.y += 1.04;
      const tw = 0.6 + 0.4 * Math.sin(this.t * 2 + m.p);
      ctx.fillStyle = `rgba(${conf.c}, ${m.a * tw})`;
      ctx.beginPath();
      ctx.arc(m.x * W, m.y * H, m.s * (kind === 'snow' ? 1.4 : 1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
