/**
 * Rolling loot (`04` section 14, `02` section 17).
 *
 * Most of these drive a scripted stream, so a row of a table is checked
 * against the document one die at a time. The rates the document gives as
 * shares — half of rare gear has a property, a curse is 5% then 10% — are
 * measured over a real seeded stream instead.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_CATEGORY_ROLLS,
  canUse,
  chooseBase,
  dropsFrom,
  lootAfterCombat,
  rollCategory,
  rollLoot,
  rollOnTable,
  rollProperty,
} from '../src/systems/loot.js';
import { item, itemOf } from '../src/data/items.js';
import { poolFor } from '../src/data/loot.js';
import { carriedStreams } from '../src/engine/rng.js';

const HERO = {
  attributes: { might: 13, agility: 12, vigor: 12, intellect: 11, wits: 11, luck: 12 },
};

/** A stream that answers exactly what a test needs, in order. */
function stub({ die = [], chance = [], pick = [] } = {}) {
  const dice = [...die];
  const chances = [...chance];
  const picks = [...pick];
  const stream = () => 0.5;
  stream.die = () => (dice.length ? dice.shift() : 1);
  stream.dice = (count, sides) => stream.die(sides) * count;
  stream.roll = () => stream.die();
  stream.d20 = () => stream.die(20);
  stream.int = (n) => stream.die(n) % n;
  stream.range = (min) => min;
  stream.chance = () => (chances.length ? chances.shift() : false);
  stream.pick = (list) => list[(picks.length ? picks.shift() : 0) % list.length];
  stream.shuffle = (list) => [...list];
  return stream;
}

/** The real thing, for the rates. */
const real = (seed = 3) => carriedStreams(seed).loot;

describe('the category roll (02 section 17)', () => {
  it('reads the d100 bands the bestiary prints', () => {
    expect(rollCategory(stub({ die: [1] }))).toMatchObject({ category: null });
    expect(rollCategory(stub({ die: [50] }))).toMatchObject({ category: null });
    expect(rollCategory(stub({ die: [51] }))).toMatchObject({ category: 'common' });
    expect(rollCategory(stub({ die: [76] }))).toMatchObject({ category: 'uncommon' });
    expect(rollCategory(stub({ die: [93] }))).toMatchObject({ category: 'rare' });
    expect(rollCategory(stub({ die: [100] }))).toMatchObject({ category: 'rare', rollAgain: true });
  });

  it('adds five per point of Luck modifier', () => {
    const rolled = rollCategory(stub({ die: [70] }), { luckMod: 2 });
    expect(rolled).toMatchObject({ roll: 70, total: 80, category: 'uncommon' });
    expect(rollCategory(stub({ die: [46] }), { luckMod: 1 }).category).toBe('common');
  });

  it('rolls again on a hundred, and stops chaining eventually', () => {
    // Every roll a 100: the guard is what ends it.
    const endless = {
      die: (sides) => (sides === 100 ? 100 : 1),
      chance: () => false,
      pick: (list) => list[0],
    };
    const { rolls } = rollLoot(endless, { floor: 1, hero: HERO, found: new Set() });
    expect(rolls).toHaveLength(MAX_CATEGORY_ROLLS);
    // And a single roll that does not chain gives one category.
    const once = rollLoot(stub({ die: [60, 1] }), { floor: 1, hero: HERO });
    expect(once.rolls).toHaveLength(1);
    expect(once.drops[0]).toMatchObject({ baseId: 'healing_potion' });
  });

  it('drops nothing at all on gold only', () => {
    expect(rollLoot(stub({ die: [20] }), { floor: 1 }).drops).toEqual([]);
  });
});

describe('the Common table (04 section 14)', () => {
  const common = (die, floor = 1) => rollOnTable(stub({ die }), 'common', { floor, hero: HERO });

  it('gives out the named items with the counts the table prints', () => {
    expect(common([1])[0]).toMatchObject({ baseId: 'healing_potion', count: 1, identified: true });
    expect(common([4])[0]).toMatchObject({ baseId: 'antidote', identified: true });
    expect(common([5])[0]).toMatchObject({ baseId: 'torch', count: 2 });
    expect(common([7])[0]).toMatchObject({ baseId: 'ration', count: 2 });
    expect(common([8])[0]).toMatchObject({ baseId: 'healing_herb' });
    expect(common([10])[0]).toMatchObject({ baseId: 'holy_water' });
  });

  it('gives plain gear on an 11, known and with no magic on it', () => {
    const drop = common([11])[0];
    expect(poolFor('base_gear')).toContain(drop.baseId);
    expect(drop).toMatchObject({ identified: true });
    expect(drop.bonus).toBeUndefined();
    expect(drop.property).toBeUndefined();
  });

  it('caps the gemstone at a Pearl on floors 1 to 3', () => {
    // d100 of 95 on floor 2 is a Ruby, until the Common table caps it.
    expect(common([12, 95], 2)[0]).toMatchObject({ baseId: 'pearl' });
    // Deeper, the same cap is gone: 80 + (4 x 5) is a Ruby.
    expect(common([12, 80], 4)[0]).toMatchObject({ baseId: 'ruby' });
    expect(common([12, 20], 1)[0]).toMatchObject({ baseId: 'quartz' });
  });
});

describe('the Uncommon table (04 section 14)', () => {
  const uncommon = (die, floor = 2, chance = []) =>
    rollOnTable(stub({ die, chance }), 'uncommon', { floor, hero: HERO });

  it('makes +1 gear, unidentified, on the first three rows', () => {
    const weapon = uncommon([1])[0];
    expect(poolFor('base_weapon')).toContain(weapon.baseId);
    expect(weapon).toMatchObject({ bonus: 1, rarity: 'uncommon', identified: false });
    const armor = uncommon([3])[0];
    expect(poolFor('base_armor')).toContain(armor.baseId);
    expect(armor).toMatchObject({ bonus: 1, identified: false });
  });

  it('draws the scrolls, potions, bombs, charms and gear from their own pools', () => {
    expect(poolFor('uncommon_scroll')).toContain(uncommon([4])[0].baseId);
    expect(uncommon([6])[0]).toMatchObject({ baseId: 'focus_tonic', identified: false });
    expect(uncommon([7])[0]).toMatchObject({ baseId: 'greater_healing_potion' });
    expect(poolFor('uncommon_potion')).toContain(uncommon([8])[0].baseId);
    expect(poolFor('uncommon_bomb')).toContain(uncommon([9])[0].baseId);
    expect(poolFor('uncommon_charm')).toContain(uncommon([10])[0].baseId);
    expect(poolFor('uncommon_gear')).toContain(uncommon([11])[0].baseId);
  });

  it('rolls the gemstone with twenty on top', () => {
    // d100 of 60 plus 20, on floor 2: 90 is an Emerald.
    expect(uncommon([12, 60])[0]).toMatchObject({ baseId: 'emerald' });
  });

  it('finds a charm unknown, because a charm is magic', () => {
    const charm = uncommon([10])[0];
    expect(item(charm.baseId).magic).toBe(true);
    expect(charm.identified).toBe(false);
  });
});

describe('the Rare table and Gear Details (04 section 14)', () => {
  /** Rare gear, with the floor's rules and no curse. */
  const rare = (die, floor, chance = [false, false]) =>
    rollOnTable(stub({ die, chance }), 'rare', { floor, hero: HERO, found: new Set() });

  it('makes +1 gear with a property on floors 1 to 3', () => {
    const drop = rare([1], 2)[0];
    expect(drop).toMatchObject({ bonus: 1, identified: false, rarity: 'rare' });
    expect(typeof drop.property).toBe('string');
  });

  it('makes +2 gear on floors 4 to 7', () => {
    // The first `chance` is the 50/50 property roll, answered no.
    expect(rare([4], 5)[0]).toMatchObject({ bonus: 2, rarity: 'rare' });
    expect(rare([4], 5)[0].property).toBeUndefined();
  });

  it('raises a +2 to a +3 on a d6 of 5 or 6, on floors 8 and below the deep', () => {
    // The d6 comes first, then the property roll.
    expect(rare([1, 5], 8)[0]).toMatchObject({ bonus: 3 });
    expect(rare([1, 6], 9)[0]).toMatchObject({ bonus: 3 });
    expect(rare([1, 4], 9)[0]).toMatchObject({ bonus: 2 });
  });

  it('gives the middle rows their own pools', () => {
    expect(poolFor('rare_charm')).toContain(rare([6], 5)[0].baseId);
    expect(poolFor('rare_potion')).toContain(rare([7], 5)[0].baseId);
    expect(poolFor('rare_scroll')).toContain(rare([8], 5)[0].baseId);
  });

  it('makes +1 gear with a property on a 9 or 10, whatever the floor', () => {
    const drop = rare([9], 6)[0];
    expect(drop).toMatchObject({ bonus: 1 });
    expect(typeof drop.property).toBe('string');
  });

  it('gives a key or the masterwork picks on an 11', () => {
    expect(rare([11], 5)[0]).toMatchObject({ baseId: 'skeleton_key', identified: true });
    const other = rollOnTable(stub({ die: [11], pick: [1] }), 'rare', { floor: 5 });
    expect(other[0]).toMatchObject({ baseId: 'masterwork_lockpicks' });
  });
});

describe('legendary finds (04 section 13)', () => {
  it('only appears from floor 8, and falls back to rare gear below it', () => {
    const shallow = rollOnTable(stub({ die: [12] }), 'rare', { floor: 5, hero: HERO, found: new Set() });
    expect(shallow[0].baseId).not.toBe('whisper');
    expect(poolFor('base_weapon')).toContain(shallow[0].baseId);
    expect(typeof shallow[0].property).toBe('string');

    const deep = rollOnTable(stub({ die: [12] }), 'rare', { floor: 8, hero: HERO, found: new Set() });
    expect(poolFor('legendary')).toContain(deep[0].baseId);
    expect(deep[0]).toMatchObject({ rarity: 'unique', identified: false });
  });

  it('is taken out of the pool once it is found', () => {
    const found = new Set();
    const seen = new Set();
    for (let i = 0; i < 6; i += 1) {
      const drop = rollOnTable(stub({ die: [12], pick: [i] }), 'rare', { floor: 9, hero: HERO, found })[0];
      expect(seen.has(drop.baseId)).toBe(false);
      seen.add(drop.baseId);
    }
    expect(found.size).toBe(6);
    // With every one found, the row falls back to rare gear.
    const after = rollOnTable(stub({ die: [12] }), 'rare', { floor: 9, hero: HERO, found })[0];
    expect(poolFor('legendary')).not.toContain(after.baseId);
  });

  it('carries its own bonus rather than rolling one', () => {
    const found = new Set();
    const drop = rollOnTable(stub({ die: [12] }), 'rare', { floor: 8, hero: HERO, found })[0];
    expect(drop.bonus).toBeUndefined();
    expect(itemOf(drop.baseId).bonus ?? null).not.toBe(null);
  });
});

describe('properties (04 section 4)', () => {
  it('rolls a weapon property on a d12 and an armour one on a d10', () => {
    expect(rollProperty(stub({ die: [1] }), 'long_sword')).toBe('flaming');
    expect(rollProperty(stub({ die: [9] }), 'long_sword')).toBe('mighty');
    expect(rollProperty(stub({ die: [3] }), 'plate')).toBe('fortified');
    expect(rollProperty(stub({ die: [10] }), 'shield')).toBe('dauntless');
  });

  it('sends a melee weapon back round when it rolls Seeking', () => {
    expect(rollProperty(stub({ die: [11, 11, 6] }), 'long_sword')).toBe('vampiric');
    // A bow keeps it: that is what Seeking is for.
    expect(rollProperty(stub({ die: [11] }), 'longbow')).toBe('seeking');
  });

  it('puts a property on about half of rare gear', () => {
    const rng = real(11);
    let withProperty = 0;
    const tries = 400;
    for (let i = 0; i < tries; i += 1) {
      // Floors 4-7 give a flat +2, so the only property is the 50/50 one.
      const drop = rollOnTable(rng, 'rare', { floor: 5, hero: HERO, found: new Set() });
      if (drop[0]?.bonus === 2 && drop[0]?.property) withProperty += 1;
    }
    // Rows 1-5 are the +2 rows: roughly 5/12 of the rolls, half with a property.
    expect(withProperty).toBeGreaterThan(tries * 0.12);
    expect(withProperty).toBeLessThan(tries * 0.3);
  });
});

describe('curses (04 section 6)', () => {
  it('turns the bonus negative and keeps a property half the time', () => {
    // d12 row 1, the +2 floor, then: property no, cursed yes, curse d8 = 1,
    // the -1/-2 pick, and the "half also carry a property" roll.
    const cursed = rollOnTable(
      stub({ die: [1, 1], chance: [false, true, true], pick: [0] }),
      'rare',
      { floor: 5, hero: HERO, found: new Set() },
    );
    expect(cursed[0]).toMatchObject({
      bonus: -1,
      curse: 'leaden',
      rarity: 'cursed',
      identified: false,
    });
    expect(typeof cursed[0].property).toBe('string');
  });

  it('can take the second of the two bonuses', () => {
    const cursed = rollOnTable(
      // The first pick is the base type; the second is which of -1 and -2.
      stub({ die: [1, 4], chance: [false, true, false], pick: [0, 1] }),
      'rare',
      { floor: 5, hero: HERO, found: new Set() },
    )[0];
    expect(cursed).toMatchObject({ bonus: -2, curse: 'clumsy' });
    expect(cursed.property).toBeUndefined();
  });

  it('curses a charm without giving it a bonus or a property', () => {
    const charm = rollOnTable(
      stub({ die: [10, 3], chance: [true, true] }),
      'uncommon',
      { floor: 4, hero: HERO },
    )[0];
    expect(charm).toMatchObject({ curse: 'beacon', rarity: 'cursed' });
    expect(charm.bonus).toBeUndefined();
    expect(charm.property).toBeUndefined();
  });

  it('curses one item in twenty on floors 1-2 and one in ten below', () => {
    const count = (floor, seed) => {
      const rng = real(seed);
      let cursed = 0;
      for (let i = 0; i < 600; i += 1) {
        const drops = rollOnTable(rng, 'uncommon', { floor, hero: HERO });
        if (drops[0]?.curse) cursed += 1;
      }
      return cursed;
    };
    // Only the magic rows can be cursed: roughly half of the table.
    expect(count(1, 21)).toBeLessThan(count(6, 21));
    expect(count(2, 33)).toBeLessThan(40);
  });
});

describe('what the hero can use (Gear Details 1)', () => {
  it('rerolls once when the hero cannot meet the requirement', () => {
    const weak = { attributes: { might: 8, agility: 8, vigor: 10, intellect: 10, wits: 10, luck: 10 } };
    // Great Sword needs MIG 13; the reroll lands on the club.
    const pool = ['great_sword', 'club'];
    expect(chooseBase(stub({ pick: [0, 1] }), pool, weak)).toBe('club');
    // A hero who meets it keeps what they rolled.
    expect(chooseBase(stub({ pick: [0, 1] }), pool, HERO)).toBe('great_sword');
    // And the reroll is only ever one: a second miss is kept.
    expect(chooseBase(stub({ pick: [0, 0] }), pool, weak)).toBe('great_sword');
  });

  it('knows which items a hero meets the requirement for', () => {
    expect(canUse('long_sword', HERO)).toBe(true);
    expect(canUse('great_sword', HERO)).toBe(true);
    expect(canUse('plate', { attributes: { might: 12 } })).toBe(false);
    expect(canUse('plate', null)).toBe(true);
  });
});

describe('identification state (04 section 5)', () => {
  it('finds every potion and scroll unknown, except the two that never are', () => {
    const rng = real(5);
    for (let i = 0; i < 200; i += 1) {
      for (const drop of rollOnTable(rng, 'uncommon', { floor: 3, hero: HERO })) {
        const entry = item(drop.baseId);
        if (['potion', 'scroll'].includes(entry.category)) {
          expect([drop.baseId, drop.identified]).toEqual([drop.baseId, Boolean(entry.alwaysKnown)]);
        }
      }
    }
    expect(rollOnTable(stub({ die: [1] }), 'common', { floor: 1 })[0]).toMatchObject({
      baseId: 'healing_potion',
      identified: true,
    });
  });

  it('finds magic gear unknown and plain gear known', () => {
    const magic = rollOnTable(stub({ die: [1] }), 'uncommon', { floor: 1, hero: HERO })[0];
    expect(magic).toMatchObject({ bonus: 1, identified: false });
    const plain = rollOnTable(stub({ die: [11] }), 'common', { floor: 1, hero: HERO })[0];
    expect(plain.identified).toBe(true);
  });

  it('records the floor an item was found on, but not on a gemstone', () => {
    expect(rollOnTable(stub({ die: [1] }), 'uncommon', { floor: 6, hero: HERO })[0].foundOnFloor).toBe(6);
    expect(rollOnTable(stub({ die: [12, 50] }), 'common', { floor: 6 })[0].foundOnFloor).toBeUndefined();
  });
});

describe("a monster's own drops (02)", () => {
  it('drops what the stat block lists, when the chance comes up', () => {
    const unit = { drops: [{ item: 'rat_tail', chance: 0.25 }] };
    expect(dropsFrom(unit, stub({ chance: [true] }), { floor: 1 })[0]).toMatchObject({
      baseId: 'rat_tail',
      count: 1,
    });
    expect(dropsFrom(unit, stub({ chance: [false] }), { floor: 1 })).toEqual([]);
    expect(dropsFrom({}, stub(), {})).toEqual([]);
  });

  it("rolls on a table when the line names a category, which is the Coin Imp's", () => {
    const imp = { drops: [{ item: 'uncommon', chance: 0.25 }] };
    const drops = dropsFrom(imp, stub({ chance: [true], die: [7] }), { floor: 3, hero: HERO });
    expect(drops[0]).toMatchObject({ baseId: 'greater_healing_potion' });
  });
});

describe('the same seed drops the same things', () => {
  it('is reproducible, which is what the save promises (05 section 11)', () => {
    const once = rollLoot(real(99), { floor: 6, hero: HERO, luckMod: 1, found: new Set() });
    const twice = rollLoot(real(99), { floor: 6, hero: HERO, luckMod: 1, found: new Set() });
    expect(twice).toEqual(once);
  });
});

describe('what a finished fight leaves behind', () => {
  it('takes each monster\'s drops first, then the encounter\'s own roll', () => {
    const rat = { drops: [{ item: 'rat_tail', chance: 0.25 }] };
    // Two monsters drop, then the table rolls a 60 for Common and a 1.
    const rng = stub({ chance: [true, true], die: [60, 1] });
    const { drops, rolls } = lootAfterCombat(rng, [rat, rat], { floor: 1, hero: HERO });
    expect(drops.map((drop) => drop.baseId)).toEqual(['rat_tail', 'rat_tail', 'healing_potion']);
    expect(rolls).toHaveLength(1);
  });

  it("reads the Luck modifier off the hero when it is not given", () => {
    const lucky = { ...HERO, mods: { luck: 2 } };
    // A d100 of 74 is Common on its own, and Uncommon with +10.
    expect(rollLoot(stub({ die: [74, 6] }), { floor: 1, hero: lucky }).drops[0]).toMatchObject({
      baseId: 'focus_tonic',
    });
    expect(rollLoot(stub({ die: [74, 1] }), { floor: 1, hero: HERO }).drops[0]).toMatchObject({
      baseId: 'healing_potion',
    });
  });
});

describe('across every floor and every row', () => {
  it('always drops a real item, and never past the floor\'s bonus limit', () => {
    // 02 section 17: +1 gear only on floors 1-3, +2 on floors 4-7, +3 on 8+.
    const limit = (floor) => (floor <= 3 ? 1 : floor <= 7 ? 2 : 3);
    for (let floor = 1; floor <= 10; floor += 1) {
      const rng = real(100 + floor);
      const found = new Set();
      for (let i = 0; i < 300; i += 1) {
        for (const category of ['common', 'uncommon', 'rare']) {
          for (const drop of rollOnTable(rng, category, { floor, hero: HERO, found })) {
            expect([floor, drop.baseId, Boolean(item(drop.baseId))]).toEqual([
              floor,
              drop.baseId,
              true,
            ]);
            expect(drop.count).toBeGreaterThanOrEqual(1);
            if (drop.bonus > 0) {
              expect([floor, drop.baseId, drop.bonus <= limit(floor)]).toEqual([
                floor,
                drop.baseId,
                true,
              ]);
            }
            // A property only ever belongs to a weapon, armour or shield.
            if (drop.property) {
              expect(['weapon', 'armor', 'shield']).toContain(item(drop.baseId).category);
            }
            // And a cursed item is never a plain one.
            if (drop.curse) expect(drop.identified).toBe(false);
          }
        }
      }
    }
  });
});
