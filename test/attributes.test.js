/**
 * The six attributes, the modifier table, and the XP curve
 * (`01` sections 3, 4 and 5).
 *
 * Every number here is read off the document's own tables: the modifier for
 * each band, the XP to reach each listed level, and what the four origins
 * grant. Nothing is computed twice — where the document gives a worked figure,
 * the test uses the figure.
 */
import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTE_ORDER,
  CREATION,
  DERIVED,
  LEVELING,
  MAX_AT_CREATION,
  MAX_SCORE,
  MIN_SCORE,
  abbr,
  attribute,
  wordsFor,
  givesAttributePoint,
  levelForXp,
  modFor,
  modOf,
  modsFor,
  xpFor,
  xpForLevel,
} from '../src/data/attributes.js';
import {
  ORIGIN_ORDER,
  grantsOf,
  kitItemIds,
  origin,
  originList,
  withOrigin,
} from '../src/data/origins.js';

describe('the six attributes (01 section 3)', () => {
  it('are the ones the document lists, in its order', () => {
    expect(ATTRIBUTE_ORDER).toEqual(['might', 'agility', 'vigor', 'intellect', 'wits', 'luck']);
    expect(ATTRIBUTE_ORDER.map(abbr)).toEqual(['MIG', 'AGI', 'VIG', 'INT', 'WIT', 'LCK']);
  });

  it('are found by name or by abbreviation, and nothing else', () => {
    expect(attribute('might').abbr).toBe('MIG');
    expect(attribute('LCK')).toBeTruthy();
    expect(() => attribute('charm')).toThrow(/unknown attribute/);
  });

  it('keep the words a player reads in strings.json', () => {
    expect(wordsFor('MIG')).toEqual({
      id: 'might',
      abbr: 'MIG',
      name: 'MIGHT',
      governs: expect.stringContaining('Melee'),
    });
    expect(wordsFor('luck').governs).toContain('Critical range');
  });

  it('are scored 3 to 20, and creation rolls no higher than 18', () => {
    expect([MIN_SCORE, MAX_SCORE, MAX_AT_CREATION]).toEqual([3, 20, 18]);
  });
});

describe('the modifier table (01 section 3)', () => {
  it('gives the document’s modifier for every band', () => {
    // | 3 | 4–5 | 6–8 | 9–12 | 13–15 | 16–17 | 18–19 | 20 |
    // | −3 | −2 | −1 |  0  |  +1  |  +2  |  +3  | +4 |
    const table = [
      [3, -3],
      [4, -2], [5, -2],
      [6, -1], [7, -1], [8, -1],
      [9, 0], [10, 0], [11, 0], [12, 0],
      [13, 1], [14, 1], [15, 1],
      [16, 2], [17, 2],
      [18, 3], [19, 3],
      [20, 4],
    ];
    for (const [score, mod] of table) expect([score, modFor(score)]).toEqual([score, mod]);
  });

  it('covers every score from 3 to 20 with no gap', () => {
    for (let score = MIN_SCORE; score <= MAX_SCORE; score += 1) {
      expect(Number.isInteger(modFor(score))).toBe(true);
    }
  });

  it('clamps anything outside the range rather than answering nothing', () => {
    expect(modFor(0)).toBe(modFor(3));
    expect(modFor(99)).toBe(modFor(20));
    expect(modFor(undefined)).toBe(modFor(3));
  });

  it('reads a whole set of scores at once, and one off a unit', () => {
    const scores = { might: 16, agility: 9, vigor: 13, intellect: 5, wits: 20, luck: 3 };
    expect(modsFor(scores)).toEqual({
      might: 2,
      agility: 0,
      vigor: 1,
      intellect: -2,
      wits: 4,
      luck: -3,
    });
    expect(modOf({ attributes: scores }, 'might')).toBe(2);
  });
});

describe('character creation (01 section 3)', () => {
  it('offers the two modes the document describes', () => {
    expect(CREATION.modes.classic).toMatchObject({ roll: '3d6', inOrder: true, rearrange: false });
    expect(CREATION.modes.standard).toMatchObject({
      roll: '4d6',
      dropLowest: 1,
      rearrange: true,
    });
    expect(CREATION.modes[CREATION.default]).toBeTruthy();
  });
});

describe('the derived statistics (01 section 4)', () => {
  it('keeps every formula as data, naming real attributes', () => {
    expect(DERIVED.hp).toMatchObject({ base: 10, baseScore: 'vigor' });
    expect(DERIVED.hp.perLevel).toMatchObject({ dice: '1d6', mod: 'vigor', minimum: 2 });
    expect(DERIVED.fp).toMatchObject({ base: 4, perLevel: 1, minimum: 2 });
    expect(DERIVED.fp.mods).toEqual(['intellect', 'wits']);
    expect(DERIVED.defense).toMatchObject({ base: 10, mod: 'agility' });
    expect(DERIVED.attack).toEqual({
      _source: expect.any(String),
      melee: 'might',
      ranged: 'agility',
      spell: 'intellect',
    });
    expect(DERIVED.saves.types).toEqual({ body: 'vigor', reflex: 'agility', mind: 'wits' });
    expect(DERIVED.critRange).toMatchObject({ natural: 20, wideFromMod: 2, wideNatural: 19 });
    expect(DERIVED.inventorySlots).toMatchObject({ base: 10, mod: 'might', perMod: 2 });
  });
});

describe('the XP curve (01 section 5)', () => {
  it('matches the table the document prints', () => {
    // | Level | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 15 | 20 |
    // | Total | 100 | 300 | 600 | 1,000 | 1,500 | 2,800 | 4,500 | 6,600 | 10,500 | 19,000 |
    const table = [
      [2, 100],
      [3, 300],
      [4, 600],
      [5, 1000],
      [6, 1500],
      [8, 2800],
      [10, 4500],
      [12, 6600],
      [15, 10500],
      [20, 19000],
    ];
    for (const [level, xp] of table) expect([level, xpForLevel(level)]).toEqual([level, xp]);
    expect(xpForLevel(1)).toBe(0);
  });

  it('reads a level back out of a total, and stops at the cap', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(999)).toBe(4);
    expect(levelForXp(1000)).toBe(5);
    expect(levelForXp(1_000_000)).toBe(LEVELING.cap);
    expect(LEVELING.cap).toBe(20);
  });

  it('hands out an attribute point at 4, 8, 12, 16 and 20', () => {
    for (let level = 2; level <= 20; level += 1) {
      expect([level, givesAttributePoint(level)]).toEqual([level, level % 4 === 0]);
    }
  });

  it('pays for a deed by the floor it was done on', () => {
    expect(xpFor('disarmTrap', 1)).toBe(10);
    expect(xpFor('disarmTrap', 7)).toBe(70);
    expect(xpFor('pickLock', 4)).toBe(20);
    expect(xpFor('findSecretDoor', 3)).toBe(30);
    expect(xpFor('findStairs', 2)).toBe(50);
    expect(() => xpFor('sneeze', 1)).toThrow(/no XP rule/);
  });
});

describe('the four origins (01 section 3)', () => {
  it('are the ones the document lists, each raising a different attribute', () => {
    expect(ORIGIN_ORDER).toEqual(['sellsword', 'cutpurse', 'apprentice', 'pilgrim']);
    expect(originList().map((entry) => `${entry.name} +1 ${abbr(entry.attribute)}`)).toEqual([
      'SELLSWORD +1 MIG',
      'CUTPURSE +1 AGI',
      'APPRENTICE +1 INT',
      'PILGRIM +1 WIT',
    ]);
    expect(originList()[0].blurb).toBeTruthy();
    const raised = originList().map((entry) => entry.attribute);
    expect(new Set(raised).size).toBe(4);
  });

  it('grants the free skill and the kit the table gives', () => {
    expect(origin('sellsword')).toMatchObject({
      freeSkill: { id: 'weapon_training', rank: 1 },
      gold: 10,
    });
    expect(origin('cutpurse').kit.map((line) => line.item)).toEqual([
      'short_sword',
      'dagger',
      'lockpicks',
      'ten_foot_pole',
    ]);
    expect(origin('cutpurse').kit.find((line) => line.item === 'dagger').count).toBe(3);
    expect(origin('apprentice')).toMatchObject({ freeSkill: { id: 'magic_missile' }, gold: 15 });
    expect(origin('pilgrim')).toMatchObject({ freeSkill: { id: 'mend' }, gold: 10 });
    expect(() => origin('knight')).toThrow(/unknown origin/);
  });

  it('adds its +1 to the scores, without touching the rest', () => {
    const scores = { might: 12, agility: 10, vigor: 11, intellect: 9, wits: 13, luck: 8 };
    const after = withOrigin(scores, 'sellsword');
    expect(after.might).toBe(13);
    expect({ ...after, might: 12 }).toEqual(scores);
    // The original is left alone: creation may be re-rolled.
    expect(scores.might).toBe(12);
  });

  it('never pushes a score past 20, even from the creation maximum', () => {
    expect(withOrigin({ intellect: 18 }, 'apprentice').intellect).toBe(19);
    expect(withOrigin({ intellect: 20 }, 'apprentice').intellect).toBe(20);
  });

  it('hands back everything a new hero gets, for whoever can grant it', () => {
    const scores = { might: 15, agility: 12, vigor: 14, intellect: 10, wits: 11, luck: 9 };
    const grants = grantsOf(scores, 'sellsword');
    expect(grants).toMatchObject({
      origin: 'sellsword',
      gold: 10,
      freeSkill: { id: 'weapon_training', rank: 1 },
    });
    expect(grants.attributes.might).toBe(16);
    // The modifier follows the raised score: 15 is +1, 16 is +2.
    expect(grants.mods.might).toBe(2);
    expect(grants.kit).toHaveLength(3);
  });

  it('names its kit items in the spelling the item database will use', () => {
    // `04` section 11 and the weapon tables: every one of these needs an entry
    // in items.json when Phase 5 writes it.
    expect(kitItemIds().sort()).toEqual([
      'dagger',
      'healing_herb',
      'leather_armor',
      'lockpicks',
      'long_sword',
      'mace',
      'ration',
      'robe',
      'scroll_of_sleep',
      'short_sword',
      'staff',
      'ten_foot_pole',
    ]);
  });
});
