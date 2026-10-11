/**
 * Original procedural score and sound effects, synthesised with Web Audio.
 * Nothing is sampled; every voice is built from oscillators and a shared
 * noise buffer, scheduled with a look-ahead clock for tight timing.
 */

export type Track = 'title' | 'desert' | 'tidal' | 'highland' | 'boss' | 'cutscene' | 'none';

interface TrackDef {
  bpm: number;
  root: number;
  scale: number[];
  /** Chord roots as scale degrees, one per bar. */
  prog: number[];
  arp: (number | null)[];
  bass: (number | null)[];
  drums: string;
  pad: boolean;
  bells: boolean;
  swing: number;
}

const TRACKS: Record<Exclude<Track, 'none'>, TrackDef> = {
  title: {
    bpm: 80, root: 50, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 5, 3, 4],
    arp: [0, null, 2, null, 4, null, 2, null, 7, null, 4, null, 2, null, 4, null],
    bass: [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, null, null],
    drums: 't...............t.......t.......', pad: true, bells: true, swing: 0,
  },
  desert: {
    bpm: 104, root: 50, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 0, 6, 5],
    arp: [0, 2, 4, 2, 7, 4, 2, 4, 0, 2, 4, 2, 5, 4, 2, 1],
    bass: [0, null, 0, null, null, 0, null, null, 0, null, 0, null, 4, null, 3, null],
    drums: 'k.s.d.sdk.s.d.ss', pad: true, bells: false, swing: 0.12,
  },
  tidal: {
    bpm: 112, root: 53, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 1, 5, 4],
    arp: [0, 4, 7, 9, 11, 9, 7, 4, 2, 4, 7, 9, 7, 4, 2, 4],
    bass: [0, null, null, 0, null, null, 0, null, 0, null, null, 0, null, 4, null, null],
    drums: 'k..hk.h.k..hs.hh', pad: true, bells: true, swing: 0.08,
  },
  highland: {
    bpm: 96, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6],
    arp: [0, null, 4, 7, null, 4, 9, null, 7, null, 4, 2, null, 4, 0, null],
    bass: [0, null, null, null, 0, null, null, null, 0, null, null, null, 4, null, 6, null],
    drums: 't...s...t.t.s...', pad: true, bells: true, swing: 0,
  },
  boss: {
    bpm: 144, root: 49, scale: [0, 2, 3, 5, 7, 8, 11], prog: [0, 0, 5, 4],
    arp: [7, 4, 2, 0, 7, 4, 2, 0, 8, 4, 2, 0, 6, 4, 2, 0],
    bass: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
    drums: 'k.hsk.hsk.hst.st', pad: true, bells: false, swing: 0,
  },
  cutscene: {
    bpm: 66, root: 50, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 5, 4],
    arp: [null, null, null, null, 7, null, null, null, null, null, null, null, 4, null, null, null],
    bass: [0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    drums: '................', pad: true, bells: true, swing: 0,
  },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private drumBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private track: Track = 'none';
  private pending: Track = 'none';
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private intensity = 0.5;
  private vol = { master: 0.8, music: 0.6, sfx: 0.8 };
  private muted = false;
  private lastSfx = new Map<string, number>();

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.drumBus = ctx.createGain();
      this.drumBus.connect(this.musicBus);
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.35;
      this.reverbSend.connect(this.reverb).connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.pending !== this.track) this.music(this.pending);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(master: number, music: number, sfx: number, muted = false): void {
    this.vol = { master, music, sfx };
    this.muted = muted;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    if (this.ctx) this.drumBus.gain.setTargetAtTime(0.35 + this.intensity * 0.65, this.ctx.currentTime, 0.3);
  }

  music(track: Track): void {
    this.pending = track;
    if (!this.ctx || track === this.track) return;
    const t = this.ctx.currentTime;
    // Short dip on the bus so track changes never click.
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(0.0001, t, 0.08);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t + 0.35, 0.2);
    this.track = track;
    this.step = 0;
    this.nextTime = t + 0.4;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return buf;
  }

  // ───────────────────────── sequencer ─────────────────────────

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.track === 'none' || ctx.state !== 'running') return;
    const def = TRACKS[this.track];
    const sixteenth = 60 / def.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16) % def.prog.length;
      const swing = s % 2 ? def.swing * sixteenth : 0;
      this.playStep(def, s, bar, this.nextTime + swing, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private note(def: TrackDef, degree: number, chord: number, octave: number): number {
    const d = degree + chord;
    const sc = def.scale;
    const o = Math.floor(d / sc.length);
    return def.root + sc[((d % sc.length) + sc.length) % sc.length] + 12 * (o + octave);
  }

  private playStep(def: TrackDef, s: number, bar: number, t: number, sx: number): void {
    const chord = def.prog[bar];
    if (s === 0 && def.pad) {
      const notes = [0, 2, 4, 6].map((d) => mtof(this.note(def, d, chord, 0)));
      this.pad(t, notes, sx * 16);
    }
    const a = def.arp[s];
    if (a !== null && a !== undefined) {
      const f = mtof(this.note(def, a, chord, 1));
      if (def.bells && s % 4 === 0) this.bell(t, f, 0.05);
      else this.pluck(t, f, sx * 1.6, 0.05 + this.intensity * 0.03);
    }
    const b = def.bass[s];
    if (b !== null && b !== undefined) this.bass(t, mtof(this.note(def, b, chord, -1)), sx * 1.8);
    const dch = def.drums[s % def.drums.length] ?? '.';
    const dch2 = def.drums.length > 16 ? def.drums[(s + 16 * (bar % 2)) % def.drums.length] : dch;
    switch (dch2) {
      case 'k': this.kick(t); break;
      case 's': this.snare(t); break;
      case 'h': this.hat(t); break;
      case 't': this.taiko(t, 0.6); break;
      case 'd': this.darbuka(t); break;
    }
    if (this.intensity > 0.65 && s % 2 === 1 && dch2 === '.') this.hat(t, 0.4);
  }

  // ───────────────────────── voices ─────────────────────────

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, out: AudioNode): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseSrc(t: number, dur: number, out: AudioNode): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise;
    n.connect(out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.05);
    return n;
  }

  private filter(type: BiquadFilterType, f: number, q = 0.8): BiquadFilterNode {
    const b = this.ctx!.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private gain(out: AudioNode, send = 0): GainNode {
    const g = this.ctx!.createGain();
    g.connect(out);
    if (send) {
      const s = this.ctx!.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverbSend);
    }
    return g;
  }

  private pad(t: number, freqs: number[], dur: number): void {
    const g = this.gain(this.musicBus, 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.1);
    const lp = this.filter('lowpass', 900);
    lp.connect(g);
    for (const f of freqs) {
      for (const det of [-7, 7]) {
        const o = this.osc('sawtooth', f, t, dur * 1.1, lp);
        o.detune.value = det;
      }
    }
  }

  private pluck(t: number, f: number, dur: number, vol: number): void {
    const g = this.gain(this.musicBus, 0.4);
    this.env(g, t, 0.005, vol, dur);
    const lp = this.filter('lowpass', 3200, 2);
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    lp.connect(g);
    this.osc('triangle', f, t, dur, lp);
    this.osc('square', f * 0.5, t, dur, lp).detune.value = 4;
  }

  private bell(t: number, f: number, vol: number): void {
    const g = this.gain(this.musicBus, 0.9);
    this.env(g, t, 0.004, vol, 1.6);
    this.osc('sine', f, t, 1.6, g);
    const g2 = this.gain(this.musicBus, 0.9);
    this.env(g2, t, 0.004, vol * 0.4, 0.8);
    this.osc('sine', f * 2.76, t, 0.8, g2);
  }

  private bass(t: number, f: number, dur: number): void {
    const g = this.gain(this.musicBus);
    this.env(g, t, 0.01, 0.13, dur);
    const lp = this.filter('lowpass', 380, 3);
    lp.connect(g);
    this.osc('sawtooth', f, t, dur, lp);
    this.osc('sine', f / 2, t, dur, g);
  }

  private kick(t: number): void {
    const g = this.gain(this.drumBus);
    this.env(g, t, 0.002, 0.5, 0.28);
    const o = this.osc('sine', 130, t, 0.3, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  }

  private taiko(t: number, vol: number): void {
    const g = this.gain(this.drumBus, 0.5);
    this.env(g, t, 0.003, vol, 0.5);
    const o = this.osc('sine', 95, t, 0.5, g);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.3);
    const ng = this.gain(this.drumBus, 0.3);
    this.env(ng, t, 0.002, vol * 0.5, 0.12);
    const lp = this.filter('lowpass', 420);
    lp.connect(ng);
    this.noiseSrc(t, 0.15, lp);
  }

  private snare(t: number): void {
    const g = this.gain(this.drumBus, 0.25);
    this.env(g, t, 0.002, 0.18, 0.16);
    const bp = this.filter('bandpass', 1900, 0.9);
    bp.connect(g);
    this.noiseSrc(t, 0.2, bp);
    const tg = this.gain(this.drumBus);
    this.env(tg, t, 0.002, 0.12, 0.08);
    this.osc('triangle', 190, t, 0.1, tg);
  }

  private hat(t: number, vol = 1): void {
    const g = this.gain(this.drumBus);
    this.env(g, t, 0.001, 0.05 * vol, 0.04);
    const hp = this.filter('highpass', 7200);
    hp.connect(g);
    this.noiseSrc(t, 0.06, hp);
  }

  private darbuka(t: number): void {
    const g = this.gain(this.drumBus, 0.2);
    this.env(g, t, 0.001, 0.16, 0.09);
    const o = this.osc('sine', 330, t, 0.1, g);
    o.frequency.exponentialRampToValueAtTime(210, t + 0.08);
    const ng = this.gain(this.drumBus);
    this.env(ng, t, 0.001, 0.06, 0.03);
    const bp = this.filter('bandpass', 3200, 1.5);
    bp.connect(ng);
    this.noiseSrc(t, 0.04, bp);
  }

  // ───────────────────────── sfx ─────────────────────────

  sfx(name: string, opt: { pitch?: number; vol?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // De-duplicate bursts of identical sounds in the same frame.
    const last = this.lastSfx.get(name) ?? -1;
    if (now - last < 0.025) return;
    this.lastSfx.set(name, now);
    const t = now + 0.005;
    const p = opt.pitch ?? 1;
    const v = opt.vol ?? 1;
    const out = this.sfxBus;
    switch (name) {
      case 'swing': {
        const g = this.gain(out);
        this.env(g, t, 0.01, 0.22 * v, 0.13);
        const bp = this.filter('bandpass', 700 * p, 1.4);
        bp.frequency.exponentialRampToValueAtTime(2600 * p, t + 0.12);
        bp.connect(g);
        this.noiseSrc(t, 0.16, bp);
        break;
      }
      case 'hit':
      case 'heavy': {
        const heavy = name === 'heavy';
        const g = this.gain(out, 0.15);
        this.env(g, t, 0.001, (heavy ? 0.5 : 0.36) * v, heavy ? 0.22 : 0.11);
        const lp = this.filter('lowpass', heavy ? 1500 : 2600);
        lp.connect(g);
        this.noiseSrc(t, 0.25, lp);
        const og = this.gain(out);
        this.env(og, t, 0.001, 0.35 * v, heavy ? 0.25 : 0.12);
        const lp2 = this.filter('lowpass', 900);
        lp2.connect(og);
        const o = this.osc('square', (heavy ? 160 : 230) * p, t, 0.3, lp2);
        o.frequency.exponentialRampToValueAtTime((heavy ? 45 : 70) * p, t + 0.12);
        if (heavy) this.taikoSfx(t, 0.6 * v);
        break;
      }
      case 'hurt': {
        const g = this.gain(out);
        this.env(g, t, 0.002, 0.3 * v, 0.25);
        const lp = this.filter('lowpass', 1400);
        lp.connect(g);
        const o = this.osc('sawtooth', 320, t, 0.3, lp);
        o.frequency.exponentialRampToValueAtTime(110, t + 0.22);
        this.sfxNoise(t, 0.12, 'lowpass', 1200, 0.25 * v);
        break;
      }
      case 'kill': {
        const g = this.gain(out, 0.5);
        this.env(g, t, 0.005, 0.18 * v, 0.45);
        const o = this.osc('sine', 880 * p, t, 0.5, g);
        o.frequency.exponentialRampToValueAtTime(160, t + 0.4);
        this.sfxNoise(t, 0.35, 'highpass', 5000, 0.08 * v, 0.5);
        break;
      }
      case 'dodge':
        this.sfxNoise(t, 0.2, 'bandpass', 1200, 0.2 * v, 0, 4200);
        break;
      case 'perfect': {
        for (const [i, f] of [1318.5, 1975.5, 2637].entries()) {
          const g = this.gain(out, 0.9);
          this.env(g, t + i * 0.04, 0.003, 0.14 * v, 1.2);
          this.osc('sine', f, t + i * 0.04, 1.2, g);
        }
        const g = this.gain(out, 0.6);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18 * v, t + 0.25);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        const hp = this.filter('highpass', 2000);
        hp.connect(g);
        this.noiseSrc(t, 0.32, hp);
        break;
      }
      case 'special_sable': {
        this.sfxNoise(t, 0.3, 'bandpass', 900, 0.3 * v, 0, 5200);
        const g = this.gain(out, 0.4);
        this.env(g, t, 0.01, 0.15 * v, 0.3);
        const o = this.osc('triangle', 440, t, 0.35, g);
        o.frequency.exponentialRampToValueAtTime(1760, t + 0.25);
        break;
      }
      case 'special_rook': {
        this.taikoSfx(t + 0.2, 0.8 * v);
        for (const [i, f] of [587.3, 880, 1174.7].entries()) {
          const g = this.gain(out, 0.9);
          this.env(g, t + 0.2 + i * 0.07, 0.003, 0.12 * v, 1.4);
          this.osc('sine', f, t + 0.2 + i * 0.07, 1.4, g);
        }
        break;
      }
      case 'special_iona': {
        this.sfxNoise(t + 0.15, 0.6, 'lowpass', 2400, 0.4 * v, 0.3, 300);
        this.taikoSfx(t + 0.28, 0.7 * v);
        for (let i = 0; i < 6; i++) {
          const g = this.gain(out, 0.3);
          const tt = t + 0.3 + i * 0.05;
          this.env(g, tt, 0.002, 0.06 * v, 0.08);
          const o = this.osc('sine', 500 + Math.random() * 600, tt, 0.1, g);
          o.frequency.exponentialRampToValueAtTime(1500, tt + 0.08);
        }
        break;
      }
      case 'telegraph': {
        for (let i = 0; i < 2; i++) {
          const g = this.gain(out);
          this.env(g, t + i * 0.09, 0.002, 0.06 * v, 0.06);
          this.osc('square', 990 * p, t + i * 0.09, 0.08, g);
        }
        break;
      }
      case 'horn': {
        const g = this.gain(out, 0.6);
        this.env(g, t, 0.15, 0.22 * v, 1.1);
        const lp = this.filter('lowpass', 700, 2);
        lp.connect(g);
        this.osc('sawtooth', 73.4 * p, t, 1.3, lp);
        this.osc('sawtooth', 110 * p, t, 1.3, lp).detune.value = 6;
        break;
      }
      case 'slam':
        this.taikoSfx(t, 1.0 * v);
        this.sfxNoise(t, 0.5, 'lowpass', 900, 0.45 * v, 0.3);
        break;
      case 'coin': {
        const g = this.gain(out, 0.2);
        this.env(g, t, 0.002, 0.08 * v, 0.06);
        this.osc('square', 1318.5 * p, t, 0.07, g);
        const g2 = this.gain(out, 0.3);
        this.env(g2, t + 0.06, 0.002, 0.08 * v, 0.22);
        this.osc('square', 1975.5 * p, t + 0.06, 0.25, g2);
        break;
      }
      case 'heal':
        for (const [i, f] of [523.3, 659.3, 784, 1046.5].entries()) {
          const g = this.gain(out, 0.6);
          this.env(g, t + i * 0.06, 0.004, 0.09 * v, 0.4);
          this.osc('triangle', f, t + i * 0.06, 0.45, g);
        }
        break;
      case 'ready': {
        const g = this.gain(out, 0.8);
        this.env(g, t, 0.003, 0.1 * v, 0.7);
        this.osc('sine', 1567.98, t, 0.7, g);
        const g2 = this.gain(out, 0.8);
        this.env(g2, t + 0.08, 0.003, 0.08 * v, 0.8);
        this.osc('sine', 2349.3, t + 0.08, 0.8, g2);
        break;
      }
      case 'wave': {
        this.sfx('horn', { vol: 0.8 * v });
        break;
      }
      case 'clear':
      case 'victory': {
        const chord = name === 'victory' ? [587.3, 740, 880, 1174.7, 1480] : [587.3, 740, 880];
        for (const [i, f] of chord.entries()) {
          const g = this.gain(out, 0.7);
          this.env(g, t + i * 0.08, 0.01, 0.1 * v, name === 'victory' ? 2.2 : 1.0);
          const lp = this.filter('lowpass', 2400);
          lp.connect(g);
          this.osc('sawtooth', f, t + i * 0.08, 2.3, lp);
        }
        this.taikoSfx(t, 0.6 * v);
        break;
      }
      case 'defeat': {
        for (const [i, f] of [293.7, 277.2, 261.6, 207.7].entries()) {
          const g = this.gain(out, 0.7);
          this.env(g, t + i * 0.28, 0.02, 0.12 * v, 0.6);
          const lp = this.filter('lowpass', 1200);
          lp.connect(g);
          this.osc('sawtooth', f, t + i * 0.28, 0.7, lp);
        }
        break;
      }
      case 'roar': {
        const g = this.gain(out, 0.5);
        this.env(g, t, 0.08, 0.35 * v, 1.2);
        const lp = this.filter('lowpass', 500, 4);
        lp.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
        lp.frequency.exponentialRampToValueAtTime(300, t + 1.2);
        lp.connect(g);
        this.osc('sawtooth', 55, t, 1.3, lp);
        this.osc('sawtooth', 58, t, 1.3, lp);
        this.sfxNoise(t, 1, 'bandpass', 600, 0.2 * v, 0.6);
        break;
      }
      case 'break':
        this.sfxNoise(t, 0.25, 'bandpass', 900, 0.35 * v);
        this.taikoSfx(t, 0.35 * v);
        break;
      case 'empty': {
        const g = this.gain(out);
        this.env(g, t, 0.002, 0.12 * v, 0.08);
        this.osc('square', 130, t, 0.1, g);
        break;
      }
      case 'spawn': {
        const g = this.gain(out, 0.6);
        this.env(g, t, 0.05, 0.07 * v, 0.5);
        const o = this.osc('sine', 220, t, 0.6, g);
        o.frequency.exponentialRampToValueAtTime(660, t + 0.5);
        break;
      }
      case 'ui_move': {
        const g = this.gain(out);
        this.env(g, t, 0.001, 0.05 * v, 0.04);
        this.osc('triangle', 1200, t, 0.05, g);
        break;
      }
      case 'ui_ok': {
        for (const [i, f] of [880, 1318.5].entries()) {
          const g = this.gain(out, 0.3);
          this.env(g, t + i * 0.05, 0.002, 0.08 * v, 0.18);
          this.osc('triangle', f, t + i * 0.05, 0.2, g);
        }
        break;
      }
      case 'ui_back': {
        const g = this.gain(out);
        this.env(g, t, 0.002, 0.07 * v, 0.12);
        const o = this.osc('triangle', 660, t, 0.14, g);
        o.frequency.exponentialRampToValueAtTime(440, t + 0.1);
        break;
      }
      case 'type': {
        const g = this.gain(out);
        this.env(g, t, 0.001, 0.025 * v, 0.02);
        this.osc('square', 1800 + Math.random() * 400, t, 0.03, g);
        break;
      }
      case 'rift': {
        const g = this.gain(out, 0.9);
        this.env(g, t, 0.3, 0.25 * v, 1.8);
        const lp = this.filter('lowpass', 300, 6);
        lp.frequency.exponentialRampToValueAtTime(2400, t + 1.2);
        lp.connect(g);
        this.osc('sawtooth', 41.2, t, 2.2, lp);
        this.osc('sawtooth', 61.7, t, 2.2, lp).detune.value = 12;
        this.sfxNoise(t, 2, 'highpass', 3000, 0.08 * v, 0.9);
        break;
      }
      case 'whoosh':
        this.sfxNoise(t, 0.6, 'bandpass', 300, 0.22 * v, 0.2, 2400);
        break;
    }
  }

  private taikoSfx(t: number, vol: number): void {
    const g = this.gain(this.sfxBus, 0.5);
    this.env(g, t, 0.003, vol * 0.7, 0.6);
    const o = this.osc('sine', 85, t, 0.6, g);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  }

  private sfxNoise(t: number, dur: number, type: BiquadFilterType, f: number, vol: number, send = 0, sweepTo = 0): void {
    const g = this.gain(this.sfxBus, send);
    this.env(g, t, 0.005, vol, dur);
    const fl = this.filter(type, f, 1.2);
    if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur * 0.8);
    fl.connect(g);
    this.noiseSrc(t, dur, fl);
  }

  dispose(): void {
    window.clearInterval(this.timer);
    void this.ctx?.close();
  }
}
