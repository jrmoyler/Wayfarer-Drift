import { describe, expect, it } from 'vitest';
import { styleRank, upgradeCost, UPGRADES } from '../src/data';
import { Rng, dayKey, hashString } from '../src/rng';
import { defaults, validate } from '../src/save';
import { challengeUrl, parseChallenge, shareText, strip, type RunSummary } from '../src/share';

const run: RunSummary = {
  mode: 'daily', day: 11, region: 'tidal', traveler: 'iona', score: 48210, wave: 9, maxCombo: 63,
  perfects: 4, kills: 51, rank: 'S', modifiers: ['glass', 'tailwind'], waves: 'cchcchhcx', seed: 987654,
};

describe('save validation', () => {
  it('falls back to defaults on garbage', () => {
    expect(validate(null)).toEqual(defaults());
    expect(validate('nope')).toEqual(defaults());
  });

  it('clamps and sanitises fields', () => {
    const v = validate({
      coins: -50, upgrades: { vitality: 99, edge: 'x' }, campaign: { traveler: 'hacker', region: 9, active: true },
      settings: { master: 7, shake: -1, assist: 'yes' }, daily: { 'bad-key': {}, '2026-10-11': { first: { traveler: 'rook', score: 10 }, best: { traveler: 'rook', score: 12 } } },
    });
    expect(v.coins).toBe(0);
    expect(v.upgrades.vitality).toBe(5);
    expect(v.upgrades.edge).toBe(0);
    expect(v.campaign.traveler).toBeNull();
    expect(v.campaign.active).toBe(false);
    expect(v.settings.master).toBe(1);
    expect(v.settings.shake).toBe(0);
    expect(v.settings.assist).toBe(false);
    expect(Object.keys(v.daily)).toEqual(['2026-10-11']);
  });
});

describe('daily seeding', () => {
  it('is stable for a given day', () => {
    const a = new Rng(hashString('daily:2026-10-11'));
    const b = new Rng(hashString('daily:2026-10-11'));
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    expect(dayKey(new Date(2026, 9, 11))).toBe('2026-10-11');
  });
});

describe('sharing', () => {
  it('renders a spoiler-free wave strip', () => {
    expect(strip('chx')).toBe('🟩🟨🟥');
  });

  it('produces share text with score, rank and modifiers', () => {
    const t = shareText(run);
    expect(t).toContain('Daily Rift #11');
    expect(t).toContain('48,210');
    expect(t).toContain('Rank S');
    expect(t).toContain('Glass Cannon');
  });

  it('round-trips challenge links', () => {
    const u = new URL(challengeUrl({ ...run, mode: 'trial' }));
    const c = parseChallenge(u.search);
    expect(c).toEqual({ seed: 987654, region: 'tidal', traveler: 'iona', beat: 48210 });
    expect(parseChallenge('?rift=zz.moon.bob')).toBeNull();
  });
});

describe('progression', () => {
  it('ranks style by combo and escalates upgrade costs', () => {
    expect(styleRank(0).letter).toBe('D');
    expect(styleRank(30).letter).toBe('A');
    expect(styleRank(100).letter).toBe('SS');
    const u = UPGRADES[0];
    expect(upgradeCost(u, 1)).toBeGreaterThan(upgradeCost(u, 0));
  });
});
