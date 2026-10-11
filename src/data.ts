/** Game content: roster, regions, waves, upgrades and daily modifiers. */

export type TravelerId = 'sable' | 'rook' | 'iona';
export type CharacterId = TravelerId | 'warden';
export type RegionId = 'desert' | 'tidal' | 'highland';
export type PropId =
  | 'travel_chest' | 'luggage' | 'sandstone_barricade' | 'supply_crate'
  | 'route_beacon' | 'expedition_tent' | 'harbor_bollard' | 'barrel'
  | 'solar_charger' | 'portal_arch' | 'coliving_bench' | 'weather_antenna'
  | 'relay_battery' | 'boulder' | 'shrub' | 'slate_debris';

export interface ClassStats {
  name: string;
  title: string;
  role: string;
  blurb: string;
  maxHp: number;
  speed: number;
  /** Strike reach in world px (centre of hit circle ahead of the feet). */
  reach: number;
  /** Hit circle radius. */
  arc: number;
  damage: number;
  /** Base special cooldown, seconds. */
  specialCd: number;
  specialName: string;
  specialText: string;
  accent: string;
}

export const CLASSES: Record<CharacterId, ClassStats> = {
  sable: {
    name: 'Sable',
    title: 'The Courier',
    role: 'Speed · Mobility',
    blurb: 'Never late, never lost. Her compass disc cuts a line and she is already past it.',
    maxHp: 112, speed: 255, reach: 64, arc: 60, damage: 18, specialCd: 5,
    specialName: 'Compass Dash',
    specialText: 'Blink along your heading, slicing every Echo in the path.',
    accent: '#d4a574',
  },
  rook: {
    name: 'Rook',
    title: 'The Cartographer',
    role: 'Reach · Control',
    blurb: 'If it is not on his map, it soon will be. His staff keeps trouble at arm’s length.',
    maxHp: 120, speed: 215, reach: 78, arc: 62, damage: 17, specialCd: 8,
    specialName: 'Route Beacon',
    specialText: 'Plant a beacon that slows and burns Echoes inside its ring.',
    accent: '#e0b54a',
  },
  iona: {
    name: 'Iona',
    title: 'The Tidekeeper',
    role: 'Power · Recovery',
    blurb: 'Harbor engineer. She does not dodge the wave, she sends it.',
    maxHp: 130, speed: 205, reach: 54, arc: 60, damage: 20, specialCd: 10,
    specialName: 'Tide Pulse',
    specialText: 'Detonate a shockwave that hurls Echoes back and mends you.',
    accent: '#3fc1c0',
  },
  warden: {
    name: 'The Gatewarden',
    title: 'Keeper of the Meridian Gate',
    role: 'Boss',
    blurb: 'An automaton older than the map, route-locked by the Rift.',
    maxHp: 2600, speed: 125, reach: 96, arc: 82, damage: 26, specialCd: 6,
    specialName: 'Route Lock',
    specialText: '',
    accent: '#f0a040',
  },
};

export const TRAVELERS: TravelerId[] = ['sable', 'rook', 'iona'];

export interface PropPlacement { id: PropId; x: number; y: number; breakable?: boolean }

export interface WaveSpawn { cls: CharacterId; elite?: boolean }

export interface RegionDef {
  id: RegionId;
  name: string;
  numeral: string;
  tagline: string;
  /** Walkable floor rectangle on the 1254px arena: x0, y0, x1, y1. */
  bounds: [number, number, number, number];
  weather: 'sand' | 'spray' | 'snow';
  /** Tint for the cinematic light pass. */
  light: string;
  props: PropPlacement[];
  waves: WaveSpawn[][];
  /** Where Echoes tear through. */
  gates: [number, number][];
}

const s = (cls: CharacterId, n: number, elite = false): WaveSpawn[] =>
  Array.from({ length: n }, () => ({ cls, elite }));

export const REGIONS: RegionDef[] = [
  {
    id: 'desert',
    name: 'The Desert Relay',
    numeral: 'I',
    tagline: 'Sand-scoured waystation where the first beacon went dark.',
    bounds: [178, 182, 1080, 1012],
    weather: 'sand',
    light: 'rgba(255, 170, 90, 0.10)',
    gates: [[627, 230], [230, 600], [1030, 600], [627, 960]],
    props: [
      { id: 'sandstone_barricade', x: 350, y: 330 },
      { id: 'sandstone_barricade', x: 905, y: 865 },
      { id: 'barrel', x: 905, y: 330, breakable: true },
      { id: 'supply_crate', x: 960, y: 372, breakable: true },
      { id: 'shrub', x: 300, y: 860 },
      { id: 'travel_chest', x: 360, y: 905, breakable: true },
      { id: 'expedition_tent', x: 1000, y: 200 },
      { id: 'solar_charger', x: 250, y: 470 },
      { id: 'luggage', x: 1010, y: 720, breakable: true },
    ],
    waves: [
      [...s('sable', 4)],
      [...s('sable', 3), ...s('rook', 3)],
      [...s('sable', 3), ...s('rook', 2), ...s('iona', 1), { cls: 'iona', elite: true }],
    ],
  },
  {
    id: 'tidal',
    name: 'The Tidal Port',
    numeral: 'II',
    tagline: 'Copper domes, salt spray, and a harbor that remembers every ship.',
    bounds: [222, 186, 1040, 962],
    weather: 'spray',
    light: 'rgba(90, 200, 220, 0.08)',
    gates: [[627, 235], [260, 560], [1000, 560], [627, 930]],
    props: [
      { id: 'harbor_bollard', x: 300, y: 300 },
      { id: 'harbor_bollard', x: 955, y: 300 },
      { id: 'barrel', x: 290, y: 820, breakable: true },
      { id: 'barrel', x: 335, y: 860, breakable: true },
      { id: 'supply_crate', x: 960, y: 820, breakable: true },
      { id: 'luggage', x: 905, y: 870, breakable: true },
      { id: 'coliving_bench', x: 627, y: 215 },
      { id: 'relay_battery', x: 300, y: 560 },
    ],
    waves: [
      [...s('iona', 3), ...s('sable', 3)],
      [...s('rook', 4), ...s('iona', 3)],
      [...s('sable', 4), ...s('iona', 2), { cls: 'rook', elite: true }, { cls: 'sable', elite: true }],
    ],
  },
  {
    id: 'highland',
    name: 'Highland Station',
    numeral: 'III',
    tagline: 'Above the clouds, the Meridian Gate. And the thing that guards it.',
    bounds: [232, 200, 1028, 958],
    weather: 'snow',
    light: 'rgba(170, 200, 255, 0.10)',
    gates: [[627, 250], [270, 580], [985, 580], [627, 920]],
    props: [
      { id: 'boulder', x: 330, y: 320 },
      { id: 'slate_debris', x: 930, y: 860 },
      { id: 'weather_antenna', x: 950, y: 300 },
      { id: 'supply_crate', x: 320, y: 860, breakable: true },
      { id: 'travel_chest', x: 960, y: 560, breakable: true },
      { id: 'shrub', x: 290, y: 700 },
    ],
    waves: [
      [...s('rook', 3), ...s('iona', 3), ...s('sable', 3)],
      [...s('sable', 3), ...s('rook', 3), ...s('iona', 2, true)],
      [{ cls: 'warden' }],
    ],
  },
];

export const regionById = (id: RegionId): RegionDef => REGIONS.find((r) => r.id === id)!;

export interface UpgradeDef {
  id: 'vitality' | 'edge' | 'focus' | 'stride';
  name: string;
  text: string;
  icon: string;
  max: number;
  baseCost: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'vitality', name: 'Vitality', text: '+12% max health', icon: 'medkit', max: 5, baseCost: 40 },
  { id: 'edge', name: 'Edge', text: '+10% strike damage', icon: 'attack', max: 5, baseCost: 50 },
  { id: 'focus', name: 'Focus', text: '−10% special cooldown', icon: 'special', max: 4, baseCost: 60 },
  { id: 'stride', name: 'Stride', text: '+6% speed, −10% dodge cost', icon: 'dash', max: 3, baseCost: 70 },
];

export const upgradeCost = (u: UpgradeDef, level: number): number =>
  Math.round(u.baseCost * Math.pow(1.6, level));

export interface Modifier {
  id: string;
  name: string;
  text: string;
  glyph: string;
}

/** Daily Rift modifiers. Two are drawn per day from the date seed. */
export const MODIFIERS: Modifier[] = [
  { id: 'glass', name: 'Glass Cannon', text: 'Deal and take double damage.', glyph: '🗡️' },
  { id: 'tailwind', name: 'Tailwind', text: 'Everyone moves 25% faster.', glyph: '🌬️' },
  { id: 'swarm', name: 'Swarm', text: 'More Echoes, but they are fragile.', glyph: '🐝' },
  { id: 'overcharge', name: 'Overcharge', text: 'Specials recharge twice as fast.', glyph: '⚡' },
  { id: 'vampiric', name: 'Leech Route', text: 'Kills restore a sliver of health.', glyph: '🩸' },
  { id: 'elite', name: 'Elite Echoes', text: 'Every wave brings an elite.', glyph: '👑' },
  { id: 'perfect', name: 'Knife Edge', text: 'Perfect dodges heal, normal dodges cost double.', glyph: '🎯' },
  { id: 'gold', name: 'Gold Rush', text: 'Coins worth triple. Echoes hit harder.', glyph: '🪙' },
];

export const STYLE_RANKS = [
  { min: 0, letter: 'D', name: 'Drifting' },
  { min: 6, letter: 'C', name: 'Charted' },
  { min: 14, letter: 'B', name: 'Bold' },
  { min: 26, letter: 'A', name: 'Audacious' },
  { min: 42, letter: 'S', name: 'Stormbound' },
  { min: 64, letter: 'SS', name: 'Wayfarer' },
] as const;

export function styleRank(combo: number): (typeof STYLE_RANKS)[number] {
  let r: (typeof STYLE_RANKS)[number] = STYLE_RANKS[0];
  for (const rank of STYLE_RANKS) if (combo >= rank.min) r = rank;
  return r;
}

export const JOURNAL_PROPS: Record<PropId, string> = {
  travel_chest: 'Courier strongbox. Breaks open for route coins.',
  luggage: 'Someone packed for a long trip. Someone is still waiting.',
  sandstone_barricade: 'Relay wall section. Echoes cannot path through it.',
  supply_crate: 'Expedition rations. Crack it for coins and supplies.',
  route_beacon: 'Each lit beacon redraws a stretch of the old map.',
  expedition_tent: 'Field camp for relay crews.',
  harbor_bollard: 'Mooring post. Older than the port around it.',
  barrel: 'Fresh water, mostly. Smash for coins.',
  solar_charger: 'Feeds the relay when the beacons are dark.',
  portal_arch: 'Echoes come through gates like this one.',
  coliving_bench: 'Where travelers trade routes and rumours.',
  weather_antenna: 'Reads the Rift the way sailors read storms.',
  relay_battery: 'Stored charge from a hundred sunrises.',
  boulder: 'Highland granite. Good cover.',
  shrub: 'Stubborn desert growth.',
  slate_debris: 'What is left of the old station roof.',
};
