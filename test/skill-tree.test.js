/**
 * Learning a skill (`01` sections 3, 5 and 6): the tier gates, the capstone
 * requirements, the ranks, and the Crossroads.
 *
 * The last group builds the document's own four example builds at level 20.
 * If the gates or the costs were wrong, those would not fit in 21 points.
 */
import { describe, it, expect } from 'vitest';
import {
  REASONS,
  canLearn,
  freeRanksOf,
  grantFree,
  learn,
  meetsPaths,
  meetsRequirement,
  rankOf,
  respec,
  respecCost,
  spentIn,
  spentTotal,
  tierOpenIn,
  treeFor,
  unspent,
  whyNot,
} from '../src/systems/skill-tree.js';
import { CROSSROADS, gateFor, skill, skillIds } from '../src/data/skills.js';
import { LEVELING } from '../src/data/attributes.js';
import { finish, setName, chooseOrigin, createDraft } from '../src/systems/creation.js';
import { t } from '../src/data/strings.js';

/** A hero with the attributes and points a test asks for. */
function hero({ scores, origin = 'sellsword', points } = {}) {
  const made = finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 3 }),
          scores: scores ?? { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 },
        },
        origin,
      ),
      'Harrow',
    ),
  );
  if (points !== undefined) made.skillPoints = points;
  return made;
}

/** Spends points down a list, and says what went wrong if anything did. */
function spend(unit, ids) {
  const failed = [];
  for (const id of ids) {
    const result = learn(unit, id);
    if (!result.learned) failed.push(`${id}: ${result.why}`);
  }
  return failed;
}

describe('the points a hero has', () => {
  it('starts with what level 1 gives', () => {
    const harrow = hero({ points: undefined });
    expect(harrow.skillPoints).toBe(LEVELING.skillPointsAtLevel1);
    expect(spentTotal(harrow)).toBe(0);
  });

  it('spends one on a rank, and no more than it has', () => {
    const harrow = hero({ points: 2 });
    expect(learn(harrow, 'toughness')).toEqual({ learned: true, rank: 1 });
    expect(unspent(harrow)).toBe(1);
    expect(learn(harrow, 'toughness')).toEqual({ learned: true, rank: 2 });
    expect(unspent(harrow)).toBe(0);
    expect(learn(harrow, 'toughness')).toEqual({ learned: false, why: 'noPoints' });
  });

  it('never goes past a skill’s ranks', () => {
    const harrow = hero({ points: 9 });
    expect(spend(harrow, ['toughness', 'toughness', 'toughness'])).toEqual([]);
    expect(rankOf(harrow, 'toughness')).toBe(3);
    expect(learn(harrow, 'toughness')).toEqual({ learned: false, why: 'maxRank' });
  });

  it('refuses a skill that does not exist', () => {
    expect(whyNot(hero({ points: 1 }), 'sword_dancing')).toBe('unknown');
  });
});

describe('an origin’s free skill (01 section 3)', () => {
  it('is learned from the first step, and cost nothing', () => {
    const harrow = hero({ points: 1 });
    expect(rankOf(harrow, 'weapon_training')).toBe(1);
    expect(freeRanksOf(harrow, 'weapon_training')).toBe(1);
    expect(spentTotal(harrow)).toBe(0);
    expect(unspent(harrow)).toBe(1);
  });

  it('counts against no Path, so it cannot open a tier', () => {
    // "An origin grants one free skill (it doesn't count against Path
    // requirements)" — three free ranks would otherwise open tier II.
    const harrow = hero({ points: 0 });
    grantFree(harrow, { id: 'toughness', rank: 3 });
    expect(rankOf(harrow, 'toughness')).toBe(3);
    expect(spentIn(harrow, 'blade')).toBe(0);
    expect(tierOpenIn(harrow, 'blade', 2)).toBe(false);
  });

  it('still applies: the hero really has it', () => {
    // The same hero, before and after the gift, so only the skill moves.
    const pilgrim = hero({ origin: 'pilgrim' });
    const before = pilgrim.atk;
    grantFree(pilgrim, { id: 'weapon_training', rank: 1 });
    expect(pilgrim.atk).toBe(before + 1);
    expect(spentTotal(pilgrim)).toBe(0);
  });

  it('can be paid past: the free rank stays free', () => {
    const harrow = hero({ points: 2 });
    expect(learn(harrow, 'weapon_training').rank).toBe(2);
    expect(freeRanksOf(harrow, 'weapon_training')).toBe(1);
    expect(spentIn(harrow, 'blade')).toBe(1);
    expect(unspent(harrow)).toBe(1);
  });
});

describe('the tier gates (01 section 6)', () => {
  it('open at 0, 3, 6 and 10 points in the Path', () => {
    expect([1, 2, 3, 4].map(gateFor)).toEqual([0, 3, 6, 10]);

    const harrow = hero({ points: 20 });
    expect(tierOpenIn(harrow, 'blade', 1)).toBe(true);
    expect(tierOpenIn(harrow, 'blade', 2)).toBe(false);

    spend(harrow, ['toughness', 'toughness', 'toughness']);
    expect(spentIn(harrow, 'blade')).toBe(3);
    expect(tierOpenIn(harrow, 'blade', 2)).toBe(true);
    expect(tierOpenIn(harrow, 'blade', 3)).toBe(false);
  });

  it('say so, rather than blaming the purse', () => {
    const harrow = hero({ points: 0 });
    // Tier II is shut whether or not there is a point to spend: that is the
    // fact a player plans around.
    expect(whyNot(harrow, 'cleave')).toBe('tierLocked');
    expect(whyNot(harrow, 'toughness')).toBe('noPoints');
  });

  it('count only their own Path', () => {
    const harrow = hero({ points: 20 });
    spend(harrow, ['marksman', 'marksman', 'marksman']);
    expect(spentIn(harrow, 'shadow')).toBe(3);
    expect(tierOpenIn(harrow, 'shadow', 2)).toBe(true);
    // Blade saw none of it.
    expect(tierOpenIn(harrow, 'blade', 2)).toBe(false);
  });
});

describe('the capstones (01 section 6)', () => {
  const strong = { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 };
  const weak = { ...strong, might: 12 };

  it('want ten points in the Path and an attribute of 15', () => {
    const able = hero({ scores: strong, points: 20 });
    // Sellsword raises MIG 15 to 16, so the requirement is met.
    expect(meetsRequirement(able, 'juggernaut')).toBe(true);
    expect(whyNot(able, 'juggernaut')).toBe('tierLocked');

    spend(able, [
      'weapon_training', 'weapon_training',
      'toughness', 'toughness', 'toughness',
      'brute_force', 'brute_force',
      'cleave', 'armor_training', 'shield_bash',
    ]);
    expect(spentIn(able, 'blade')).toBe(10);
    expect(canLearn(able, 'juggernaut')).toBe(true);
  });

  it('refuse a hero whose attribute is short, however many points they spent', () => {
    const unable = hero({ scores: weak, origin: 'cutpurse', points: 20 });
    spend(unable, [
      'weapon_training', 'weapon_training', 'weapon_training',
      'toughness', 'toughness', 'toughness',
      'brute_force', 'brute_force',
      'cleave', 'armor_training',
    ]);
    expect(spentIn(unable, 'blade')).toBe(10);
    expect(meetsRequirement(unable, 'juggernaut')).toBe(false);
    expect(whyNot(unable, 'juggernaut')).toBe('needsAttribute');
  });

  it('are the four the document names, each asking 15 of its own attribute', () => {
    for (const [id, attribute] of [
      ['juggernaut', 'might'],
      ['death_strike', 'agility'],
      ['archmage', 'intellect'],
      ['undying', 'wits'],
    ]) {
      expect([id, skill(id).requires]).toEqual([id, { attribute, score: 15 }]);
    }
  });
});

describe('the Crossroads (01 section 6)', () => {
  it('want four points in each of their two Paths', () => {
    expect(CROSSROADS).toEqual({ cost: 1, pointsInEachPath: 4 });
    const harrow = hero({ points: 20 });
    expect(whyNot(harrow, 'duelist')).toBe('needsPaths');

    spend(harrow, ['toughness', 'toughness', 'toughness', 'weapon_training']);
    expect(meetsPaths(harrow, 'duelist')).toBe(false);

    spend(harrow, ['marksman', 'marksman', 'marksman', 'sneak']);
    expect(spentIn(harrow, 'blade')).toBe(4);
    expect(spentIn(harrow, 'shadow')).toBe(4);
    expect(canLearn(harrow, 'duelist')).toBe(true);
  });

  it('cost one point, like any other rank', () => {
    const harrow = hero({ points: 12 });
    spend(harrow, [
      'toughness', 'toughness', 'toughness', 'weapon_training',
      'marksman', 'marksman', 'marksman', 'sneak',
    ]);
    const before = unspent(harrow);
    expect(learn(harrow, 'duelist')).toEqual({ learned: true, rank: 1 });
    expect(unspent(harrow)).toBe(before - 1);
    expect(rankOf(harrow, 'duelist')).toBe(1);
  });

  it('ignore the tier gates, because they have no tier', () => {
    const harrow = hero({ points: 20 });
    spend(harrow, ['toughness', 'toughness', 'toughness', 'weapon_training']);
    spend(harrow, ['marksman', 'marksman', 'marksman', 'sneak']);
    // Duelist is taken with nothing above tier I in either Path.
    expect(canLearn(harrow, 'duelist')).toBe(true);
  });
});

describe('forgetting it all', () => {
  it('costs 100 gp a level', () => {
    expect(respecCost({ level: 1 })).toBe(100);
    expect(respecCost({ level: 7 })).toBe(700);
  });

  it('gives every paid point back and keeps the origin’s gift', () => {
    const harrow = hero({ points: 5 });
    spend(harrow, ['toughness', 'toughness', 'weapon_training']);
    expect(unspent(harrow)).toBe(2);
    const withSkills = harrow.maxHp;

    respec(harrow);
    expect(unspent(harrow)).toBe(5);
    expect(rankOf(harrow, 'toughness')).toBe(0);
    // The Sellsword keeps Weapon Training, which was never paid for.
    expect(rankOf(harrow, 'weapon_training')).toBe(1);
    expect(freeRanksOf(harrow, 'weapon_training')).toBe(1);
    // And the sheet comes back with it.
    expect(harrow.maxHp).toBe(withSkills - 10);
  });
});

describe('what the Skill Tree screen reads', () => {
  it('gives every skill its rank and its reason', () => {
    const harrow = hero({ points: 1 });
    const tree = treeFor(harrow);
    expect(tree).toHaveLength(skillIds().length);

    const weaponTraining = tree.find((row) => row.id === 'weapon_training');
    expect(weaponTraining).toMatchObject({ rank: 1, free: 1, ranks: 3, why: null });

    const cleave = tree.find((row) => row.id === 'cleave');
    expect(cleave).toMatchObject({ rank: 0, tier: 2, why: 'tierLocked' });
  });

  it('has a line to show for every reason it can give', () => {
    for (const reason of REASONS) {
      expect([reason, t(`skillTree.locked.${reason}`)]).not.toEqual([
        reason,
        `skillTree.locked.${reason}`,
      ]);
    }
  });
});

describe('the document’s own example builds (01 section 6)', () => {
  /** 21 SP by level 20: twenty from levels and one at the start. */
  const atTwenty = (scores, origin) => hero({ scores, origin, points: 21 });
  const strong = { might: 16, agility: 16, vigor: 14, intellect: 16, wits: 16, luck: 10 };

  it('fits the Pure Warrior: Blade 16, Spirit 4, Crusader', () => {
    // "Blade 16 (everything except Brute Force rank 2) + Spirit 4 + Crusader."
    //
    // The document's parenthetical for those four Spirit points — "Resilience
    // x2, Mend, Cleanse" — cannot be bought in that order: Resilience is tier
    // II, which opens at 3 points spent in the Path, and Mend alone is 1. The
    // gate is the rule and the example is a sketch, so this spends the four on
    // a legal Spirit 4 (see DECISIONS, Open questions).
    const build = atTwenty(strong, 'cutpurse');
    const blade = [
      'weapon_training', 'weapon_training', 'weapon_training',
      'power_strike', 'toughness', 'toughness', 'toughness', 'brute_force',
      'cleave', 'armor_training', 'armor_training', 'shield_bash',
      'riposte', 'second_wind', 'weapon_mastery',
      'juggernaut',
    ];
    const spirit = ['mend', 'keen_senses', 'keen_senses', 'resilience'];
    expect(spend(build, [...blade, ...spirit, 'crusader'])).toEqual([]);
    expect(spentIn(build, 'blade')).toBe(16);
    expect(spentIn(build, 'spirit')).toBe(4);
    expect(spentTotal(build)).toBe(21);
    expect(unspent(build)).toBe(0);
  });

  it('fits the Battle Mage: Arcana 11 through Archmage, Blade 4, Spellblade', () => {
    const build = atTwenty(strong, 'cutpurse');
    const arcana = [
      'magic_missile', 'arcane_well', 'arcane_well', 'arcane_well',
      'sleep', 'frost_shard', 'arcane_shield',
      'fireball', 'blink', 'mana_siphon',
      'archmage',
    ];
    const blade = ['weapon_training', 'weapon_training', 'toughness', 'power_strike'];
    expect(spend(build, [...arcana, ...blade, 'spellblade'])).toEqual([]);
    expect(spentIn(build, 'arcana')).toBe(11);
    expect(spentIn(build, 'blade')).toBe(4);
    // "+ 5 spare": the build the document describes leaves points over.
    expect(unspent(build)).toBe(5);
  });

  it('fits the Wanderer: Shadow 8, Spirit 8, Ranger, and points to spare', () => {
    const build = atTwenty(strong, 'sellsword');
    const shadow = [
      'marksman', 'marksman', 'marksman', 'sneak',
      'backstab', 'evasion', 'evasion', 'envenom',
    ];
    const spirit = [
      'mend', 'keen_senses', 'keen_senses', 'forager',
      'turn_undead', 'resilience', 'resilience', 'cleanse',
    ];
    expect(spend(build, [...shadow, ...spirit, 'ranger'])).toEqual([]);
    expect(spentIn(build, 'shadow')).toBe(8);
    expect(spentIn(build, 'spirit')).toBe(8);
    expect(unspent(build)).toBe(4);
  });

  it('refuses a build that reaches for a capstone too early', () => {
    const build = atTwenty(strong, 'cutpurse');
    // Nine points in Arcana is one short of the tier IV gate.
    expect(
      spend(build, [
        'magic_missile', 'arcane_well', 'arcane_well', 'arcane_well',
        'sleep', 'frost_shard', 'arcane_shield', 'fireball', 'blink',
      ]),
    ).toEqual([]);
    expect(spentIn(build, 'arcana')).toBe(9);
    expect(whyNot(build, 'archmage')).toBe('tierLocked');
    expect(learn(build, 'mana_siphon').learned).toBe(true);
    expect(canLearn(build, 'archmage')).toBe(true);
  });
});
