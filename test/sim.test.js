/**
 * The balance simulator's heroes and pilot (`tools/sim.js`).
 *
 * The win rates are what `npm run sim` is for; this pins the parts a rule
 * decides: that every example build is legal at every floor's level, that it
 * holds what `04` lets it hold, and that the pilot plays a fight to the end
 * using the skills it has.
 */
import { describe, it, expect } from 'vitest';
import { BUILDS, EXPECTED_LEVEL, buildHero, buildIds, shopTier } from '../tools/lib/builds.js';
import { fightBoss } from '../tools/lib/simulator.js';
import { rankOf, spentTotal, unspent } from '../src/systems/skill-tree.js';
import { item } from '../src/data/items.js';

describe('the four example builds', () => {
  it('spend every point, and no more, at every floor', () => {
    for (const id of buildIds()) {
      for (let floor = 1; floor <= 10; floor += 1) {
        const hero = buildHero(id, { floor });
        expect(hero.level).toBe(EXPECTED_LEVEL[floor]);
        expect(unspent(hero)).toBe(0);
        expect(spentTotal(hero)).toBe(hero.skillPoints);
        expect(hero.attributePoints ?? 0).toBe(0);
      }
    }
  });

  it('reach their capstone Crossroads skill by level 18', () => {
    const capstone = { pure_warrior: 'crusader', battle_mage: 'spellblade', assassin: 'arcane_trickster', wanderer: 'ranger' };
    for (const [id, skillId] of Object.entries(capstone)) {
      // The Assassin's lands last in its order, so it waits for level 20.
      const hero = buildHero(id, { level: id === 'assassin' ? 20 : 18 });
      expect(rankOf(hero, skillId)).toBe(1);
    }
  });

  it('hold a weapon of their own list, and only a shield off-hand (`04` section 1)', () => {
    for (const id of buildIds()) {
      for (let floor = 1; floor <= 10; floor += 1) {
        const hero = buildHero(id, { floor });
        const weapon = hero.pack.items.find((entry) => entry.instanceId === hero.pack.equipped.weapon);
        expect(BUILDS[id].weapons).toContain(weapon.baseId);
        const off = hero.pack.equipped.offHand;
        if (off) {
          const entry = hero.pack.items.find((e) => e.instanceId === off);
          expect(item(entry.baseId).category).toBe('shield');
        }
      }
    }
  });

  it('shop one tier deeper for every second boss (`04` section 15)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(shopTier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('the pilot', () => {
  it('plays a boss fight to an outcome', () => {
    const played = fightBoss('pure_warrior', 1, 7920);
    expect(['victory', 'defeat']).toContain(played.outcome);
    expect(played.did.attack).toBeGreaterThan(0);
  });

  it('casts what a caster knows', () => {
    const played = fightBoss('battle_mage', 5, 7924);
    expect(played.did.skill).toBeGreaterThan(0);
  });
});
