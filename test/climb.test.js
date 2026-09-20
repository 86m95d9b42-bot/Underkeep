/**
 * The Phase 4 "done when": a new level 1 hero can reach level 5 on floors
 * 1 and 2.
 *
 * `npm run climb` runs this over many heroes; this runs a few of them on
 * every test run, and pins the parts a rule decides: that a rolled hero is
 * playable, that their points are spent, that a careful turn is taken, and
 * that the climb itself arrives.
 */
import { describe, it, expect } from 'vitest';
import { BUILDS, PRIORITIES, chooseTurn, climb, fightOut, rollHero, spendPoints } from '../tools/lib/climber.js';
import { createRun } from '../src/systems/run.js';
import { ORIGIN_ORDER } from '../src/data/origins.js';
import { rankOf, spentTotal, unspent } from '../src/systems/skill-tree.js';
import { LEVELING, modFor } from '../src/data/attributes.js';
import { skill } from '../src/data/skills.js';

describe('the hero the tool rolls', () => {
  it('is made the way a player makes one, and equipped', () => {
    const who = rollHero(7932);
    expect(who.level).toBe(1);
    expect(who.xp).toBe(0);
    expect(who.attack.damage).toBe('1d8 slash');
    expect(who.armor.def).toBe(2);
    expect(who.def).toBe(10 + modFor(who.attributes.agility) + 2);
  });

  it('arranges the roll into what the origin lives on', () => {
    for (const origin of ORIGIN_ORDER) {
      const who = rollHero(7932, { origin });
      const wanted = PRIORITIES[origin];
      const scores = wanted.map((id) => who.attributes[id]);
      // Highest first, down the origin's own list — with the origin's +1
      // landing on the attribute it always lands on.
      const withoutBonus = [...scores];
      withoutBonus[wanted.indexOf(skillAttribute(origin))] -= 1;
      expect([origin, [...withoutBonus].sort((a, b) => b - a)]).toEqual([origin, withoutBonus]);
    }
  });

  it('spends every point it has, down the origin’s build', () => {
    const who = rollHero(7932);
    expect(unspent(who)).toBe(0);
    expect(spentTotal(who)).toBe(LEVELING.skillPointsAtLevel1);
    expect(rankOf(who, BUILDS.sellsword[0])).toBeGreaterThan(0);

    who.skillPoints += 2;
    spendPoints(who);
    expect(unspent(who)).toBe(0);
  });
});

/** The attribute an origin's +1 lands on, for the arrangement test. */
function skillAttribute(origin) {
  return { sellsword: 'might', cutpurse: 'agility', apprentice: 'intellect', pilgrim: 'wits' }[origin];
}

describe('the turn a careful player takes', () => {
  const fightWith = (who) => {
    const run = createRun({ masterSeed: 7932, floor: 1, hero: who });
    return { run, result: () => fightOut(run, { fleeBelow: 0.4 }) };
  };

  it('heals when the wound is deep enough and there is Focus for it', () => {
    const who = rollHero(7932);
    who.skillPoints += 1;
    spendPoints(who);
    if (rankOf(who, 'mend') === 0) return; // this build has not bought it yet
    const fight = { hero: who, legality: (id, o) => ({ legal: o?.skill === 'mend' }) };
    who.hp = Math.floor(who.maxHp * 0.4);
    expect(chooseTurn(fight, 0.3)).toEqual(['skill', { skill: 'mend' }]);
  });

  it('runs when healing will not be enough', () => {
    const who = rollHero(7932);
    who.hp = 1;
    const fight = { hero: who, legality: (id) => ({ legal: id === 'flee' }) };
    expect(chooseTurn(fight, 0.5)).toEqual(['flee', {}]);
  });

  it('swings otherwise', () => {
    const who = rollHero(7932);
    who.hp = who.maxHp;
    const fight = { hero: who, legality: () => ({ legal: false }) };
    expect(chooseTurn(fight, 0.5)).toEqual(['attack', {}]);
  });

  it('fights what the floor turns up, and is paid for winning', () => {
    const who = rollHero(7932);
    const { result } = fightWith(who);
    const fight = result();
    expect(['victory', 'defeat', 'fled']).toContain(fight.outcome);
    expect(fight.monsters.length).toBeGreaterThan(0);
    if (fight.outcome === 'victory') expect(fight.xp).toBeGreaterThan(0);
  });
});

describe('the climb itself', () => {
  it('reaches level 5 on floors 1 and 2, for every origin', () => {
    for (const [index, origin] of ORIGIN_ORDER.entries()) {
      const result = climb((index + 1) * 7919 + 13, { origin });
      expect([origin, result.level]).toEqual([origin, 5]);
      expect([origin, result.why]).toEqual([origin, 'reached']);
      // It was earned in fights on those two floors, not handed over.
      expect([origin, result.xp >= 1000]).toEqual([origin, true]);
      expect([origin, result.fights > 10]).toEqual([origin, true]);
    }
  }, 30000);

  it('keeps the level a dead Adventurer earned, and ends an Ironman climb', () => {
    // `05` section 9: an Adventurer wakes in town having lost half their gold.
    const adventurer = climb(7932, { mode: 'adventurer' });
    expect(adventurer.ok).toBe(true);
    expect(adventurer.deaths).toBeGreaterThanOrEqual(0);

    const ironman = climb(7932, { mode: 'ironman' });
    expect(['reached', 'died', 'out of trips']).toContain(ironman.why);
    if (ironman.why === 'died') expect(ironman.alive).toBe(false);
  }, 30000);
});
