/**
 * Canvas 2D renderer. Reads simulation state, never writes it. Owns the
 * camera, screen shake, particles, floating text and every cosmetic effect.
 */
import { animFrame, catalog, type CharSheet, type Images } from './assets';
import type { RegionDef } from './data';
import type { Fighter, Hazard, SimEvent, World } from './simulation';

const ARENA = 1254;
const TAU = Math.PI * 2;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; color: string;
  kind: 'spark' | 'dust' | 'chip' | 'rift' | 'drop' | 'coin' | 'ring' | 'star';
  drag: number; gravity: number; rot: number; spin: number;
}
interface Floater { x: number; y: number; text: string; color: string; life: number; max: number; size: number; vy: number; weight: number }
interface FxSprite { row: string; x: number; y: number; t: number; fps: number; scale: number; rot: number; flipY: boolean; alpha: number }
interface Ghost { x: number; y: number; dir: string; t: number; cls: Fighter['cls'] }
interface Ambient { x: number; y: number; vx: number; vy: number; size: number; a: number; phase: number }

export interface RenderOptions {
  reducedMotion: boolean;
  shakeScale: number;
  damageNumbers: boolean;
  focus?: { x: number; y: number; zoom?: number } | null;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private images: Images;
  private dpr = 1;
  private w = 0;
  private h = 0;

  cam = { x: 627, y: 627, zoom: 1, baseZoom: 1 };
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private punch = 0;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private fxs: FxSprite[] = [];
  private ghosts: Ghost[] = [];
  private ambient: Ambient[] = [];
  private flashCache = new Map<string, HTMLCanvasElement>();
  private hurtFlash = 0;
  private perfectFx = 0;
  private perfectAt = { x: 0, y: 0 };
  private whiteout = 0;
  private time = 0;
  private region: RegionDef | null = null;
  private grain: CanvasPattern | null = null;
  private lastGhost = 0;

  constructor(canvas: HTMLCanvasElement, images: Images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.images = images;
    this.resize();
    this.grain = this.makeGrain();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    const z = Math.min(this.w / 1100, this.h / 640);
    this.cam.baseZoom = Math.max(z, Math.max(this.w, this.h) / ARENA);
    this.cam.zoom = this.cam.baseZoom;
  }

  reset(region: RegionDef, x: number, y: number): void {
    this.region = region;
    this.particles = [];
    this.floaters = [];
    this.fxs = [];
    this.ghosts = [];
    this.cam.x = x;
    this.cam.y = y;
    this.shake = 0;
    this.whiteout = 0;
    this.ambient = Array.from({ length: region.weather === 'snow' ? 90 : 60 }, () => this.makeAmbient(true));
  }

  private makeGrain(): CanvasPattern | null {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const d = g.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 14;
    }
    g.putImageData(d, 0, 0);
    return this.ctx.createPattern(c, 'repeat');
  }

  private makeAmbient(anywhere: boolean): Ambient {
    const kind = this.region?.weather ?? 'sand';
    const vx = kind === 'sand' ? rand(30, 70) : kind === 'spray' ? rand(-12, 12) : rand(-18, 8);
    const vy = kind === 'snow' ? rand(22, 55) : kind === 'spray' ? rand(-18, -6) : rand(-6, 6);
    return {
      x: anywhere ? Math.random() : vx > 0 ? -0.02 : Math.random(),
      y: anywhere ? Math.random() : kind === 'snow' ? -0.02 : Math.random(),
      vx, vy, size: kind === 'snow' ? rand(1.2, 3.2) : rand(0.8, 2.2), a: rand(0.25, 0.7), phase: rand(0, TAU),
    };
  }

  // ───────────────────────── events → effects ─────────────────────────

  consume(events: SimEvent[], world: World, opts: RenderOptions): void {
    const rm = opts.reducedMotion;
    for (const e of events) {
      switch (e.type) {
        case 'swing': {
          const f = e.who === 'player' ? world.player : null;
          const reach = f ? f.reach : 60;
          const big = e.step === 2;
          this.fxs.push({
            row: 'slash', x: e.x + e.fx * reach * 0.62, y: e.y + e.fy * reach * 0.62 - 34, t: 0, fps: 26,
            scale: (e.who === 'player' ? 0.46 : 0.36) * (big ? 1.35 : 1), rot: Math.atan2(e.fy, e.fx),
            flipY: e.step === 1, alpha: e.who === 'player' ? 1 : 0.75,
          });
          break;
        }
        case 'hit': {
          const isPlayer = e.team === 'player';
          this.fxs.push({ row: 'impact', x: e.x + rand(-6, 6), y: e.y + rand(-6, 6), t: 0, fps: 30, scale: e.finisher ? 0.48 : 0.32, rot: rand(0, TAU), flipY: false, alpha: 1 });
          const n = rm ? 4 : e.finisher ? 16 : 9;
          for (let i = 0; i < n; i++) {
            const a = Math.atan2(e.fy, e.fx) + rand(-0.9, 0.9);
            const sp = rand(140, 420);
            this.particles.push(this.p(e.x, e.y + 30, 30, Math.cos(a) * sp, Math.sin(a) * sp * 0.6, rand(60, 220), rand(0.25, 0.5), rand(1.5, 3.2),
              isPlayer ? '#ff6a5a' : e.cls === 'iona' ? '#7ff3ee' : '#ffd38a', 'spark', 3, 600));
          }
          if (opts.damageNumbers) {
            this.floaters.push({
              x: e.x + rand(-10, 10), y: e.y - 6, text: e.crit ? `${e.dmg}!` : String(e.dmg),
              color: isPlayer ? '#ff6b6b' : e.crit ? '#ffe066' : '#fff4dc', life: 0.85, max: 0.85,
              size: isPlayer ? 26 : e.crit || e.finisher ? 30 : 22, vy: -70, weight: e.crit ? 900 : 800,
            });
          }
          if (isPlayer) this.hurtFlash = 1;
          break;
        }
        case 'kill': {
          const n = rm ? 8 : e.cls === 'warden' ? 90 : 26;
          for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), sp = rand(80, e.cls === 'warden' ? 520 : 300);
            this.particles.push(this.p(e.x, e.y, rand(20, 60), Math.cos(a) * sp, Math.sin(a) * sp * 0.6, rand(80, 260), rand(0.5, 1.2), rand(2, 4.5),
              i % 3 ? '#c56cf0' : '#ff9ad5', 'rift', 2.4, 260));
          }
          this.fxs.push({ row: 'impact', x: e.x, y: e.y - 40, t: 0, fps: 20, scale: e.cls === 'warden' ? 1.4 : 0.6, rot: 0, flipY: false, alpha: 1 });
          this.floaters.push({ x: e.x, y: e.y - 110, text: `+${e.score.toLocaleString()}`, color: e.elite ? '#ffd166' : '#f6e7c8', life: 1.1, max: 1.1, size: e.elite ? 26 : 18, vy: -40, weight: 700 });
          if (e.cls === 'warden') this.whiteout = 1;
          break;
        }
        case 'dodge':
          for (let i = 0; i < (rm ? 3 : 10); i++) {
            this.particles.push(this.p(e.x + rand(-14, 14), e.y + rand(-4, 4), 2, rand(-80, 80), rand(-30, 30), rand(10, 60), rand(0.35, 0.7), rand(3, 7),
              this.region?.weather === 'snow' ? '#e8eef8' : '#d9b58a', 'dust', 3, 80));
          }
          break;
        case 'perfect':
          this.perfectFx = 1;
          this.perfectAt = { x: e.x, y: e.y };
          this.floaters.push({ x: e.x, y: e.y - 140, text: 'PERFECT', color: '#7ff3ee', life: 1.1, max: 1.1, size: 34, vy: -24, weight: 900 });
          break;
        case 'special':
          this.onSpecial(e, rm);
          break;
        case 'impact': {
          this.fxs.push({ row: 'impact', x: e.x, y: e.y - 10, t: 0, fps: 18, scale: e.big ? 0.95 : 0.6, rot: 0, flipY: false, alpha: 1 });
          for (let i = 0; i < (rm ? 6 : 22); i++) {
            const a = rand(0, TAU), sp = rand(60, 300);
            this.particles.push(this.p(e.x, e.y, 4, Math.cos(a) * sp, Math.sin(a) * sp * 0.6, rand(100, 300), rand(0.5, 1), rand(2, 5), '#8a6a4a', 'chip', 1.5, 900));
          }
          break;
        }
        case 'pickup':
          if (e.kind === 'coin') {
            this.particles.push(this.p(e.x, e.y, 20, 0, 0, 60, 0.35, 10, '#ffd166', 'ring', 0, 0));
          } else {
            this.floaters.push({ x: e.x, y: e.y - 70, text: e.kind === 'medkit' ? `+${e.value}` : 'SPECIAL READY', color: e.kind === 'medkit' ? '#7ff3a0' : '#ffb347', life: 1, max: 1, size: 20, vy: -50, weight: 800 });
            for (let i = 0; i < 12; i++) {
              const a = rand(0, TAU);
              this.particles.push(this.p(e.x + Math.cos(a) * 20, e.y, rand(10, 70), 0, 0, rand(40, 110), rand(0.6, 1), rand(2, 3.5), e.kind === 'medkit' ? '#7ff3a0' : '#ffb347', 'spark', 0.5, -60));
            }
          }
          break;
        case 'propBreak':
          for (let i = 0; i < (rm ? 8 : 26); i++) {
            const a = rand(0, TAU), sp = rand(80, 320);
            this.particles.push(this.p(e.x, e.y, rand(10, 50), Math.cos(a) * sp, Math.sin(a) * sp * 0.6, rand(150, 380), rand(0.6, 1.3), rand(3, 7), i % 2 ? '#7a4a28' : '#b07a48', 'chip', 1.2, 1000));
          }
          break;
        case 'spawn': {
          for (let i = 0; i < (rm ? 6 : 30); i++) {
            const a = rand(0, TAU), r = rand(10, 50);
            this.particles.push(this.p(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r * 0.5, rand(0, 20), 0, 0, rand(60, 260), rand(0.5, 1.1), rand(1.5, 3.5), i % 2 ? '#b65cff' : '#ff7ad9', 'rift', 0.6, -120));
          }
          break;
        }
        case 'shake':
          this.shake = Math.min(26, this.shake + e.power * opts.shakeScale * (rm ? 0.25 : 1));
          break;
        case 'stagger':
          this.floaters.push({ x: e.x, y: e.y - 190, text: 'STAGGERED', color: '#ffd166', life: 1.4, max: 1.4, size: 30, vy: -20, weight: 900 });
          break;
        case 'bossPhase':
          this.whiteout = 0.6;
          break;
        default:
          break;
      }
    }
  }

  private onSpecial(e: Extract<SimEvent, { type: 'special' }>, rm: boolean): void {
    if (e.cls === 'sable') {
      for (let i = 0; i < 4; i++) {
        this.fxs.push({ row: 'dash', x: e.x + e.fx * (60 + i * 70), y: e.y + e.fy * (60 + i * 70) - 40, t: -i * 0.04, fps: 24, scale: 0.5, rot: Math.atan2(e.fy, e.fx), flipY: false, alpha: e.team === 'player' ? 1 : 0.7 });
      }
    } else if (e.cls === 'iona') {
      this.fxs.push({ row: 'splash', x: e.x, y: e.y - 6, t: -0.18, fps: 16, scale: e.team === 'player' ? 1.45 : 1.0, rot: 0, flipY: false, alpha: 1 });
      for (let i = 0; i < (rm ? 10 : 40); i++) {
        const a = rand(0, TAU), sp = rand(200, 500);
        this.particles.push(this.p(e.x, e.y, rand(10, 40), Math.cos(a) * sp, Math.sin(a) * sp * 0.6, rand(100, 300), rand(0.4, 0.9), rand(2, 4), '#7ff3ee', 'drop', 2, 700));
      }
    } else if (e.cls === 'rook') {
      this.fxs.push({ row: 'impact', x: e.x + e.fx * 40, y: e.y + e.fy * 40 - 10, t: -0.2, fps: 14, scale: 0.9, rot: 0, flipY: false, alpha: 1 });
    }
  }

  private p(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, kind: Particle['kind'], drag: number, gravity: number): Particle {
    return { x, y, z, vx, vy, vz, life, max: life, size, color, kind, drag, gravity, rot: rand(0, TAU), spin: rand(-8, 8) };
  }

  // ───────────────────────── frame ─────────────────────────

  draw(world: World, dt: number, opts: RenderOptions): void {
    const ctx = this.ctx;
    this.time += dt;
    this.updateCamera(world, dt, opts);
    this.updateParticles(dt);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const z = this.cam.zoom * this.dpr;
    const ox = this.w / 2 - (this.cam.x + this.shakeX) * this.cam.zoom;
    const oy = this.h / 2 - (this.cam.y + this.shakeY) * this.cam.zoom;
    ctx.setTransform(z, 0, 0, z, ox * this.dpr, oy * this.dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const region = world.region;
    ctx.drawImage(this.images.arenas[region.id], 0, 0, ARENA, ARENA);

    this.drawGroundHazards(world.hazards);
    this.drawShadows(world);
    this.drawWorldSorted(world);
    this.drawFx(dt);
    this.drawParticles();
    this.drawAirHazards(world.hazards);
    this.drawFloaters(dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawAmbient(dt, opts.reducedMotion);
    this.drawOffscreenMarkers(world);
    this.drawScreenFx(world, dt, opts);
  }

  private updateCamera(world: World, dt: number, opts: RenderOptions): void {
    const p = world.player;
    let tx = p.x + p.vx * 0.18;
    let ty = p.y - 40 + p.vy * 0.18;
    let zoom = this.cam.baseZoom;
    if (world.boss && world.boss.state !== 'dead') {
      // Frame both the player and the boss when they are close enough.
      const b = world.boss;
      tx = tx * 0.7 + b.x * 0.3;
      ty = ty * 0.7 + (b.y - 60) * 0.3;
    }
    if (opts.focus) {
      tx = opts.focus.x;
      ty = opts.focus.y;
      zoom = this.cam.baseZoom * (opts.focus.zoom ?? 1);
    }
    this.punch = Math.max(0, this.punch - dt * 3);
    const k = 1 - Math.exp(-dt * 6);
    this.cam.zoom += (zoom * (1 + this.punch * 0.04) - this.cam.zoom) * k;
    const vw = this.w / this.cam.zoom, vh = this.h / this.cam.zoom;
    const cx = vw >= ARENA ? ARENA / 2 : Math.min(Math.max(tx, vw / 2), ARENA - vw / 2);
    const cy = vh >= ARENA ? ARENA / 2 : Math.min(Math.max(ty, vh / 2), ARENA - vh / 2);
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;

    this.shake = Math.max(0, this.shake - dt * 60);
    const s = this.shake;
    this.shakeX = s ? (Math.random() * 2 - 1) * s * 0.6 : 0;
    this.shakeY = s ? (Math.random() * 2 - 1) * s * 0.6 : 0;
  }

  kick(power: number): void {
    this.punch = Math.min(1, this.punch + power);
  }

  // ───────────────────────── ground layer ─────────────────────────

  private drawGroundHazards(hazards: Hazard[]): void {
    const ctx = this.ctx;
    for (const h of hazards) {
      const prog = h.armMax > 0 ? 1 - Math.max(0, h.arm) / h.armMax : 1;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 18);
      if (h.kind === 'circle' && h.arm > 0) {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.scale(1, 0.62);
        ctx.fillStyle = `rgba(255, 60, 50, ${0.1 + prog * 0.12})`;
        ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(255, 90, 60, ${0.22 + prog * 0.25})`;
        ctx.beginPath(); ctx.arc(0, 0, h.r * prog, 0, TAU); ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(255, 200, 120, ${0.55 + pulse * 0.4})`;
        ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.stroke();
        ctx.restore();
      } else if (h.kind === 'lane' && h.arm > 0) {
        const ang = Math.atan2(h.y2 - h.y, h.x2 - h.x);
        const L = Math.hypot(h.x2 - h.x, h.y2 - h.y);
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(ang);
        ctx.fillStyle = `rgba(255, 140, 40, ${0.1 + prog * 0.12})`;
        ctx.fillRect(0, -h.width / 2, L, h.width);
        ctx.fillStyle = `rgba(255, 170, 60, ${0.25 + prog * 0.2})`;
        ctx.fillRect(0, -h.width / 2 * prog, L, h.width * prog);
        ctx.strokeStyle = `rgba(255, 220, 140, ${0.5 + pulse * 0.4})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([18, 12]);
        ctx.lineDashOffset = -this.time * 80;
        ctx.strokeRect(0, -h.width / 2, L, h.width);
        ctx.restore();
      } else if (h.kind === 'lane' && h.arm <= 0) {
        const ang = Math.atan2(h.y2 - h.y, h.x2 - h.x);
        const L = Math.hypot(h.x2 - h.x, h.y2 - h.y);
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(ang);
        const a = Math.max(0, h.life / 0.35);
        const g = ctx.createLinearGradient(0, -h.width / 2, 0, h.width / 2);
        g.addColorStop(0, 'rgba(255,140,40,0)');
        g.addColorStop(0.5, `rgba(255,236,180,${0.9 * a})`);
        g.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, -h.width / 2, L, h.width);
        ctx.restore();
      } else if (h.kind === 'ring' && h.arm > 0) {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.scale(1, 0.62);
        ctx.strokeStyle = `rgba(255, 180, 70, ${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 6;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc(0, 0, 60 + i * 50 + prog * 40, 0, TAU); ctx.stroke();
        }
        ctx.restore();
      } else if (h.kind === 'field' || h.kind === 'beacon') {
        const echo = h.kind === 'field';
        const armed = h.arm <= 0;
        const fade = Math.min(1, armed ? h.life * 2 : 1);
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.scale(1, 0.62);
        const col = echo ? '190, 90, 255' : '90, 230, 220';
        ctx.fillStyle = `rgba(${col}, ${(armed ? 0.2 : 0.08 + prog * 0.1) * fade})`;
        ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(${col}, ${(0.5 + pulse * 0.3) * fade})`;
        ctx.setLineDash(armed ? [] : [10, 10]);
        ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (!armed) {
          ctx.fillStyle = `rgba(${col}, ${0.25 * prog})`;
          ctx.beginPath(); ctx.arc(0, 0, h.r * prog, 0, TAU); ctx.fill();
        }
        // Rotating compass rune.
        ctx.rotate(this.time * (echo ? -0.8 : 0.6));
        ctx.strokeStyle = `rgba(${col}, ${0.6 * fade})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          ctx.rotate(TAU / 4);
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(h.r * 0.12, h.r * 0.12); ctx.lineTo(0, h.r * 0.85); ctx.lineTo(-h.r * 0.12, h.r * 0.12); ctx.closePath();
          ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0, 0, h.r * 0.62, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawAirHazards(hazards: Hazard[]): void {
    const ctx = this.ctx;
    for (const h of hazards) {
      if (h.kind === 'ring' && h.arm <= 0) {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.scale(1, 0.62);
        const a = Math.min(1, h.life);
        ctx.lineWidth = h.width;
        ctx.strokeStyle = `rgba(255, 150, 50, ${0.25 * a})`;
        ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.stroke();
        ctx.lineWidth = h.width * 0.35;
        ctx.strokeStyle = `rgba(255, 236, 190, ${0.85 * a})`;
        ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.stroke();
        ctx.restore();
      } else if (h.kind === 'pulse') {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.scale(1, 0.62);
        const a = Math.max(0, h.life / 0.5);
        ctx.lineWidth = 10 * a + 2;
        ctx.strokeStyle = `rgba(127, 243, 238, ${a})`;
        ctx.beginPath(); ctx.arc(0, 0, h.r, 0, TAU); ctx.stroke();
        ctx.restore();
      } else if (h.kind === 'beacon') {
        // The beacon itself stands in the middle of its field.
        this.drawProp('route_beacon', h.x, h.y, 0.85, Math.min(1, h.life * 2));
        const ctx2 = this.ctx;
        const glow = 0.5 + 0.5 * Math.sin(this.time * 6);
        ctx2.fillStyle = `rgba(127, 243, 238, ${0.25 + glow * 0.25})`;
        ctx2.beginPath(); ctx2.ellipse(h.x, h.y - 86, 10 + glow * 6, 14 + glow * 6, 0, 0, TAU); ctx2.fill();
      }
    }
  }

  private drawShadows(world: World): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10, 8, 12, 0.32)';
    for (const f of world.fighters) {
      if (f.state === 'dead' && world.time > f.removeAt - 0.6) continue;
      const r = f.radius * (f.cls === 'warden' ? 1.5 : 1.35) * f.scale;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 2, r, r * 0.42, 0, 0, TAU);
      ctx.fill();
    }
    for (const k of world.pickups) {
      ctx.beginPath();
      ctx.ellipse(k.x, k.y, 9, 4, 0, 0, TAU);
      ctx.fill();
    }
  }

  // ───────────────────────── sorted world ─────────────────────────

  private drawWorldSorted(world: World): void {
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (const prop of world.props) {
      if (prop.broken) {
        items.push({ y: prop.y - 40, draw: () => this.drawDebris(prop.x, prop.y) });
      } else {
        items.push({ y: prop.y, draw: () => this.drawProp(prop.prop, prop.x, prop.y, 1, 1, prop.flash > 0) });
      }
    }
    // Afterimages sit just behind their owner.
    for (const g of this.ghosts) items.push({ y: g.y - 0.5, draw: () => this.drawGhost(g) });
    for (const f of world.fighters) items.push({ y: f.y, draw: () => this.drawFighter(f, world) });
    for (const k of world.pickups) items.push({ y: k.y, draw: () => this.drawPickup(k.kind, k.x, k.y - k.z, k.t) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // Leave a trail while dodging/blinking.
    const p = world.player;
    if ((p.state === 'dodge' || (p.state === 'special' && p.cls === 'sable')) && this.time - this.lastGhost > 0.03) {
      this.lastGhost = this.time;
      this.ghosts.push({ x: p.x, y: p.y, dir: p.dir, t: 0, cls: p.cls });
    }
  }

  private drawProp(id: keyof typeof catalog.props.frames, x: number, y: number, scale = 1, alpha = 1, flash = false): void {
    const fr = catalog.props.frames[id];
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.images.props, fr.x, fr.y, fr.w, fr.h, x - fr.pivotX * scale, y - fr.pivotY * scale, fr.w * scale, fr.h * scale);
    if (flash) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.flashFor(`prop:${id}`, this.images.props, fr.x, fr.y, fr.w, fr.h), x - fr.pivotX * scale, y - fr.pivotY * scale, fr.w * scale, fr.h * scale);
    }
    ctx.globalAlpha = 1;
  }

  private drawDebris(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(70, 45, 28, 0.55)';
    for (let i = 0; i < 7; i++) {
      const a = i * 2.39, r = 8 + (i * 7) % 22;
      ctx.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.5 - 4, 6, 4);
    }
  }

  private drawPickup(kind: string, x: number, y: number, t: number): void {
    const ctx = this.ctx;
    const bob = Math.sin(t * 6) * 2;
    if (kind === 'coin') {
      const spin = Math.abs(Math.cos(t * 5));
      ctx.save();
      ctx.translate(x, y - 10 + bob);
      ctx.scale(0.35 + spin * 0.65, 1);
      const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 9);
      g.addColorStop(0, '#fff2b0');
      g.addColorStop(0.6, '#f0b430');
      g.addColorStop(1, '#a8661a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#7a4a10';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    } else {
      const glow = 0.5 + 0.5 * Math.sin(t * 5);
      const color = kind === 'medkit' ? '127, 243, 160' : '255, 179, 71';
      ctx.fillStyle = `rgba(${color}, ${0.18 + glow * 0.2})`;
      ctx.beginPath(); ctx.ellipse(x, y - 14 + bob, 20, 20, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(x, y - 14 + bob);
      if (kind === 'medkit') {
        ctx.fillStyle = '#2e3a40';
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9ff7ff';
        ctx.fillRect(-2.5, -7, 5, 14);
        ctx.fillRect(-7, -2.5, 14, 5);
      } else {
        ctx.fillStyle = '#5a3418';
        ctx.fillRect(-6, -11, 12, 22);
        ctx.fillStyle = '#ffb347';
        ctx.fillRect(-3, -7, 6, 14);
      }
      ctx.restore();
    }
  }

  private sheetFor(f: Fighter): { sheet: CharSheet; img: HTMLImageElement } {
    const sheet = catalog.characters[f.cls];
    const img = f.team === 'echo' && f.cls !== 'warden' ? this.images.rift[f.cls]! : this.images.chars[f.cls];
    return { sheet, img };
  }

  private poseOf(f: Fighter, world: World): { anim: string; frame: number; flip: boolean } {
    const sheet = catalog.characters[f.cls];
    const A = sheet.anims;
    const flip = f.fx < -0.3;
    const frac = f.dur > 0 ? Math.min(0.999, f.t / f.dur) : 0;
    switch (f.state) {
      case 'move':
        return { anim: `walk_${f.dir}`, frame: animFrame(A[`walk_${f.dir}`], world.time + f.id * 0.13, f.cls === 'warden' ? 0.7 : 1), flip: false };
      case 'dodge':
        return { anim: `walk_${f.dir}`, frame: animFrame(A[`walk_${f.dir}`], f.t, 2.4), flip: false };
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
        return { anim: 'idle', frame: animFrame(A.idle, world.time + f.id * 0.31), flip: false };
    }
  }

  private drawFighter(f: Fighter, world: World): void {
    const ctx = this.ctx;
    const { sheet, img } = this.sheetFor(f);
    const pose = this.poseOf(f, world);
    const a = sheet.anims[pose.anim];
    const sx = (a.start + pose.frame) * sheet.frameW;
    const sy = a.row * sheet.frameH;
    let alpha = 1;
    if (f.state === 'spawn') alpha = Math.min(1, f.t / f.dur);
    if (f.state === 'dead') alpha = Math.max(0, Math.min(1, (f.removeAt - world.time) / 0.6));
    if (f.team === 'player' && f.invuln > 0 && f.state !== 'dodge' && f.state !== 'special') alpha *= 0.55 + 0.45 * Math.sin(world.time * 40);
    if (alpha <= 0) return;

    const s = f.scale;
    let jx = 0;
    if (f.state === 'windup') jx = Math.sin(world.time * 70) * 1.5;
    if (f.state === 'hurt' || f.state === 'stagger') jx = Math.sin(world.time * 90) * 2.5 * (1 - f.t / Math.max(0.01, f.dur));

    // Spawn portal: a rift gate materialises, the Echo steps through, it fades.
    if (f.state === 'spawn') {
      const k = f.t / f.dur;
      if (f.cls !== 'warden') this.drawProp('portal_arch', f.x, f.y + 14, 0.85, Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.9);
      const g = ctx.createRadialGradient(f.x, f.y - 60, 4, f.x, f.y - 60, 90 * s);
      g.addColorStop(0, `rgba(255, 160, 240, ${0.7 * (1 - k)})`);
      g.addColorStop(1, 'rgba(120, 40, 200, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(f.x - 100, f.y - 170, 200, 200);
    }
    // Elite / boss aura under feet.
    if ((f.elite || f.cls === 'warden') && f.state !== 'dead') {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(1, 0.45);
      ctx.strokeStyle = f.cls === 'warden' ? 'rgba(255, 170, 60, 0.55)' : `rgba(255, 210, 102, ${0.45 + 0.25 * Math.sin(world.time * 5)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, f.radius * 1.9 * s, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // Windup tell: wedge on the ground + glyph overhead.
    if (f.state === 'windup' && f.team === 'echo' && (f.move === 'melee' || f.move === 'sweep' || f.move === 'lunge')) {
      const prog = f.t / f.dur;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(1, 0.62);
      const ang = Math.atan2(f.fy / 0.62, f.fx);
      ctx.rotate(ang);
      ctx.fillStyle = `rgba(255, 70, 60, ${0.14 + prog * 0.24})`;
      if (f.move === 'lunge') {
        ctx.fillRect(0, -24, 330, 48);
        ctx.fillStyle = `rgba(255, 120, 80, ${0.3 * prog})`;
        ctx.fillRect(0, -24, 330 * prog, 48);
      } else {
        const R = (f.reach + f.arc) * 1.05;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, -0.85, 0.85); ctx.closePath(); ctx.fill();
        ctx.fillStyle = `rgba(255, 140, 90, ${0.35 * prog})`;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R * prog, -0.85, 0.85); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    const dw = sheet.frameW * s, dh = sheet.frameH * s;
    const dx = f.x - sheet.pivotX * s + jx, dy = f.y - sheet.pivotY * s;
    ctx.globalAlpha = alpha;
    if (pose.flip) {
      ctx.save();
      ctx.translate(f.x + jx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, sheet.frameW, sheet.frameH, -sheet.pivotX * s, dy, dw, dh);
      if (f.flash > 0) {
        ctx.globalAlpha = Math.min(1, f.flash / 0.12) * 0.6;
        ctx.drawImage(this.flashFor(`${f.cls}:${pose.anim}:${pose.frame}`, img, sx, sy, sheet.frameW, sheet.frameH), -sheet.pivotX * s, dy, dw, dh);
      }
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, sheet.frameW, sheet.frameH, dx, dy, dw, dh);
      if (f.flash > 0) {
        ctx.globalAlpha = Math.min(1, f.flash / 0.12) * 0.6;
        ctx.drawImage(this.flashFor(`${f.cls}:${pose.anim}:${pose.frame}`, img, sx, sy, sheet.frameW, sheet.frameH), dx, dy, dw, dh);
      }
    }
    ctx.globalAlpha = 1;

    const headY = f.y - sheet.standHeight * s - 18;
    if (f.state === 'windup' && f.team === 'echo') {
      const blink = Math.sin(world.time * 30) > 0;
      ctx.font = `900 ${f.cls === 'warden' ? 40 : 30}px Cinzel, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#1a0606';
      ctx.fillStyle = blink ? '#ff5a4a' : '#ffd166';
      ctx.strokeText('!', f.x, headY);
      ctx.fillText('!', f.x, headY);
    }
    if (f.state === 'stagger') {
      for (let i = 0; i < 3; i++) {
        const a = world.time * 4 + (i * TAU) / 3;
        this.star(f.x + Math.cos(a) * 36, headY + Math.sin(a) * 10, 6, '#ffd166');
      }
    }
    // Compact HP pip bar over damaged Echoes.
    if (f.team === 'echo' && f.cls !== 'warden' && f.state !== 'dead' && f.state !== 'spawn' && f.hp < f.maxHp) {
      const w = f.elite ? 64 : 44;
      ctx.fillStyle = 'rgba(10, 8, 14, 0.75)';
      ctx.fillRect(f.x - w / 2 - 1, headY + 6, w + 2, 6);
      ctx.fillStyle = f.elite ? '#ffd166' : '#ff6a8a';
      ctx.fillRect(f.x - w / 2, headY + 7, w * Math.max(0, f.hp / f.maxHp), 4);
    }
  }

  private star(x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.4 : r;
      const a = (i * Math.PI) / 4;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  private drawGhost(g: Ghost): void {
    const sheet = catalog.characters[g.cls];
    const a = sheet.anims[`walk_${g.dir}`];
    const img = this.flashFor(`ghost:${g.cls}:${g.dir}`, this.images.chars[g.cls], a.start * sheet.frameW, a.row * sheet.frameH, sheet.frameW, sheet.frameH, '#7ff3ee');
    this.ctx.globalAlpha = Math.max(0, 0.45 * (1 - g.t / 0.28));
    this.ctx.drawImage(img, g.x - sheet.pivotX, g.y - sheet.pivotY, sheet.frameW, sheet.frameH);
    this.ctx.globalAlpha = 1;
  }

  /** Solid-colour silhouette of one frame, cached. */
  private flashFor(key: string, img: HTMLImageElement, sx: number, sy: number, w: number, h: number, color = '#ffffff'): HTMLCanvasElement {
    let c = this.flashCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.drawImage(img, sx, sy, w, h, 0, 0, w, h);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      this.flashCache.set(key, c);
    }
    return c;
  }

  // ───────────────────────── effects ─────────────────────────

  private drawFx(dt: number): void {
    const ctx = this.ctx;
    const frames = catalog.fx.frames;
    for (const fx of this.fxs) {
      fx.t += dt;
      if (fx.t < 0) continue;
      const i = Math.floor(fx.t * fx.fps);
      if (i >= 6) continue;
      const fr = frames[`${fx.row}_${i}`];
      ctx.save();
      ctx.globalAlpha = fx.alpha;
      ctx.translate(fx.x, fx.y);
      ctx.rotate(fx.rot);
      ctx.scale(fx.scale, fx.flipY ? -fx.scale : fx.scale);
      ctx.drawImage(this.images.fx, fr.x, fr.y, fr.w, fr.h, -fr.w / 2, -fr.h / 2, fr.w, fr.h);
      ctx.restore();
    }
    this.fxs = this.fxs.filter((f) => f.t * f.fps < 6);
    for (const g of this.ghosts) g.t += dt;
    this.ghosts = this.ghosts.filter((g) => g.t < 0.28);
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.gravity * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      if (p.z < 0 && p.gravity > 0) {
        p.z = 0;
        p.vz *= -0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.fillStyle = p.color;
      const y = p.y - p.z;
      switch (p.kind) {
        case 'dust':
          ctx.globalAlpha = k * 0.4;
          ctx.beginPath(); ctx.arc(p.x, y, p.size * (2 - k), 0, TAU); ctx.fill();
          break;
        case 'chip':
          ctx.save(); ctx.translate(p.x, y); ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
          ctx.restore();
          break;
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(p.x, y - 10, p.size * (2 - k) * 1.4, p.size * (2 - k) * 0.7, 0, 0, TAU); ctx.stroke();
          break;
        case 'spark': {
          const sp = Math.hypot(p.vx, p.vy - p.vz) * 0.03 + 1;
          ctx.save(); ctx.translate(p.x, y);
          ctx.rotate(Math.atan2(p.vy - p.vz, p.vx));
          ctx.fillRect(-p.size * sp, -p.size / 2, p.size * sp * 2, p.size);
          ctx.restore();
          break;
        }
        default:
          ctx.beginPath(); ctx.arc(p.x, y, p.size * (0.5 + k * 0.5), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawFloaters(dt: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      f.life -= dt;
      f.y += f.vy * dt;
      f.vy *= Math.exp(-3 * dt);
      const age = 1 - f.life / f.max;
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.7 : age < 0.22 ? 1.3 - ((age - 0.12) / 0.1) * 0.3 : 1;
      ctx.globalAlpha = Math.min(1, f.life / (f.max * 0.35));
      ctx.font = `${f.weight} ${Math.round(f.size * pop)}px Cinzel, Georgia, serif`;
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(12, 8, 6, 0.9)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  private drawAmbient(dt: number, reduced: boolean): void {
    if (!this.region) return;
    const ctx = this.ctx;
    const kind = this.region.weather;
    const color = kind === 'sand' ? '255, 214, 160' : kind === 'spray' ? '210, 245, 255' : '255, 255, 255';
    for (const a of this.ambient) {
      if (!reduced) {
        a.x += (a.vx * dt) / this.w + Math.sin(this.time + a.phase) * 0.0002;
        a.y += (a.vy * dt) / this.h;
      }
      if (a.x > 1.03 || a.x < -0.03 || a.y > 1.03 || a.y < -0.03) Object.assign(a, this.makeAmbient(false));
      ctx.fillStyle = `rgba(${color}, ${a.a * (kind === 'spray' ? 0.5 : 0.8)})`;
      ctx.beginPath();
      ctx.arc(a.x * this.w, a.y * this.h, a.size, 0, TAU);
      ctx.fill();
    }
  }

  private drawOffscreenMarkers(world: World): void {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    for (const f of world.fighters) {
      if (f.team !== 'echo' || f.state === 'dead') continue;
      const sx = (f.x - this.cam.x) * z + this.w / 2;
      const sy = (f.y - 50 - this.cam.y) * z + this.h / 2;
      const m = 26;
      if (sx > -10 && sx < this.w + 10 && sy > -10 && sy < this.h + 10) continue;
      const cx = Math.min(this.w - m, Math.max(m, sx));
      const cy = Math.min(this.h - m, Math.max(m + 50, sy));
      const ang = Math.atan2(sy - this.h / 2, sx - this.w / 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = f.cls === 'warden' ? '#ffb347' : f.elite ? '#ffd166' : '#ff6a8a';
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, 0); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawScreenFx(world: World, dt: number, opts: RenderOptions): void {
    const ctx = this.ctx;
    const W = this.w, H = this.h;
    // Warm key light from the north-west + vignette.
    const light = ctx.createLinearGradient(0, 0, W, H);
    light.addColorStop(0, this.region?.light ?? 'rgba(255,170,90,0.08)');
    light.addColorStop(0.55, 'rgba(0,0,0,0)');
    light.addColorStop(1, 'rgba(10, 14, 30, 0.22)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(4, 4, 8, 0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    // Low health heartbeat.
    const p = world.player;
    const hpFrac = p.hp / p.maxHp;
    if (hpFrac < 0.3 && p.state !== 'dead') {
      const beat = Math.pow(Math.max(0, Math.sin(this.time * 5.5)), 6);
      const r = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      r.addColorStop(0, 'rgba(0,0,0,0)');
      r.addColorStop(1, `rgba(170, 20, 30, ${0.25 + beat * 0.3})`);
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.hurtFlash > 0) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3.5);
      const r = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
      r.addColorStop(0, 'rgba(0,0,0,0)');
      r.addColorStop(1, `rgba(255, 40, 40, ${0.45 * this.hurtFlash})`);
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.perfectFx > 0) {
      this.perfectFx = Math.max(0, this.perfectFx - dt * 1.6);
      const k = 1 - this.perfectFx;
      const sx = (this.perfectAt.x - this.cam.x) * this.cam.zoom + W / 2;
      const sy = (this.perfectAt.y - 50 - this.cam.y) * this.cam.zoom + H / 2;
      ctx.fillStyle = `rgba(40, 120, 160, ${0.22 * this.perfectFx})`;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = `rgba(127, 243, 238, ${this.perfectFx})`;
      ctx.lineWidth = 6 * this.perfectFx + 1;
      ctx.beginPath(); ctx.arc(sx, sy, 20 + k * Math.max(W, H) * 0.6, 0, TAU); ctx.stroke();
    }
    if (this.whiteout > 0) {
      ctx.fillStyle = `rgba(255, 246, 228, ${this.whiteout * (opts.reducedMotion ? 0.3 : 0.75)})`;
      ctx.fillRect(0, 0, W, H);
      this.whiteout = Math.max(0, this.whiteout - dt * 1.4);
    }
    if (this.grain && !opts.reducedMotion) {
      ctx.save();
      ctx.translate((Math.random() * 128) | 0, (Math.random() * 128) | 0);
      ctx.fillStyle = this.grain;
      ctx.fillRect(-128, -128, W + 256, H + 256);
      ctx.restore();
    }
  }

  /** World → CSS pixel position, for DOM overlays. */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.cam.x) * this.cam.zoom + this.w / 2, y: (y - this.cam.y) * this.cam.zoom + this.h / 2 };
  }
}
