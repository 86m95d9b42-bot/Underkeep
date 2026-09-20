/**
 * The Phase 5 "done when": unknown potions, scrolls and cursed gear behave
 * exactly as `04` describes.
 *
 * `npm run loot` plays a game's worth of loot through the real tables, pack
 * and identification rules and audits every step against the document. This
 * runs a handful of those on every test run, so a rule that breaks is caught
 * here rather than the next time someone remembers to run the tool.
 */
import { describe, it, expect } from 'vitest';
import { bonusLimit, looterHero, playLoot } from '../tools/lib/looter.js';
import { ORIGIN_ORDER } from '../src/data/origins.js';

describe('a game\'s worth of loot (04)', () => {
  it('finds, carries and uses it all without breaking a rule', () => {
    for (const [index, origin] of ORIGIN_ORDER.entries()) {
      const seed = (index + 1) * 7919 + 13;
      const result = playLoot(seed, { rolls: 12, origin });
      expect([origin, result.problems]).toEqual([origin, []]);
      expect(result.counts.drops).toBeGreaterThan(50);
    }
  });

  it('turns up every kind of item the audit is about', () => {
    // One game of 10 floors is enough to meet potions, scrolls, magic gear
    // and curses; if it were not, the audit would be passing on nothing.
    const result = playLoot(4242, { rolls: 40 });
    expect(result.problems).toEqual([]);
    expect(result.counts.potions).toBeGreaterThan(10);
    expect(result.counts.scrolls).toBeGreaterThan(5);
    expect(result.counts.drunk).toBeGreaterThan(10);
    expect(result.counts.magic).toBeGreaterThan(20);
    expect(result.counts.cursed).toBeGreaterThan(0);
    expect(result.counts.worn).toBeGreaterThan(10);
    expect(result.counts.freed).toBe(1);
    expect(result.counts.burned).toBe(1);
  });

  it('holds the floor limits 02 section 17 puts on magic gear', () => {
    expect([1, 2, 3].map(bonusLimit)).toEqual([1, 1, 1]);
    expect([4, 5, 6, 7].map(bonusLimit)).toEqual([2, 2, 2, 2]);
    expect([8, 9, 10].map(bonusLimit)).toEqual([3, 3, 3]);
  });

  it('gives the hero a pack to carry it in', () => {
    const who = looterHero(11);
    expect(who.pack.items.length).toBeGreaterThan(0);
    expect(who.attributes.might).toBeGreaterThanOrEqual(14);
  });
});
