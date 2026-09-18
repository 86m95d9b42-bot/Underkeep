/**
 * Conditions (`01` section 7, `06` section 10).
 *
 * One test per rule the documents state, using their own numbers: durations
 * count the affected unit's own turns, applying twice refreshes rather than
 * adds, control immunity opens when a control condition ends on the hero, and
 * Grit never lets the hero lose a third turn in a row.
 */
import { describe, it, expect } from 'vitest';
import {
  CONDITIONS,
  CONTROL_CONDITIONS,
  CONTROL_IMMUNITY_TURNS,
  GRIT_LOST_TURNS,
  START_OF_TURN_DAMAGE_ORDER,
  END_OF_TURN_SAVE_ORDER,
  EXPLORATION_POISON,
  spec,
  isControl,
  has,
  listed,
  applyCondition,
  endCondition,
  blockedFrom,
  isHelpless,
  blocks,
  blocked,
  defMod,
  drFrom,
  halvesWeaponDamage,
  actsLast,
  attackMods,
  defenceMods,
  startOfTurnDamage,
  endOfTurnSaves,
  tickDurations,
  tickControlImmunity,
  endOfRound,
  startOfTurn,
  acted,
  onDamageTaken,
  onHealed,
  onHitting,
  onFireDamage,
  onOwnAction,
  breakFree,
  afterCombat,
} from '../src/engine/conditions.js';
import { createStream } from '../src/engine/rng.js';
import { t } from '../src/data/strings.js';

/** A hero: the unit that gets the solo protections (`01`). */
const hero = (conditions = {}) => ({ id: 'hero', protected: true, conditions, controlImmunity: {}, lostTurns: 0, immunities: [] });
/** A monster: the same engine, without the protections. */
const monster = (conditions = {}) => ({ id: 'rat', conditions, controlImmunity: {}, lostTurns: 0, immunities: [] });

/** A stream that rolls what it is told, then repeats the last number. */
function fakeRng(...rolls) {
  const queue = [...rolls];
  const rng = () => 0;
  rng.die = () => (queue.length > 1 ? queue.shift() : queue[0]);
  rng.d20 = () => rng.die(20);
  rng.roll = (notation) => {
    const [, count = '1', sides] = /^(\d*)d(\d+)/.exec(notation) ?? [];
    return Number(count || 1) * 0 + rng.die(Number(sides));
  };
  return rng;
}

describe('the table in 01 section 7', () => {
  it('has every condition the rules list', () => {
    expect(Object.keys(CONDITIONS).sort()).toEqual(
      [
        'asleep', 'bleeding', 'blinded', 'burning', 'drained', 'feared', 'grabbed', 'hidden',
        'knockedDown', 'paralyzed', 'petrified', 'poisoned', 'sickened', 'slowed', 'stunned',
        'weakened', 'webbed',
      ].sort(),
    );
  });

  it('gives each one the numbers the table gives', () => {
    expect(spec('poisoned')).toMatchObject({ damagePerTurn: '1d4', save: 'body', rounds: 3 });
    expect(spec('burning')).toMatchObject({ damagePerTurn: '1d6', save: 'reflex' });
    expect(spec('bleeding')).toMatchObject({ damagePerTurn: '2', endsOnHealing: true });
    expect(spec('stunned')).toMatchObject({ rounds: 1, losesTurn: true, attackedWithAdvantage: true });
    expect(spec('asleep')).toMatchObject({ helpless: true, rounds: 3, endsOnDamage: true });
    expect(spec('slowed')).toMatchObject({ rounds: 2, defMod: -2, actsLast: true });
    expect(spec('blinded')).toMatchObject({ rounds: 2, attacksAtDisadvantage: true });
    expect(spec('petrified')).toMatchObject({ helpless: true, rounds: 2, dr: 5 });
    expect(spec('webbed').breakFree).toMatchObject({ tn: 12 });
    expect(spec('drained').stacks).toBe(true);
    expect(() => spec('bored')).toThrow(/bored/);
  });

  it('names the five that take a turn away', () => {
    expect(CONTROL_CONDITIONS).toEqual(['stunned', 'asleep', 'paralyzed', 'petrified', 'webbed']);
    expect(isControl('stunned')).toBe(true);
    expect(isControl('blinded')).toBe(false);
  });

  it('keeps the two ordered lists the combat engine walks', () => {
    // 06 section 4 steps 5 and 13.
    expect(START_OF_TURN_DAMAGE_ORDER).toEqual(['poisoned', 'burning', 'bleeding']);
    expect(END_OF_TURN_SAVE_ORDER).toEqual(['poisoned', 'burning', 'feared', 'paralyzed']);
  });

  it('gives the player words for every one of them', () => {
    for (const id of Object.keys(CONDITIONS)) {
      expect(t(`conditions.${id}.name`), id).not.toBe(`conditions.${id}.name`);
      expect(t(`conditions.${id}.effect`), id).not.toBe(`conditions.${id}.effect`);
    }
  });
});

describe('applying one', () => {
  it("takes the condition's own duration, or the one it is given", () => {
    const unit = hero();
    applyCondition(unit, 'blinded');
    expect(unit.conditions.blinded.rounds).toBe(2);

    applyCondition(unit, 'feared', { rounds: 4, dc: 13 });
    expect(unit.conditions.feared).toMatchObject({ rounds: 4, dc: 13 });
  });

  it('refreshes to the longer duration rather than adding', () => {
    // 06 section 10: "refreshes the duration to the longer of the two".
    const unit = hero();
    applyCondition(unit, 'blinded', { rounds: 3 });
    const again = applyCondition(unit, 'blinded', { rounds: 1 });
    expect(again.refreshed).toBe(true);
    expect(unit.conditions.blinded.rounds).toBe(3);

    applyCondition(unit, 'blinded', { rounds: 5 });
    expect(unit.conditions.blinded.rounds).toBe(5);
    expect(listed(unit)).toEqual(['blinded']);
  });

  it('lets a stronger version replace a weaker one', () => {
    // 06 section 10: the Brood Mother's 1d6 poison replaces normal 1d4.
    const unit = hero();
    applyCondition(unit, 'poisoned');
    applyCondition(unit, 'poisoned', { damage: '1d6' });
    expect(unit.conditions.poisoned.damage).toBe('1d6');
    // And a weaker one does not push it back down.
    applyCondition(unit, 'poisoned', { damage: '1d4' });
    expect(unit.conditions.poisoned.damage).toBe('1d6');
  });

  it('stacks Drained, and nothing else', () => {
    const unit = hero();
    applyCondition(unit, 'drained');
    applyCondition(unit, 'drained');
    applyCondition(unit, 'drained');
    expect(unit.conditions.drained.stacks).toBe(3);

    applyCondition(unit, 'weakened');
    applyCondition(unit, 'weakened');
    expect(unit.conditions.weakened.stacks).toBe(undefined);
  });

  it('refuses a condition the unit is immune to', () => {
    const unit = monster();
    unit.immunities = ['asleep'];
    expect(applyCondition(unit, 'asleep')).toEqual({ applied: false, why: 'immune' });
    expect(has(unit, 'asleep')).toBe(false);
    expect(blockedFrom(unit, 'asleep')).toBe('immune');
  });
});

describe('what they do', () => {
  it('makes a unit helpless, and attacks on it hit automatically', () => {
    for (const id of ['asleep', 'paralyzed', 'petrified']) {
      const unit = hero({ [id]: { rounds: 2 } });
      expect(isHelpless(unit), id).toBe(true);
      expect(defenceMods(unit).autoHit, id).toBe(true);
    }
    expect(isHelpless(hero({ blinded: { rounds: 2 } }))).toBe(false);
  });

  it('blocks exactly what the legality table blocks', () => {
    // 06 section 4: Feared blocks melee; Webbed blocks attacking and fleeing;
    // Grabbed blocks Flee and Swap.
    expect(blocks(hero({ feared: { rounds: null } }), 'melee')).toBe(true);
    expect(blocked(hero({ webbed: { rounds: null } })).sort()).toEqual(['attack', 'flee', 'swap']);
    expect(blocked(hero({ grabbed: { rounds: null } })).sort()).toEqual(['flee', 'swap']);
    // Blinded, Sickened and Knocked Down block nothing; they only hamper.
    for (const id of ['blinded', 'sickened', 'knockedDown']) {
      expect(blocked(hero({ [id]: { rounds: 2 } })), id).toEqual([]);
    }
  });

  it('adds up the DEF changes, the DR and the weapon penalty', () => {
    expect(defMod(hero({ slowed: { rounds: 2 } }))).toBe(-2);
    expect(defMod(hero({ slowed: { rounds: 2 }, knockedDown: { rounds: 1 } }))).toBe(-4);
    expect(drFrom(hero({ petrified: { rounds: 2 } }))).toBe(5);
    expect(halvesWeaponDamage(hero({ weakened: { rounds: null } }))).toBe(true);
    expect(actsLast(hero({ slowed: { rounds: 2 } }))).toBe(true);
  });

  it('knows which rolls are helped and which are hindered', () => {
    expect(attackMods(hero({ blinded: { rounds: 2 } })).disadvantage).toBe(true);
    expect(attackMods(hero({ sickened: { rounds: null } })).disadvantage).toBe(true);
    expect(attackMods(hero({ knockedDown: { rounds: 1 } })).disadvantage).toBe(true);
    expect(defenceMods(hero({ stunned: { rounds: 1 } })).advantage).toBe(true);
    expect(defenceMods(hero({ hidden: { rounds: 2 } })).disadvantage).toBe(true);
  });
});

describe('the clock', () => {
  it("ticks at the end of the unit's own turn", () => {
    const unit = hero();
    applyCondition(unit, 'blinded'); // 2 rounds
    tickDurations(unit);
    expect(unit.conditions.blinded.rounds).toBe(1);
    expect(tickDurations(unit)).toEqual(['blinded']);
    expect(has(unit, 'blinded')).toBe(false);
  });

  it('does not tick a condition applied during that same turn', () => {
    // 06 section 10: "A condition applied during the unit's own turn doesn't
    // tick until the end of its next turn."
    const unit = hero();
    applyCondition(unit, 'blinded', { onOwnTurn: true });
    tickDurations(unit);
    expect(unit.conditions.blinded.rounds).toBe(2);
    tickDurations(unit);
    expect(unit.conditions.blinded.rounds).toBe(1);
  });

  it('leaves conditions with no duration alone', () => {
    const unit = hero();
    applyCondition(unit, 'weakened');
    applyCondition(unit, 'bleeding');
    tickDurations(unit);
    tickDurations(unit);
    expect(listed(unit).sort()).toEqual(['bleeding', 'weakened']);
  });

  it('ends Sickened when the round ends, not on a turn', () => {
    const unit = hero();
    applyCondition(unit, 'sickened');
    tickDurations(unit);
    expect(has(unit, 'sickened')).toBe(true);
    expect(endOfRound(unit)).toEqual(['sickened']);
  });

  it('deals start-of-turn damage in the documented order', () => {
    const unit = hero();
    applyCondition(unit, 'bleeding');
    applyCondition(unit, 'burning');
    applyCondition(unit, 'poisoned');
    // 1d4 then 1d6 then the flat 2 (06 section 4 step 5).
    const rolls = startOfTurnDamage(unit, fakeRng(3, 5));
    expect(rolls.map((r) => r.id)).toEqual(['poisoned', 'burning', 'bleeding']);
    expect(rolls.map((r) => r.amount)).toEqual([3, 5, 2]);
  });

  it('rolls end-of-turn saves in order, and a natural 20 always works', () => {
    const unit = hero();
    applyCondition(unit, 'poisoned', { dc: 30 });
    applyCondition(unit, 'feared', { dc: 12 });

    const results = endOfTurnSaves(unit, fakeRng(20, 11), () => 0);
    expect(results.map((r) => r.id)).toEqual(['poisoned', 'feared']);
    // 06 section 8: a natural 20 always succeeds, however high the DC.
    expect(results[0].passed).toBe(true);
    expect(has(unit, 'poisoned')).toBe(false);
    // And 11 against DC 12 fails, so Feared stays.
    expect(results[1].passed).toBe(false);
    expect(has(unit, 'feared')).toBe(true);
  });

  it('fails a save on a natural 1, whatever the bonus', () => {
    const unit = hero();
    applyCondition(unit, 'poisoned', { dc: 5 });
    const [result] = endOfTurnSaves(unit, fakeRng(1), () => 10);
    expect(result.passed).toBe(false);
    expect(has(unit, 'poisoned')).toBe(true);
  });
});

describe('control immunity', () => {
  it('opens for two turns when a control condition ends on the hero', () => {
    const unit = hero();
    applyCondition(unit, 'asleep');
    const { immuneFor } = endCondition(unit, 'asleep');
    expect(immuneFor).toBe(CONTROL_IMMUNITY_TURNS);
    expect(applyCondition(unit, 'asleep')).toEqual({ applied: false, why: 'controlImmunity' });

    tickControlImmunity(unit);
    expect(blockedFrom(unit, 'asleep')).toBe('controlImmunity');
    expect(tickControlImmunity(unit)).toEqual(['asleep']);
    expect(applyCondition(unit, 'asleep').applied).toBe(true);
  });

  it('covers only that one condition', () => {
    const unit = hero();
    applyCondition(unit, 'webbed');
    endCondition(unit, 'webbed');
    expect(applyCondition(unit, 'webbed').applied).toBe(false);
    expect(applyCondition(unit, 'stunned').applied).toBe(true);
  });

  it("is the hero's alone: a monster gets no window", () => {
    const rat = monster();
    applyCondition(rat, 'asleep');
    expect(endCondition(rat, 'asleep').immuneFor).toBe(undefined);
    expect(applyCondition(rat, 'asleep').applied).toBe(true);
  });
});

describe('the turn a condition takes away', () => {
  it('spends the turn on Stunned, then removes it and opens immunity', () => {
    // 06 section 4 step 4.
    const unit = hero();
    applyCondition(unit, 'stunned');
    const turn = startOfTurn(unit);
    expect(turn).toMatchObject({ acts: false, lost: 'stunned', immuneFor: 2 });
    expect(has(unit, 'stunned')).toBe(false);
    expect(unit.lostTurns).toBe(1);
  });

  it('loses the turn while helpless, and keeps the condition', () => {
    const unit = hero();
    applyCondition(unit, 'paralyzed', { dc: 12 });
    expect(startOfTurn(unit)).toMatchObject({ acts: false, lost: 'paralyzed' });
    expect(has(unit, 'paralyzed')).toBe(true);
  });

  it('acts, and resets the run, when nothing holds the unit', () => {
    const unit = hero();
    unit.lostTurns = 1;
    expect(startOfTurn(unit)).toEqual({ acts: true });
    expect(unit.lostTurns).toBe(0);
  });
});

describe('Grit', () => {
  it('never lets the hero lose a third turn in a row', () => {
    // 01, Solo Hero Protections: "the hero never loses more than 2 turns in a
    // row. On the third turn, all of those conditions end and the hero acts."
    const unit = hero();
    applyCondition(unit, 'paralyzed', { dc: 20 });

    expect(startOfTurn(unit).acts).toBe(false);
    expect(startOfTurn(unit).acts).toBe(false);
    expect(unit.lostTurns).toBe(GRIT_LOST_TURNS);

    const third = startOfTurn(unit);
    expect(third.acts).toBe(true);
    expect(third.grit).toEqual(['paralyzed']);
    expect(has(unit, 'paralyzed')).toBe(false);
    expect(unit.lostTurns).toBe(0);
  });

  it('frees every control condition at once, and grants no immunity for it', () => {
    const unit = hero();
    applyCondition(unit, 'asleep');
    applyCondition(unit, 'webbed');
    unit.lostTurns = 2;

    const turn = startOfTurn(unit);
    expect(turn.grit.sort()).toEqual(['asleep', 'webbed']);
    // Grit is not the condition "ending" in the sense control immunity means,
    // so the hero can be caught again straight away.
    expect(unit.controlImmunity).toEqual({});
  });

  it("is the hero's alone: a monster can be locked down for ever", () => {
    const rat = monster();
    applyCondition(rat, 'paralyzed', { dc: 20 });
    for (let i = 0; i < 5; i += 1) expect(startOfTurn(rat).acts).toBe(false);
    expect(has(rat, 'paralyzed')).toBe(true);
  });

  it('counts a run of lost turns, not lost turns in total', () => {
    const unit = hero();
    applyCondition(unit, 'stunned');
    startOfTurn(unit); // lost
    acted(unit); // then acted
    expect(unit.lostTurns).toBe(0);
  });
});

describe('what ends one early', () => {
  it('wakes a sleeper with damage, but not the paralysed', () => {
    const sleeper = hero({ asleep: { rounds: 3 } });
    expect(onDamageTaken(sleeper)).toEqual(['asleep']);

    const frozen = hero({ paralyzed: { rounds: null } });
    expect(onDamageTaken(frozen)).toEqual([]);
  });

  it('ends Bleeding with any healing at all', () => {
    const unit = hero({ bleeding: { rounds: null }, poisoned: { rounds: 3 } });
    expect(onHealed(unit)).toEqual(['bleeding']);
    expect(has(unit, 'poisoned')).toBe(true);
  });

  it('frees a grabbed hero who hits what holds them', () => {
    const unit = hero();
    applyCondition(unit, 'grabbed', { source: 'ogre' });
    expect(onHitting(unit, 'rat')).toEqual([]);
    expect(onHitting(unit, 'ogre')).toEqual(['grabbed']);
  });

  it('burns a web away, for 1d4', () => {
    const unit = hero({ webbed: { rounds: null } });
    const result = onFireDamage(unit, fakeRng(3));
    expect(result).toEqual({ freed: 'webbed', damage: 3 });
    expect(has(unit, 'webbed')).toBe(false);
    expect(onFireDamage(hero(), fakeRng(3))).toBe(null);
  });

  it('breaks free on a 12 or better, and costs the action either way', () => {
    const unit = hero({ webbed: { rounds: null } });
    expect(breakFree(unit, fakeRng(8), 2)).toMatchObject({ total: 10, tn: 12, freed: false });
    expect(has(unit, 'webbed')).toBe(true);
    expect(breakFree(unit, fakeRng(10), 2)).toMatchObject({ total: 12, freed: true });
    expect(has(unit, 'webbed')).toBe(false);
  });

  it('ends Hidden when the hero acts, and Knocked Down after they attack', () => {
    const unit = hero({ hidden: { rounds: 2 }, knockedDown: { rounds: 1 } });
    expect(onOwnAction(unit, { attacked: false })).toEqual(['hidden']);
    expect(has(unit, 'knockedDown')).toBe(true);
    expect(onOwnAction(unit, { attacked: true })).toEqual(['knockedDown']);
  });
});

describe('after the fight', () => {
  it('keeps Weakened and Drained, carries Poisoned outside, ends the rest', () => {
    // 06 section 10, After Combat.
    const unit = hero();
    applyCondition(unit, 'weakened');
    applyCondition(unit, 'drained');
    applyCondition(unit, 'poisoned', { dc: 12 });
    applyCondition(unit, 'blinded');
    applyCondition(unit, 'hidden');
    unit.controlImmunity = { asleep: 2 };

    const result = afterCombat(unit);
    expect(result.kept.sort()).toEqual(['drained', 'weakened']);
    expect(result.exploration).toEqual(['poisoned']);
    expect(result.ended.sort()).toEqual(['blinded', 'hidden']);
    expect(listed(unit).sort()).toEqual(['drained', 'poisoned', 'weakened']);
    expect(unit.controlImmunity).toEqual({});
  });

  it('knows what exploration poison costs', () => {
    // 06 section 10: 1d4 every 10 steps until cured or saved against.
    expect(EXPLORATION_POISON).toMatchObject({ damage: '1d4', everySteps: 10, save: 'body' });
  });
});

describe("a fight's worth of turns", () => {
  it('plays the same way from the same seed', () => {
    const play = () => {
      const rng = createStream(99, 'combat');
      const unit = hero();
      applyCondition(unit, 'poisoned', { dc: 12 });
      applyCondition(unit, 'burning', { dc: 12 });
      const story = [];
      for (let turn = 0; turn < 6; turn += 1) {
        const start = startOfTurn(unit);
        story.push(start.acts ? 'acts' : `lost ${start.lost}`);
        if (start.acts) {
          story.push(startOfTurnDamage(unit, rng).map((d) => `${d.id} ${d.amount}`).join(','));
          story.push(endOfTurnSaves(unit, rng, () => 1).map((s) => `${s.id} ${s.passed}`).join(','));
        }
        story.push(tickDurations(unit).join(','));
        tickControlImmunity(unit);
      }
      return story;
    };
    expect(play()).toEqual(play());
  });
});
