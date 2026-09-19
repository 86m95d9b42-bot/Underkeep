/**
 * Resolving an attack (`06` section 6), step by step.
 *
 * The d20 is stubbed almost everywhere, because what is being checked is the
 * order of the ten steps and what each one decides — not the dice.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { registerConditionHooks } from '../src/engine/condition-hooks.js';
import { createCombat } from '../src/engine/field.js';
import {
  ATTACK,
  attackBonus,
  canReach,
  coverPenalty,
  critFrom,
  defenceOf,
  judge,
  resolveAction,
  resolveAttack,
  resolveAttacks,
} from '../src/engine/attack.js';
import { defend } from '../src/engine/turn.js';
import { applyCondition } from '../src/engine/conditions.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  hp: 12,
  maxHp: 12,
  fp: 4,
  maxFp: 4,
  atk: 3,
  def: 12,
  protected: true,
  ...extra,
});
const monster = (type, extra = {}) => ({ type, hp: 6, maxHp: 6, atk: 2, def: 11, row: 'front', ...extra });

/** A fight with the condition hooks registered, as the engine registers them. */
function fight({ monsters = [monster('rat')], hero = {}, seed = 'attack' } = {}) {
  const hooks = createHooks();
  const rng = createStream(seed, 'combat');
  const combat = createCombat({ hero: heroTemplate(hero), monsters, rng, hooks, surprise: false });
  registerConditionHooks(hooks, { rng, hurt: (unit, amount) => { unit.hp -= amount; } });
  combat.round = 1;
  return combat;
}

/** Makes the d20 give exactly these naturals, in order. */
function rolls(combat, ...naturals) {
  const queue = [...naturals];
  combat.rng.d20 = () => (queue.length > 1 ? queue.shift() : queue[0]);
}

/** A damage service that takes a flat amount off, standing in for section 7. */
const hitFor = (amount) => (combat, { target }) => {
  target.hp -= amount;
  return { amount };
};

describe('step 1: declare', () => {
  it('takes the target by id or by unit, and picks one when none is named', () => {
    const combat = fight({ monsters: [monster('rat'), monster('kobold')] });
    rolls(combat, 15);
    expect(resolveAttack(combat, combat.hero, { target: 'kobold-1' }).target).toBe('kobold-1');
    expect(resolveAttack(combat, combat.hero, { target: combat.units[1] }).target).toBe('rat-1');
    expect(resolveAttack(combat, combat.hero, {}).target).toBe('rat-1');
  });

  it('has nothing to resolve with no enemy standing', () => {
    const combat = fight();
    combat.units[1].alive = false;
    expect(resolveAttack(combat, combat.hero, {})).toMatchObject({ hit: false, why: 'noTarget' });
  });
});

describe('step 2: redirect', () => {
  it('lets a hook take the blow instead, the way Guardian does', () => {
    const combat = fight({ monsters: [monster('rat'), monster('kobold')] });
    rolls(combat, 15);
    combat.hooks.on('beforeAction', (payload) => {
      if (payload.phase === 'redirect') payload.target = combat.units[2];
    }, { name: 'guardian' });
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' }).target).toBe('kobold-1');
  });

  it('lets a hook stop the attack outright', () => {
    const combat = fight();
    combat.hooks.on('beforeAction', (payload) => payload.cancel('counterspell'), { name: 'counterspell' });
    expect(resolveAttack(combat, combat.hero, {})).toMatchObject({ legal: false, why: 'counterspell' });
  });
});

describe('step 3: legality', () => {
  it('refuses the back row to a melee attack while the front row stands', () => {
    const combat = fight({ monsters: [monster('rat'), monster('archer', { row: 'back' })] });
    expect(canReach(combat, combat.hero, combat.units[2], { kind: 'melee' })).toMatchObject({
      legal: false,
      why: 'badTarget',
    });
    expect(canReach(combat, combat.hero, combat.units[2], { kind: 'ranged' }).legal).toBe(true);
    expect(canReach(combat, combat.hero, combat.units[2], { kind: 'melee', reach: true }).legal).toBe(true);
  });

  it('refuses a unit that has left the field, or cannot be touched', () => {
    const combat = fight({ monsters: [monster('rat'), monster('lich', { row: 'back' })] });
    combat.units[1].fled = true;
    expect(canReach(combat, combat.hero, combat.units[1], {}).why).toBe('gone');
    combat.units[2].untargetable = true;
    expect(canReach(combat, combat.hero, combat.units[2], { kind: 'ranged' }).why).toBe('untargetable');
  });

  it('refuses the attacker its own side', () => {
    const combat = fight({ monsters: [monster('rat'), monster('kobold')] });
    expect(canReach(combat, combat.units[1], combat.units[2], {}).why).toBe('ownSide');
  });
});

describe('step 4: auto-hit', () => {
  it('hits a helpless target without comparing anything', () => {
    const combat = fight();
    const rat = combat.units[1];
    applyCondition(rat, 'asleep');
    rolls(combat, 2);
    const result = resolveAttack(combat, combat.hero, { target: 'rat-1' }, { damage: hitFor(3) });
    expect(result).toMatchObject({ hit: true, autoHit: true });
    expect(rat.hp).toBe(3);
  });

  it('still rolls the d20, but only to see whether it crits', () => {
    const combat = fight();
    applyCondition(combat.units[1], 'asleep');
    rolls(combat, 20);
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' })).toMatchObject({
      hit: true,
      crit: true,
      autoHit: true,
    });
  });

  it('never lets the hero be critically hit while helpless', () => {
    const combat = fight();
    applyCondition(combat.hero, 'paralyzed', { dc: 12 });
    rolls(combat, 20);
    const result = resolveAttack(combat, combat.units[1], { target: 'hero' });
    expect(result).toMatchObject({ hit: true, autoHit: true, crit: false });
  });

  it('takes an attack that says it always hits', () => {
    const combat = fight();
    rolls(combat, 3);
    expect(resolveAttack(combat, combat.hero, { autoHit: true, canCrit: false }).hit).toBe(true);
  });
});

describe('steps 6 and 7: naturals and the comparison', () => {
  it('misses on a natural 1, however big the bonus', () => {
    expect(judge(1, 99, 10)).toMatchObject({ hit: false, crit: false, natural: 'miss' });
  });

  it('hits and crits on a natural 20, however big the DEF', () => {
    expect(judge(20, 21, 99)).toMatchObject({ hit: true, crit: true, natural: 'hit' });
  });

  it('hits when the total reaches DEF, and misses one short', () => {
    expect(judge(12, 15, 15).hit).toBe(true);
    expect(judge(12, 14, 15).hit).toBe(false);
  });

  it('crits inside the crit range, and only on a hit', () => {
    expect(judge(19, 22, 15, { critFrom: 19 }).crit).toBe(true);
    expect(judge(19, 22, 15, { critFrom: 20 }).crit).toBe(false);
    // A 19 that does not reach DEF is a miss, crit range or not.
    expect(judge(19, 10, 25, { critFrom: 19 })).toMatchObject({ hit: false, crit: false });
  });

  it('adds the attacker bonus to the natural', () => {
    const combat = fight();
    rolls(combat, 9);
    // 9 + 3 (the hero's atk) = 12, against a rat's DEF 11.
    const result = resolveAttack(combat, combat.hero, { target: 'rat-1' });
    expect(result).toMatchObject({ roll: 9, total: 12, def: 11, hit: true });
  });

  it('counts Defend, Slowed and Knocked Down in the DEF it has to beat', () => {
    const combat = fight();
    const rat = combat.units[1];
    expect(defenceOf(rat)).toBe(11);
    applyCondition(rat, 'slowed');
    expect(defenceOf(rat)).toBe(9);
    defend(combat.hero);
    expect(defenceOf(combat.hero)).toBe(16);
  });
});

describe('the attack modifiers table', () => {
  it('costs −2 for half cover against the back row', () => {
    const combat = fight({ monsters: [monster('rat'), monster('archer', { row: 'back' })] });
    const archer = combat.units[2];
    expect(coverPenalty(combat, combat.hero, archer, { kind: 'ranged' })).toBe(-2);
    expect(coverPenalty(combat, combat.hero, archer, { kind: 'spell' })).toBe(-2);
    // Nothing in the front row: no cover.
    combat.units[1].alive = false;
    expect(coverPenalty(combat, combat.hero, archer, { kind: 'ranged' })).toBe(0);
  });

  it('does not charge cover to an auto-hit spell or to a melee attack', () => {
    const combat = fight({ monsters: [monster('rat'), monster('archer', { row: 'back' })] });
    const archer = combat.units[2];
    expect(coverPenalty(combat, combat.hero, archer, { kind: 'spell', autoHit: true })).toBe(0);
    expect(coverPenalty(combat, combat.hero, archer, { kind: 'melee' })).toBe(0);
  });

  it('costs −2 for a weapon the hero cannot handle', () => {
    const combat = fight();
    rolls(combat, 8);
    // 8 + 3 = 11 hits DEF 11; with the requirement unmet it is 9 and misses.
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' }).hit).toBe(true);
    expect(
      resolveAttack(combat, combat.hero, { target: 'rat-1', requirementMet: false }),
    ).toMatchObject({ total: 9, hit: false });
  });

  it('rolls with advantage against a stunned target', () => {
    const combat = fight();
    let options = null;
    combat.rng.d20 = (given = {}) => {
      options = given;
      return 10;
    };
    applyCondition(combat.units[1], 'stunned');
    resolveAttack(combat, combat.hero, { target: 'rat-1' });
    expect(options).toEqual({ advantage: true, disadvantage: false });
  });

  it('rolls with disadvantage while the attacker is Blinded', () => {
    const combat = fight();
    let options = null;
    combat.rng.d20 = (given = {}) => {
      options = given;
      return 10;
    };
    applyCondition(combat.hero, 'blinded');
    resolveAttack(combat, combat.hero, { target: 'rat-1' });
    expect(options).toEqual({ advantage: false, disadvantage: true });
  });
});

describe('step 8: the defender reactions', () => {
  it('lets Lucky throw the die again', () => {
    const combat = fight();
    rolls(combat, 2, 18);
    let used = false;
    combat.hooks.on('attackRoll', (payload) => {
      if (payload.phase !== 'judge' || payload.hit || used) return;
      used = true;
      payload.reroll = true;
    }, { name: 'lucky' });
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' })).toMatchObject({
      roll: 18,
      hit: true,
    });
  });

  it('gives up rerolling rather than looping for ever', () => {
    const combat = fight();
    rolls(combat, 2);
    let rerolls = 0;
    combat.hooks.on('attackRoll', (payload) => {
      if (payload.phase !== 'judge') return;
      rerolls += 1;
      payload.reroll = true;
    }, { name: 'lucky' });
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' }).hit).toBe(false);
    expect(rerolls).toBe(ATTACK.maxRerolls + 1);
  });

  it('lets Arcane Shield add DEF and compare again', () => {
    const combat = fight();
    rolls(combat, 9); // 12 against DEF 11: a hit, until the shield goes up.
    combat.hooks.on('attackRoll', (payload) => {
      if (payload.phase === 'judge') payload.bonusDef = 4;
    }, { name: 'arcaneShield' });
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' })).toMatchObject({
      hit: false,
      def: 15,
    });
  });

  it('cannot take away a natural 20 with more DEF', () => {
    const combat = fight();
    rolls(combat, 20);
    combat.hooks.on('attackRoll', (payload) => {
      if (payload.phase === 'judge') payload.bonusDef = 20;
    }, { name: 'shieldBlock' });
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' }).hit).toBe(true);
  });

  it('lets Blink turn a hit into a miss', () => {
    const combat = fight();
    rolls(combat, 18);
    combat.hooks.on('attackRoll', (payload) => {
      if (payload.phase === 'judge') payload.hit = false;
    }, { name: 'blink' });
    const result = resolveAttack(combat, combat.hero, { target: 'rat-1' }, { damage: hitFor(3) });
    expect(result).toMatchObject({ hit: false, turned: true });
    expect(combat.units[1].hp).toBe(6);
  });
});

describe('steps 9 and 10: what a hit and a miss set off', () => {
  it('asks the damage service for the damage, and fires hit on a survivor', () => {
    const combat = fight();
    rolls(combat, 15);
    const fired = [];
    for (const event of ['hit', 'miss', 'kill']) {
      combat.hooks.on(event, () => fired.push(event), { name: 'rider' });
    }
    const damage = vi.fn(hitFor(2));
    const result = resolveAttack(combat, combat.hero, { target: 'rat-1' }, { damage });
    expect(damage).toHaveBeenCalledOnce();
    expect(result.damage).toEqual({ amount: 2 });
    expect(fired).toEqual(['hit']);
  });

  it('fires kill, not hit, when the blow takes the last hit point', () => {
    const combat = fight();
    rolls(combat, 15);
    const fired = [];
    for (const event of ['hit', 'kill']) combat.hooks.on(event, () => fired.push(event), { name: 'rider' });
    const result = resolveAttack(combat, combat.hero, { target: 'rat-1' }, { damage: hitFor(6) });
    expect(result.killed).toBe(true);
    expect(combat.units[1].alive).toBe(false);
    expect(fired).toEqual(['kill']);
  });

  it('lets a zeroHP hook keep the monster on its feet', () => {
    const combat = fight();
    rolls(combat, 15);
    combat.hooks.on('zeroHP', (payload) => {
      payload.saved = true;
      payload.savedBy = 'ferocity';
      payload.unit.hp = 1;
    }, { name: 'ferocity' });
    const result = resolveAttack(combat, combat.hero, { target: 'rat-1' }, { damage: hitFor(6) });
    expect(result.killed).toBeUndefined();
    expect(combat.units[1].alive).toBe(true);
  });

  it('fires miss, for Riposte', () => {
    const combat = fight();
    rolls(combat, 2);
    const fired = [];
    combat.hooks.on('miss', () => fired.push('riposte'), { name: 'riposte' });
    expect(resolveAttack(combat, combat.hero, { target: 'rat-1' }).hit).toBe(false);
    expect(fired).toEqual(['riposte']);
  });
});

describe('multiple attacks', () => {
  it('resolves each one completely before the next begins', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 4, maxHp: 4 })] });
    rolls(combat, 15);
    const seen = [];
    const results = resolveAttacks(
      combat,
      combat.hero,
      { attacks: 2, target: 'rat-1' },
      {
        damage: (c, { target }) => {
          seen.push(target.hp);
          target.hp -= 3;
          return { amount: 3 };
        },
      },
    );
    expect(seen).toEqual([4, 1]);
    expect(results).toHaveLength(2);
  });

  it('lets the next attack pick a new target when the first one kills', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 2, maxHp: 2 }), monster('kobold')] });
    rolls(combat, 15);
    const results = resolveAttacks(
      combat,
      combat.hero,
      { attacks: 2, target: 'rat-1' },
      { damage: hitFor(3) },
    );
    expect(results.map((row) => row.target)).toEqual(['rat-1', 'kobold-1']);
  });

  it('loses the rest when there is nothing else to hit', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 2, maxHp: 2 })] });
    rolls(combat, 15);
    const results = resolveAttacks(
      combat,
      combat.hero,
      { attacks: 3, target: 'rat-1' },
      { damage: hitFor(3) },
    );
    expect(results).toHaveLength(1);
  });
});

describe('the numbers', () => {
  it('reads the attack bonus off the unit, and the crit range off the sheet', () => {
    expect(attackBonus({ atk: 4 }, {})).toBe(4);
    expect(attackBonus({ atk: 4 }, { bonus: 7 })).toBe(7);
    expect(critFrom({ critFrom: 19 }, {})).toBe(19);
    expect(critFrom({}, {})).toBe(20);
  });
});

describe('what the turn calls', () => {
  it('sends an attack action through section 6 and leaves the rest alone', () => {
    const combat = fight();
    rolls(combat, 15);
    expect(resolveAction(combat, combat.hero, { id: 'attack', target: 'rat-1' }).hit).toBe(true);
    expect(resolveAction(combat, combat.hero, { id: 'defend' })).toBe(null);
  });

  it('runs a whole hero turn that lands a blow', async () => {
    const { takeHeroTurn } = await import('../src/engine/turn.js');
    const combat = fight();
    rolls(combat, 15);
    const record = takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'attack', kind: 'melee', target: 'rat-1' }),
      resolveAction: (c, unit, action) => resolveAction(c, unit, action, { damage: hitFor(4) }),
    });
    expect(record.acted).toBe(true);
    expect(combat.units[1].hp).toBe(2);
  });
});
