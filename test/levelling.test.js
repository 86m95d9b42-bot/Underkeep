/**
 * Gaining experience and levelling (`01` section 5).
 *
 * The curve itself is pinned in `attributes.test.js` against the document's
 * printed table. This is what a level *does*: the hit points it rolls, the
 * Focus it re-derives, the skill point it hands over, and the attribute point
 * at 4, 8, 12, 16 and 20.
 */
import { describe, it, expect } from 'vitest';
import {
  LEVEL_CAP,
  attributePointsOwed,
  awardXp,
  canLevel,
  levelUp,
  owesLevel,
  previewPoint,
  progress,
  rebuildSheet,
  spendAttributePoint,
  xpNeeded,
} from '../src/systems/levelling.js';
import { LEVELING, xpForLevel } from '../src/data/attributes.js';
import { finish, setName, chooseOrigin, createDraft } from '../src/systems/creation.js';
import { learn } from '../src/systems/skill-tree.js';
import { createStream, carriedStreams } from '../src/engine/rng.js';
import { createFight, standInHero } from '../src/systems/fight.js';
import { makeMonster } from '../src/data/monsters.js';

/** A level 1 hero with known attributes. */
function hero(scores = { might: 16, agility: 12, vigor: 16, intellect: 10, wits: 12, luck: 10 }) {
  return finish(
    setName(chooseOrigin({ ...createDraft({ seed: 9 }), scores }, 'sellsword'), 'Harrow'),
  );
}

/** A stream whose d6 always gives this number. */
const die = (value) => ({ roll: () => value, die: () => value });

describe('what the hero still owes the curve', () => {
  it('knows what the next level costs, and stops at the cap', () => {
    const harrow = hero();
    expect(xpNeeded(harrow)).toBe(100);
    harrow.level = LEVEL_CAP;
    expect(canLevel(harrow)).toBe(false);
    expect(xpNeeded(harrow)).toBe(null);
    expect(LEVEL_CAP).toBe(20);
  });

  it('measures the bar between this level and the next', () => {
    const harrow = hero();
    harrow.xp = 50;
    expect(progress(harrow)).toMatchObject({ level: 1, into: 50, needed: 100, share: 0.5 });

    harrow.level = 3;
    harrow.xp = 400;
    // Level 3 is 300 and level 4 is 600, so 400 is a third of the way.
    expect(progress(harrow)).toMatchObject({ into: 100, needed: 300 });

    harrow.level = LEVEL_CAP;
    expect(progress(harrow).share).toBe(1);
  });

  it('says when a total has outgrown the level', () => {
    const harrow = hero();
    expect(owesLevel(harrow)).toBe(false);
    harrow.xp = 100;
    expect(owesLevel(harrow)).toBe(true);
  });
});

describe('a level-up (01 section 5)', () => {
  it('adds 1d6 + the VIG mod to hit points, and hands the gain over', () => {
    const harrow = hero();
    const before = { maxHp: harrow.maxHp, hp: harrow.hp };
    // VIG 16 is a +2, so a rolled 4 is a gain of 6.
    const gained = levelUp(harrow, die(4));
    expect(gained.hp).toBe(6);
    expect(harrow.maxHp).toBe(before.maxHp + 6);
    // The hero is no more wounded than they were.
    expect(harrow.hp).toBe(before.hp + 6);
  });

  it('never adds less than 2, however bad the roll', () => {
    const frail = hero({ might: 10, agility: 10, vigor: 3, intellect: 10, wits: 10, luck: 10 });
    // 1 on the die and a −3 modifier would be −2; the floor is 2.
    expect(levelUp(frail, die(1)).hp).toBe(2);
  });

  it('re-derives Focus, the Base Attack and the saves', () => {
    const harrow = hero();
    const before = { fp: harrow.maxFp, ba: harrow.ba, body: harrow.saves.body };
    levelUp(harrow, die(3));
    expect(harrow.maxFp).toBe(before.fp + 1);
    expect(harrow.ba).toBe(1);
    expect(harrow.ba).toBeGreaterThan(before.ba);

    // Saves rise every third level, not every one.
    expect(harrow.saves.body).toBe(before.body);
    levelUp(harrow, die(3));
    levelUp(harrow, die(3));
    expect(harrow.saves.body).toBe(before.body + 1);
  });

  it('hands over a skill point every level', () => {
    const harrow = hero();
    expect(harrow.skillPoints).toBe(LEVELING.skillPointsAtLevel1);
    levelUp(harrow, die(3));
    levelUp(harrow, die(3));
    expect(harrow.skillPoints).toBe(3);
  });

  it('owes an attribute point at 4, 8, 12, 16 and 20, and at no other level', () => {
    const harrow = hero();
    const owed = [];
    for (let level = 2; level <= LEVEL_CAP; level += 1) {
      const gained = levelUp(harrow, die(3));
      if (gained.attributePoint) owed.push(gained.level);
    }
    expect(owed).toEqual(LEVELING.attributePointLevels);
    expect(owed).toEqual([4, 8, 12, 16, 20]);
  });
});

describe('awarding experience', () => {
  it('adds it up, and levels the moment it is earned', () => {
    const harrow = hero();
    const rng = carriedStreams(4).loot;
    expect(awardXp(harrow, 99, rng).levels).toEqual([]);
    expect(harrow.level).toBe(1);

    const gained = awardXp(harrow, 1, rng);
    expect(gained.levels).toHaveLength(1);
    expect(harrow.level).toBe(2);
    expect(harrow.xp).toBe(100);
  });

  it('gives every level a single award has earned', () => {
    const harrow = hero();
    // 1,000 XP is level 5 outright: four levels at once.
    const gained = awardXp(harrow, xpForLevel(5), carriedStreams(4).loot);
    expect(gained.levels.map((row) => row.level)).toEqual([2, 3, 4, 5]);
    expect(harrow.level).toBe(5);
    expect(harrow.skillPoints).toBe(5);
    expect(attributePointsOwed(harrow)).toBe(1);
  });

  it('stops at the cap, however much is poured in', () => {
    const harrow = hero();
    awardXp(harrow, 1_000_000, carriedStreams(4).loot);
    expect(harrow.level).toBe(LEVEL_CAP);
    expect(harrow.skillPoints).toBe(LEVEL_CAP);
    expect(attributePointsOwed(harrow)).toBe(LEVELING.attributePointLevels.length);
  });

  it('rolls the same hit points for the same stream, so a reload cannot re-roll', () => {
    const run = () => {
      const harrow = hero();
      awardXp(harrow, 1000, carriedStreams(77).loot);
      return harrow.maxHp;
    };
    expect(run()).toBe(run());
  });

  it('ignores an award of nothing', () => {
    const harrow = hero();
    expect(awardXp(harrow, 0, die(3))).toMatchObject({ xp: 0, levels: [] });
    expect(awardXp(harrow, -50, die(3)).xp).toBe(0);
  });
});

describe('the attribute point', () => {
  it('raises a score, and the modifier follows', () => {
    const harrow = hero();
    harrow.attributePoints = 1;
    const before = harrow.atk;
    // MIG 16 is already +2 after the Sellsword's bonus; 17 is still +2.
    expect(spendAttributePoint(harrow, 'might')).toEqual({ spent: true, score: 18 });
    expect(harrow.attributes.might).toBe(18);
    // 18 is +3, so the melee bonus moves with it.
    expect(harrow.atk).toBe(before + 1);
    expect(attributePointsOwed(harrow)).toBe(0);
  });

  it('refuses without a point, on an unknown attribute, or at 20', () => {
    const harrow = hero();
    expect(spendAttributePoint(harrow, 'might')).toEqual({ spent: false, why: 'noPoints' });

    harrow.attributePoints = 2;
    expect(spendAttributePoint(harrow, 'charm')).toEqual({ spent: false, why: 'unknown' });

    harrow.attributes.luck = LEVELING.attributePointMax;
    expect(spendAttributePoint(harrow, 'luck')).toEqual({ spent: false, why: 'atMaximum' });
  });

  it('previews what a point would be worth', () => {
    const harrow = hero();
    // VIG 16 to 17 is still +2; 17 to 18 is +3.
    expect(previewPoint(harrow, 'vigor')).toMatchObject({ score: 17, mod: 2, raisesMod: false });
    harrow.attributes.vigor = 17;
    expect(previewPoint(harrow, 'vigor')).toMatchObject({ score: 18, mod: 3, raisesMod: true });
  });

  it('leaves the hit points already rolled alone', () => {
    const harrow = hero();
    awardXp(harrow, 1000, carriedStreams(4).loot);
    const rolled = harrow.maxHp;
    harrow.attributePoints = 1;
    spendAttributePoint(harrow, 'vigor');
    // A later point does not re-roll the levels already gained (`01` §4).
    expect(harrow.maxHp).toBe(rolled);
  });
});

describe('levelling beside the skills', () => {
  it('keeps a learned skill’s bonus through a level-up', () => {
    const harrow = hero();
    harrow.skillPoints = 3;
    learn(harrow, 'toughness');
    learn(harrow, 'weapon_training');
    const withSkills = { maxHp: harrow.maxHp, atk: harrow.atk };

    levelUp(harrow, die(4));
    // The level added its own hit points on top of Toughness's five, and
    // Weapon Training is still worth its +1 after the sheet was rebuilt —
    // the melee bonus moves by the Base Attack the level gave, and by
    // nothing else.
    expect(harrow.maxHp).toBe(withSkills.maxHp + 6);
    expect(harrow.atk).toBe(withSkills.atk + 1);
  });

  it('never compounds a skill, however often the sheet is rebuilt', () => {
    const harrow = hero();
    harrow.skillPoints = 3;
    learn(harrow, 'toughness');
    learn(harrow, 'weapon_training');
    learn(harrow, 'resilience');
    const once = { maxHp: harrow.maxHp, atk: harrow.atk, saves: { ...harrow.saves } };

    for (let i = 0; i < 5; i += 1) rebuildSheet(harrow);
    expect(harrow.maxHp).toBe(once.maxHp);
    // The nested parts of the sheet are the ones a shallow copy would have
    // let creep: the attack bonuses and the three saves.
    expect(harrow.atk).toBe(once.atk);
    expect(harrow.saves).toEqual(once.saves);
  });
});

describe('the XP a fight pays', () => {
  it('reaches the hero, and is committed before it is shown', () => {
    const harrow = hero();
    harrow.hp = harrow.maxHp = 60;
    const fight = createFight({
      hero: standInHero(harrow),
      monsters: [makeMonster('kobold'), makeMonster('kobold')],
      streams: carriedStreams(3),
      surprise: false,
    });
    fight.combat.rng.d20 = () => 19;

    let guard = 0;
    while (!fight.over && guard < 40) {
      guard += 1;
      fight.act('attack');
    }
    expect(fight.outcome).toBe('victory');
    // Two kobolds at 10 XP each, unless one ran — the summary and the hero
    // agree either way, which is the point.
    expect(fight.hero.xp).toBe(fight.summary.xp);
    expect(fight.summary.totalXp).toBe(fight.hero.xp);
  });

  it('levels the hero mid-fight-end, and says so in the log', () => {
    const harrow = hero();
    harrow.hp = harrow.maxHp = 60;
    harrow.xp = 95; // five short of level 2
    const fight = createFight({
      hero: standInHero(harrow),
      monsters: [makeMonster('kobold')],
      streams: carriedStreams(3),
      surprise: false,
    });
    fight.combat.rng.d20 = () => 19;

    let guard = 0;
    while (!fight.over && guard < 40) {
      guard += 1;
      fight.act('attack');
    }
    expect(fight.hero.level).toBe(2);
    expect(fight.summary.levels).toHaveLength(1);
    expect(fight.log.some((line) => /level 2/.test(line.text))).toBe(true);
  });

  it('pays nothing for a monster that ran (06 section 14)', () => {
    const harrow = hero();
    const fight = createFight({
      hero: standInHero(harrow),
      monsters: [makeMonster('kobold')],
      streams: carriedStreams(3),
      surprise: false,
    });
    fight.combat.units[1].fled = true;
    fight.act('defend');
    expect(fight.summary.xp).toBe(0);
    expect(fight.hero.xp).toBe(0);
  });
});
