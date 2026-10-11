/** Typed access to the generated catalog and image loading with progress. */
import catalogJson from '../public/assets/catalog.json';
import type { CharacterId, PropId, RegionId } from './data';

export interface AnimDef { row: number; start: number; count: number; fps: number; loop: boolean }
export interface CharSheet {
  image: string;
  rift: string | null;
  frameW: number; frameH: number;
  pivotX: number; pivotY: number;
  standHeight: number;
  anims: Record<string, AnimDef>;
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface PropFrame extends Rect { pivotX: number; pivotY: number; radius: number; src: string }
export interface Catalog {
  characters: Record<CharacterId, CharSheet>;
  props: { image: string; frames: Record<PropId, PropFrame> };
  fx: { image: string; rows: Record<string, { w: number; h: number; count: number }>; frames: Record<string, Rect> };
  ui: Record<string, { src: string; w: number; h: number }>;
  backgrounds: Record<RegionId, { src: string; thumb: string; size: number }> & {
    title: { src: string; small: string; w: number; h: number };
  };
}

export const catalog = catalogJson as unknown as Catalog;

export interface Images {
  chars: Record<CharacterId, HTMLImageElement>;
  rift: Partial<Record<CharacterId, HTMLImageElement>>;
  props: HTMLImageElement;
  fx: HTMLImageElement;
  arenas: Record<RegionId, HTMLImageElement>;
  title: HTMLImageElement;
}

const base = import.meta.env.BASE_URL;
export const url = (path: string): string => `${base}${path}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = url(src);
  });
}

export async function loadImages(onProgress: (f: number) => void): Promise<Images> {
  const c = catalog;
  const jobs: [string, string][] = [];
  const ids: CharacterId[] = ['sable', 'rook', 'iona', 'warden'];
  for (const id of ids) {
    jobs.push([`char:${id}`, c.characters[id].image]);
    const rift = c.characters[id].rift;
    if (rift) jobs.push([`rift:${id}`, rift]);
  }
  jobs.push(['props', c.props.image], ['fx', c.fx.image], ['title', c.backgrounds.title.src]);
  for (const r of ['desert', 'tidal', 'highland'] as RegionId[]) jobs.push([`arena:${r}`, c.backgrounds[r].src]);

  let done = 0;
  const loaded = await Promise.all(
    jobs.map(async ([key, src]) => {
      const img = await loadImage(src);
      done++;
      onProgress(done / jobs.length);
      return [key, img] as const;
    }),
  );
  const map = new Map(loaded);
  const get = (k: string) => map.get(k)!;
  return {
    chars: { sable: get('char:sable'), rook: get('char:rook'), iona: get('char:iona'), warden: get('char:warden') },
    rift: { sable: get('rift:sable'), rook: get('rift:rook'), iona: get('rift:iona') },
    props: get('props'),
    fx: get('fx'),
    title: get('title'),
    arenas: { desert: get('arena:desert'), tidal: get('arena:tidal'), highland: get('arena:highland') },
  };
}

/** Frame index for an animation at time t (seconds). */
export function animFrame(a: AnimDef, t: number, speed = 1): number {
  const f = Math.floor(t * a.fps * speed);
  return a.loop ? f % a.count : Math.min(a.count - 1, f);
}
