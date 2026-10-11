/**
 * Shareable results: a spoiler-free emoji strip (one square per wave), a
 * rendered 1080×1080 card, and challenge links that replay the same seed.
 */
import { catalog, type Images } from './assets';
import { CLASSES, MODIFIERS, regionById, type RegionId, type TravelerId } from './data';

export interface RunSummary {
  mode: 'daily' | 'trial' | 'campaign';
  day?: number;
  region: RegionId;
  traveler: TravelerId;
  score: number;
  wave: number;
  maxCombo: number;
  perfects: number;
  kills: number;
  rank: string;
  modifiers: string[];
  /** One char per wave: c = clean, h = hit, x = fell. */
  waves: string;
  seed: number;
}

export const SITE = 'https://wayfarer-drift.vercel.app';

export function strip(waves: string): string {
  return [...waves].map((c) => (c === 'c' ? '🟩' : c === 'h' ? '🟨' : '🟥')).join('');
}

export function challengeUrl(s: RunSummary): string {
  const u = new URL(SITE);
  u.searchParams.set('rift', `${s.seed.toString(36)}.${s.region}.${s.traveler}`);
  u.searchParams.set('beat', String(s.score));
  return u.toString();
}

export function shareText(s: RunSummary): string {
  const mods = s.modifiers.map((id) => MODIFIERS.find((m) => m.id === id)).filter(Boolean)
    .map((m) => `${m!.glyph} ${m!.name}`).join(' · ');
  const head = s.mode === 'daily'
    ? `WAYFARER // RIFT — Daily Rift #${s.day} 🧭`
    : `WAYFARER // RIFT — ${regionById(s.region).name} 🧭`;
  return [
    head,
    `${CLASSES[s.traveler].name}${mods ? ` · ${mods}` : ''}`,
    `🏆 ${s.score.toLocaleString('en-US')} · Wave ${s.wave} · Rank ${s.rank}`,
    strip(s.waves),
    `Max combo ${s.maxCombo} · ${s.perfects} perfect dodge${s.perfects === 1 ? '' : 's'}`,
    s.mode === 'daily' ? `Can you out-drift me? ${SITE}` : `Beat my run: ${challengeUrl(s)}`,
  ].join('\n');
}

export function renderCard(s: RunSummary, images: Images): HTMLCanvasElement {
  const S = 1080;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // Frame the travelers below the painted logo; the card sets its own type.
  const t = images.title;
  const sc = (S * 1.5) / t.naturalHeight;
  g.drawImage(t, (S - t.naturalWidth * sc) / 2 + 40, S - t.naturalHeight * sc, t.naturalWidth * sc, t.naturalHeight * sc);
  const shade = g.createLinearGradient(0, 0, 0, S);
  shade.addColorStop(0, 'rgba(6, 9, 14, 0.35)');
  shade.addColorStop(0.45, 'rgba(6, 9, 14, 0.75)');
  shade.addColorStop(1, 'rgba(6, 9, 14, 0.96)');
  g.fillStyle = shade;
  g.fillRect(0, 0, S, S);

  g.textAlign = 'center';
  g.fillStyle = '#d4a574';
  g.font = '700 30px Cinzel, Georgia, serif';
  g.fillText(s.mode === 'daily' ? `DAILY RIFT  #${s.day}` : regionById(s.region).name.toUpperCase(), S / 2, 92);
  g.fillStyle = '#f6e7c8';
  g.font = '900 86px Cinzel, Georgia, serif';
  g.fillText('WAYFARER', S / 2, 190);
  g.font = '700 34px Cinzel, Georgia, serif';
  g.fillStyle = '#3fc1c0';
  g.fillText('//  RIFT  //', S / 2, 238);

  // Traveler sprite, big.
  const sheet = catalog.characters[s.traveler];
  const a = sheet.anims.special;
  const k = 2.1;
  g.drawImage(images.chars[s.traveler], (a.start + 3) * sheet.frameW, a.row * sheet.frameH, sheet.frameW, sheet.frameH,
    S / 2 - 250 - sheet.pivotX * k, 690 - sheet.pivotY * k, sheet.frameW * k, sheet.frameH * k);

  // Rank medallion.
  g.save();
  g.translate(S / 2 + 210, 520);
  const ring = g.createRadialGradient(0, 0, 40, 0, 0, 170);
  ring.addColorStop(0, 'rgba(146, 64, 14, 0.9)');
  ring.addColorStop(1, 'rgba(146, 64, 14, 0)');
  g.fillStyle = ring;
  g.beginPath(); g.arc(0, 0, 170, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d4a574';
  g.lineWidth = 6;
  g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffd166';
  g.font = `900 ${s.rank.length > 1 ? 120 : 160}px Cinzel, Georgia, serif`;
  g.textBaseline = 'middle';
  g.fillText(s.rank, 0, 10);
  g.restore();
  g.textBaseline = 'alphabetic';

  g.fillStyle = '#f6e7c8';
  g.font = '900 96px Cinzel, Georgia, serif';
  g.fillText(s.score.toLocaleString('en-US'), S / 2, 800);
  g.font = '600 30px system-ui, sans-serif';
  g.fillStyle = '#c9b48f';
  g.fillText(`${CLASSES[s.traveler].name} · Wave ${s.wave} · Combo ${s.maxCombo} · ${s.perfects} perfect`, S / 2, 852);

  // Wave strip, drawn (emoji fonts vary across platforms).
  const n = s.waves.length;
  const box = Math.min(52, 900 / Math.max(1, n));
  const x0 = S / 2 - (n * box) / 2;
  [...s.waves].forEach((ch, i) => {
    g.fillStyle = ch === 'c' ? '#3fbf7f' : ch === 'h' ? '#e8b931' : '#d9483b';
    g.fillRect(x0 + i * box + 3, 890, box - 6, box - 6);
  });
  const mods = s.modifiers.map((id) => MODIFIERS.find((m) => m.id === id)?.name).filter(Boolean).join('  ·  ');
  if (mods) {
    g.fillStyle = '#7ff3ee';
    g.font = '600 28px system-ui, sans-serif';
    g.fillText(mods, S / 2, 990);
  }
  g.fillStyle = '#8c7a5c';
  g.font = '600 24px system-ui, sans-serif';
  g.fillText(SITE.replace('https://', ''), S / 2, 1046);
  return c;
}

/** Native share sheet when available, else clipboard + download. */
export async function shareRun(s: RunSummary, images: Images): Promise<'shared' | 'copied' | 'failed'> {
  const text = shareText(s);
  const canvas = renderCard(s, images);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  const file = blob ? new File([blob], 'wayfarer-rift.png', { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file], text })) {
      await navigator.share({ files: [file], text });
      return 'shared';
    }
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(text);
    if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wayfarer-rift.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function parseChallenge(search: string): { seed: number; region: RegionId; traveler: TravelerId; beat: number } | null {
  const q = new URLSearchParams(search);
  const rift = q.get('rift');
  if (!rift) return null;
  const [seedText, region, traveler] = rift.split('.');
  const seed = parseInt(seedText, 36);
  if (!Number.isFinite(seed) || !['desert', 'tidal', 'highland'].includes(region) || !['sable', 'rook', 'iona'].includes(traveler)) return null;
  const beat = Math.max(0, parseInt(q.get('beat') ?? '0', 10) || 0);
  return { seed, region: region as RegionId, traveler: traveler as TravelerId, beat };
}
