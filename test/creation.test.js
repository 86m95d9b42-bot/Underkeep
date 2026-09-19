/**
 * Making a hero: the two roll modes, the origins, and the derived statistics
 * a new hero ends up with (`01` sections 3 and 4).
 *
 * The distribution tests are the ones that matter most: 3d6 and 4d6-drop-one
 * have known means, and a bug in the drop would move them.
 */
import { describe, it, expect } from 'vitest';
import {
  DIFFICULTIES,
  MODES,
  NAME_LIMIT,
  ROLL_MODES,
  canRearrange,
  chooseOrigin,
  createDraft,
  finish,
  newSeed,
  previewOf,
  reroll,
  rollSet,
  seedFrom,
  setName,
  swap,
  whyNotReady,
} from '../src/systems/creation.js';
import {
  attackFor,
  attacksFor,
  baseAttack,
  critFromFor,
  defenseFor,
  derivedFor,
  effectDcFor,
  focusFor,
  hpGain,
  initiativeFor,
  savesFor,
  slotsFor,
  startingHp,
} from '../src/systems/derived.js';
import { ATTRIBUTE_ORDER, MAX_AT_CREATION } from '../src/data/attributes.js';
import { carriedStreams, createStream } from '../src/engine/rng.js';
import { createFight, standInHero } from '../src/systems/fight.js';
import { effectDcOf, makeMonster } from '../src/data/monsters.js';
import { fleeBonusOf } from '../src/engine/ending.js';
import { applyRider } from '../src/engine/riders.js';
import { applyCondition } from '../src/engine/conditions.js';

const SEED = 20260918;

/** The mockup's hero, whose preview the document's formulas have to reproduce. */
const MOCKUP = { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 };

describe('rolling attributes (01 section 3)', () => {
  it('offers the two modes the document names', () => {
    expect(ROLL_MODES.sort()).toEqual(['classic', 'standard']);
    expect(MODES).toEqual(['adventurer', 'ironman']);
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
  });

  it('rolls all six, in the document’s order, inside 3 to 18', () => {
    for (const mode of ROLL_MODES) {
      const { scores, rolls } = rollSet(SEED, mode);
      expect(rolls.map((roll) => roll.id)).toEqual(ATTRIBUTE_ORDER);
      for (const id of ATTRIBUTE_ORDER) {
        expect([mode, id, scores[id] >= 3 && scores[id] <= MAX_AT_CREATION]).toEqual([mode, id, true]);
      }
    }
  });

  it('rolls 3d6 for Classic and 4d6-drop-the-lowest for Standard', () => {
    const classic = rollSet(SEED, 'classic').rolls[0];
    expect(classic.dice).toHaveLength(3);
    expect(classic.dropped).toBeUndefined();
    expect(classic.total).toBe(classic.dice.reduce((a, b) => a + b, 0));

    const standard = rollSet(SEED, 'standard').rolls[0];
    expect(standard.dice).toHaveLength(4);
    expect(standard.dropped).toHaveLength(1);
    // The dropped die is the lowest, and the total is the other three.
    expect(standard.dropped[0]).toBe(Math.min(...standard.dice));
    expect(standard.total).toBe(standard.dice.reduce((a, b) => a + b, 0) - standard.dropped[0]);
  });

  it('lands on the means those dice actually have', () => {
    // 3d6 averages 10.5; 4d6 drop the lowest averages 12.24. Dropping the
    // highest instead would land near 8.7, which is what this catches.
    for (const [mode, expected] of [['classic', 10.5], ['standard', 12.24]]) {
      let total = 0;
      let count = 0;
      for (let attempt = 0; attempt < 2000; attempt += 1) {
        for (const score of Object.values(rollSet(12345, mode, attempt).scores)) {
          total += score;
          count += 1;
        }
      }
      expect([mode, Math.abs(total / count - expected) < 0.15]).toEqual([mode, true]);
    }
  });

  it('rolls the same six for the same seed and attempt, for ever', () => {
    expect(rollSet(SEED, 'standard', 3)).toEqual(rollSet(SEED, 'standard', 3));
    expect(rollSet(SEED, 'standard', 3).scores).not.toEqual(rollSet(SEED, 'standard', 4).scores);
    expect(rollSet(SEED + 1, 'standard').scores).not.toEqual(rollSet(SEED, 'standard').scores);
  });

  it('refuses a mode it has never heard of', () => {
    expect(() => rollSet(SEED, 'heroic')).toThrow(/unknown roll mode/);
  });
});

describe('the draft', () => {
  it('starts from the choices New Game made', () => {
    const draft = createDraft({ seed: SEED, mode: 'ironman', difficulty: 'hard', rollMode: 'classic' });
    expect(draft).toMatchObject({
      seed: SEED,
      mode: 'ironman',
      difficulty: 'hard',
      rollMode: 'classic',
      attempt: 0,
      origin: null,
      name: '',
    });
  });

  it('falls back on a mode or difficulty it does not know', () => {
    const draft = createDraft({ seed: SEED, mode: 'godlike', difficulty: 'nightmare' });
    expect(draft.mode).toBe('adventurer');
    expect(draft.difficulty).toBe('normal');
  });

  it('rerolls the whole set, counting the attempts', () => {
    const first = createDraft({ seed: SEED, rollMode: 'standard' });
    const second = reroll(first);
    expect(second.attempt).toBe(1);
    expect(second.scores).not.toEqual(first.scores);
    // The first draft is untouched: a draft is never edited in place.
    expect(first.attempt).toBe(0);
    // And the same reroll always gives the same six.
    expect(reroll(first).scores).toEqual(second.scores);
  });

  it('lets Standard rearrange and refuses Classic', () => {
    const standard = createDraft({ seed: SEED, rollMode: 'standard' });
    expect(canRearrange(standard)).toBe(true);
    const swapped = swap(standard, 'might', 'luck');
    expect(swapped.scores.might).toBe(standard.scores.luck);
    expect(swapped.scores.luck).toBe(standard.scores.might);

    const classic = createDraft({ seed: SEED, rollMode: 'classic' });
    expect(canRearrange(classic)).toBe(false);
    expect(swap(classic, 'might', 'luck').scores).toEqual(classic.scores);
  });

  it('ignores a swap that makes no sense', () => {
    const draft = createDraft({ seed: SEED, rollMode: 'standard' });
    expect(swap(draft, 'might', 'might').scores).toEqual(draft.scores);
    expect(swap(draft, 'might', 'charm').scores).toEqual(draft.scores);
  });

  it('takes a name, trimmed to what the sheet can show', () => {
    const draft = setName(createDraft({ seed: SEED }), 'A'.repeat(40));
    expect(draft.name).toHaveLength(NAME_LIMIT);
  });

  it('takes an origin, and only a real one', () => {
    const draft = chooseOrigin(createDraft({ seed: SEED }), 'pilgrim');
    expect(draft.origin).toBe('pilgrim');
    expect(chooseOrigin(draft, 'knight').origin).toBe('pilgrim');
    expect(chooseOrigin(draft, null).origin).toBe(null);
  });

  it('says what it is still waiting for', () => {
    let draft = createDraft({ seed: SEED });
    expect(whyNotReady(draft)).toBe('noOrigin');
    draft = chooseOrigin(draft, 'sellsword');
    expect(whyNotReady(draft)).toBe('noName');
    draft = setName(draft, '   ');
    expect(whyNotReady(draft)).toBe('noName');
    draft = setName(draft, 'Harrow');
    expect(whyNotReady(draft)).toBe(null);
    expect(() => finish(createDraft({ seed: SEED }))).toThrow(/not ready/);
  });

  it('previews the origin’s +1 as soon as one is chosen', () => {
    const draft = { ...createDraft({ seed: SEED }), scores: { ...MOCKUP } };
    expect(previewOf(draft).hp).toBe(24);
    const pilgrim = previewOf(chooseOrigin(draft, 'pilgrim'));
    // Pilgrim raises WIT 13 to 14, which is still a +1 modifier: Focus holds.
    expect(pilgrim.scores.wits).toBe(14);
    expect(pilgrim.fp).toBe(6);
  });
});

describe('the derived statistics (01 section 4)', () => {
  it('reproduces the mockup’s own preview', () => {
    // CreateStats.html: MIG 15, AGI 12, VIG 14, INT 9, WIT 13, LCK 8
    // shows HP 24, FOCUS 6, DEFENSE 10.
    expect(startingHp(MOCKUP)).toBe(24);
    expect(focusFor(MOCKUP, 1)).toBe(6);
    expect(defenseFor(MOCKUP)).toBe(10);
  });

  it('gives hit points as 10 + the VIG score', () => {
    expect(startingHp({ vigor: 3 })).toBe(13);
    expect(startingHp({ vigor: 18 })).toBe(28);
  });

  it('adds 1d6 + the VIG mod on a level-up, never less than 2', () => {
    const ones = { roll: () => 1 };
    const sixes = { roll: () => 6 };
    // 1 + (−3) is below the floor, so the minimum applies.
    expect(hpGain({ vigor: 3 }, ones)).toBe(2);
    expect(hpGain({ vigor: 20 }, sixes)).toBe(10);
    // And a real stream stays inside the band it can produce.
    const rng = createStream('levels', 'combat');
    for (let i = 0; i < 50; i += 1) {
      const gain = hpGain({ vigor: 14 }, rng);
      expect(gain).toBeGreaterThanOrEqual(2);
      expect(gain).toBeLessThanOrEqual(7);
    }
  });

  it('gives Focus as 4 + level + INT mod + WIT mod, never less than 2', () => {
    expect(focusFor({ intellect: 10, wits: 10 }, 1)).toBe(5);
    expect(focusFor({ intellect: 18, wits: 18 }, 3)).toBe(13);
    // Two −3 modifiers at level 1 would be −1; the floor is 2.
    expect(focusFor({ intellect: 3, wits: 3 }, 1)).toBe(2);
  });

  it('gives the Base Attack as half the level, rounded down', () => {
    expect([1, 2, 3, 4, 20].map(baseAttack)).toEqual([0, 1, 1, 2, 10]);
  });

  it('adds BA to the right attribute for each kind of attack', () => {
    const scores = { might: 16, agility: 13, intellect: 9 };
    expect(attackFor(scores, 'melee', 4)).toBe(2 + 2);
    expect(attackFor(scores, 'ranged', 4)).toBe(2 + 1);
    expect(attackFor(scores, 'spell', 4)).toBe(2 + 0);
    expect(attacksFor(scores, 1)).toEqual({ melee: 2, ranged: 1, spell: 0 });
    expect(() => attackFor(scores, 'psychic')).toThrow(/no attack rule/);
  });

  it('gives Defense as 10 + AGI mod, plus whatever is worn', () => {
    expect(defenseFor({ agility: 16 })).toBe(12);
    expect(defenseFor({ agility: 16 }, 3)).toBe(15);
    expect(initiativeFor({ agility: 16 })).toBe(2);
  });

  it('gives saves as the attribute mod plus a third of the level', () => {
    const scores = { vigor: 16, agility: 13, wits: 8 };
    expect(savesFor(scores, 1)).toEqual({ body: 2, reflex: 1, mind: -1 });
    expect(savesFor(scores, 6)).toEqual({ body: 4, reflex: 3, mind: 1 });
  });

  it('gives slots as 10 + twice the MIG mod', () => {
    expect(slotsFor({ might: 16 })).toBe(14);
    expect(slotsFor({ might: 3 })).toBe(4);
  });

  it('widens the crit range once Luck reaches +2', () => {
    expect(critFromFor({ luck: 15 })).toBe(20);
    expect(critFromFor({ luck: 16 })).toBe(19);
  });

  it('gives a player effect DC of 10 + half the level + the attribute', () => {
    expect(effectDcFor({ wits: 16 }, 'wits', 1)).toBe(12);
    expect(effectDcFor({ wits: 16 }, 'wits', 8)).toBe(16);
  });

  it('hands the whole sheet back at once', () => {
    const sheet = derivedFor(MOCKUP);
    expect(sheet).toMatchObject({ level: 1, maxHp: 24, maxFp: 6, def: 10, ba: 0, slots: 12 });
    expect(sheet.saves).toEqual({ body: 1, reflex: 0, mind: 1 });
    expect(sheet.skillPoints).toBe(1);
    // A hero past level 1 brings the HP they rolled for.
    expect(derivedFor(MOCKUP, { level: 3, maxHp: 31 }).maxHp).toBe(31);
  });
});

describe('finishing a hero', () => {
  const ready = () =>
    setName(chooseOrigin({ ...createDraft({ seed: SEED }), scores: { ...MOCKUP } }, 'sellsword'), 'Harrow');

  it('carries everything the game needs to play them', () => {
    const hero = finish(ready());
    expect(hero).toMatchObject({
      name: 'Harrow',
      origin: 'sellsword',
      level: 1,
      xp: 0,
      protected: true,
      gold: 10,
      skillPoints: 1,
      seed: SEED,
      mode: 'adventurer',
      difficulty: 'normal',
    });
    // Sellsword raises MIG 15 to 16, which is a +2: melee and slots both move.
    expect(hero.attributes.might).toBe(16);
    expect(hero.atk).toBe(2);
    expect(hero.slots).toBe(14);
    expect(hero.hp).toBe(hero.maxHp);
    expect(hero.fp).toBe(hero.maxFp);
    expect(hero.freeSkill).toEqual({ id: 'weapon_training', rank: 1 });
    expect(hero.kit).toHaveLength(3);
  });

  it('is the hero the combat engine already knows how to fight with', () => {
    const hero = finish(ready());
    // The engine reads these four off any unit (`06` sections 3 and 6).
    expect(typeof hero.atk).toBe('number');
    expect(typeof hero.def).toBe('number');
    expect(typeof hero.init).toBe('number');
    expect(hero.saves).toMatchObject({ body: expect.any(Number) });
    expect(hero.critFrom).toBe(20);
  });
});

describe('the derived statistics reaching the game', () => {
  /** A fight with one rat, and whatever hero is handed in. */
  const fightWith = (hero) =>
    createFight({
      hero: standInHero(hero),
      monsters: [makeMonster('giant_rat')],
      streams: carriedStreams(11),
      surprise: false,
    });

  it('lets Vigor shake off poison, through the condition engine', () => {
    // `06` section 4 step 13 rolls the end-of-turn saves; `01` section 4 says
    // what a hero adds to them. A flat 9 fails DC 12 and 9 + 3 passes it.
    const outcome = (body) => {
      const fight = fightWith({ id: 'hero', name: 'H', hp: 20, maxHp: 20, saves: { body, reflex: 0, mind: 0 } });
      applyCondition(fight.hero, 'poisoned', { dc: 12 });
      const payload = fight.combat.hooks.fire('turnEnd', {
        combat: fight.combat,
        unit: fight.hero,
        rng: { d20: () => 9 },
      });
      return payload.saves[0];
    };
    expect(outcome(0)).toMatchObject({ total: 9, passed: false });
    expect(outcome(3)).toMatchObject({ total: 12, passed: true });
  });

  it('flees on Agility and Luck, as section 14 says', () => {
    expect(fleeBonusOf({ mods: { agility: 2, luck: 1 } })).toBe(3);
    expect(fleeBonusOf({})).toBe(0);

    // A hero who is quick and lucky gets away on a roll a clumsy one does not.
    const tryFlee = (mods) => {
      const fight = fightWith({ id: 'hero', name: 'H', hp: 20, maxHp: 20, mods });
      fight.combat.rng.d20 = () => 8; // TN is 10 + 1 living enemy = 11
      return fight.act('flee');
    };
    expect(tryFlee({ agility: 0, luck: 0 }).fled).toBe(false);
    expect(tryFlee({ agility: 2, luck: 1 }).fled).toBe(true);
  });

  it('gives a monster with no stated DC the one its Hit Dice earn', () => {
    // `01` section 4: DC 10 + floor(HD / 2), which is what the bestiary's own
    // stated DCs come to — a Zombie of HD 2 forces DC 11.
    expect([1, 2, 3, 5, 10].map((hd) => effectDcOf({ hd }))).toEqual([10, 11, 11, 12, 15]);
    expect(effectDcOf(makeMonster('zombie'))).toBe(11);
    expect(effectDcOf(makeMonster('ghoul'))).toBe(11);

    // A rider that states nothing is rolled against that DC.
    const fight = fightWith({ id: 'hero', name: 'H', hp: 20, maxHp: 20, saves: { body: 0 } });
    const rat = fight.combat.units[1];
    fight.combat.rng.d20 = () => 10;
    const landed = applyRider(fight.combat, rat, fight.hero, { onHit: { save: 'body', condition: 'weakened' } }, {});
    expect(landed.save.dc).toBe(effectDcOf(rat));
  });

  it('is the created hero’s own sheet the fight reads', () => {
    const hero = finish(
      setName(chooseOrigin({ ...createDraft({ seed: SEED }), scores: { ...MOCKUP } }, 'cutpurse'), 'Nyx'),
    );
    const fight = fightWith(hero);
    // Cutpurse raises AGI 12 to 13: +1 to DEF, to initiative and to Reflex.
    expect(fight.hero.def).toBe(11);
    expect(fight.hero.init).toBe(1);
    expect(fight.hero.saves.reflex).toBe(1);
    expect(fleeBonusOf(fight.hero)).toBe(1 + -1);
  });
});

describe('the seed', () => {
  it('reads a typed number, and ignores a blank', () => {
    expect(seedFrom(' 4242 ')).toBe(4242);
    expect(seedFrom('')).toBe(null);
    expect(seedFrom('   ')).toBe(null);
    // Anything else is a seed phrase, which the stream hashes just as well.
    expect(seedFrom('the deep')).toBe('the deep');
  });

  it('makes a fresh one when the player leaves it blank', () => {
    const seeds = new Set();
    for (let i = 0; i < 20; i += 1) seeds.add(newSeed());
    expect(seeds.size).toBeGreaterThan(15);
  });
});
