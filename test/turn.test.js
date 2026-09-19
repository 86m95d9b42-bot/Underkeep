/**
 * The hero's turn and a monster's turn (`06` sections 4 and 5).
 *
 * Both are numbered step lists, and the numbers are what these tests check:
 * what happens before what, which steps a lost turn skips, and which of them
 * still run when the turn is gone.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { registerConditionHooks } from '../src/engine/condition-hooks.js';
import { createCombat } from '../src/engine/field.js';
import {
  DEFEND,
  cancelTelegraph,
  defend,
  defendBonus,
  rechargeAbilities,
  takeHeroTurn,
  takeMonsterTurn,
  takeTurn,
  telegraph,
  telegraphDue,
} from '../src/engine/turn.js';
import { applyCondition, has } from '../src/engine/conditions.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  hp: 12,
  maxHp: 12,
  fp: 4,
  maxFp: 4,
  protected: true,
  ...extra,
});
const monster = (type, extra = {}) => ({ type, hp: 6, maxHp: 6, row: 'front', ...extra });

/**
 * A fight with the condition hooks wired up the way the engine wires them:
 * start-of-turn damage reaches HP through `hurt`.
 */
function fight({ monsters = [monster('rat')], hero = {}, seed = 'turn' } = {}) {
  const hooks = createHooks();
  const rng = createStream(seed, 'combat');
  const combat = createCombat({ hero: heroTemplate(hero), monsters, rng, hooks, surprise: false });
  registerConditionHooks(hooks, {
    rng,
    hurt: (unit, amount) => {
      unit.hp -= amount;
    },
  });
  combat.round = 1;
  return combat;
}

const types = (record) => record.steps.map((entry) => entry.type);

describe("the hero's turn, step by step", () => {
  it('runs the documented order on an ordinary turn', () => {
    const combat = fight();
    const record = takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'defend' }),
    });
    expect(types(record)).toEqual(['defend', 'action']);
    expect(record.acted).toBe(true);
  });

  it('ends the Defend bonus from last turn before anything else', () => {
    const combat = fight();
    defend(combat.hero);
    expect(defendBonus(combat.hero)).toBe(DEFEND.def);
    const record = takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });
    expect(types(record)[0]).toBe('defendEnds');
    expect(defendBonus(combat.hero)).toBe(0);
  });

  it('takes start-of-turn damage before the death check, so poison can kill', () => {
    const combat = fight({ hero: { hp: 2 } });
    applyCondition(combat.hero, 'poisoned', { dc: 12, damage: '1d4' });
    const chooseAction = vi.fn();
    const record = takeHeroTurn(combat, combat.hero, { chooseAction });
    expect(types(record)).toEqual(['turnDamage', 'died']);
    expect(combat.hero.alive).toBe(false);
    // A hero who dies at the start of their turn never gets the menu.
    expect(chooseAction).not.toHaveBeenCalled();
  });

  it('loses the turn to Stunned, removes it, and opens the immunity window', () => {
    const combat = fight();
    applyCondition(combat.hero, 'stunned');
    const record = takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'attack' }) });
    expect(record).toMatchObject({ acted: false, lost: 'stunned' });
    expect(has(combat.hero, 'stunned')).toBe(false);
    // The window opened on this same turn, so step 15 leaves it alone: two
    // whole turns of protection, not one and a half.
    expect(combat.hero.controlImmunity.stunned).toBe(2);
    expect(combat.hero.lostTurns).toBe(1);
  });

  it('loses the turn to Asleep, and keeps the condition', () => {
    const combat = fight();
    applyCondition(combat.hero, 'asleep');
    const record = takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'attack' }) });
    expect(record).toMatchObject({ acted: false, lost: 'asleep' });
    expect(has(combat.hero, 'asleep')).toBe(true);
  });

  it('tears free with Grit after two lost turns', () => {
    const combat = fight();
    applyCondition(combat.hero, 'asleep');
    expect(takeHeroTurn(combat, combat.hero, {}).lost).toBe('asleep');
    expect(takeHeroTurn(combat, combat.hero, {}).lost).toBe('asleep');
    const third = takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });
    expect(third.acted).toBe(true);
    expect(third.steps[0]).toMatchObject({ type: 'grit', conditions: ['asleep'] });
    expect(has(combat.hero, 'asleep')).toBe(false);
    // Grit is not an immunity window: the hero can be caught again at once.
    expect(combat.hero.controlImmunity.asleep).toBeUndefined();
  });

  it('still ticks durations and saves on a turn it lost', () => {
    const combat = fight();
    applyCondition(combat.hero, 'stunned');
    applyCondition(combat.hero, 'blinded');
    const before = combat.hero.conditions.blinded.rounds;
    takeHeroTurn(combat, combat.hero, {});
    expect(combat.hero.conditions.blinded.rounds).toBe(before - 1);
  });

  it('resets the lost-turn counter once the hero acts', () => {
    const combat = fight();
    applyCondition(combat.hero, 'stunned');
    takeHeroTurn(combat, combat.hero, {});
    expect(combat.hero.lostTurns).toBe(1);
    takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });
    expect(combat.hero.lostTurns).toBe(0);
  });
});

describe('Hidden', () => {
  it('ends at the start of the turn after it has covered two of them', () => {
    const combat = fight();
    applyCondition(combat.hero, 'hidden', { onOwnTurn: true });
    takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });
    expect(has(combat.hero, 'hidden')).toBe(true);
    const second = takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });
    expect(types(second)).toContain('hiddenEnds');
    expect(has(combat.hero, 'hidden')).toBe(false);
  });

  it('ends the moment the hero attacks, through the beforeAction hook', () => {
    const combat = fight();
    applyCondition(combat.hero, 'hidden', { onOwnTurn: true });
    takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'attack', kind: 'melee', target: 'rat-1' }),
      resolveAction: () => ({ hit: true }),
    });
    expect(has(combat.hero, 'hidden')).toBe(false);
  });
});

describe('the action', () => {
  it('pays its Focus before it resolves', () => {
    const combat = fight();
    let fpWhenResolved = null;
    takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'skill', tags: ['spirit'], fp: 2 }),
      resolveAction: (c) => {
        fpWhenResolved = c.hero.fp;
      },
    });
    expect(fpWhenResolved).toBe(2);
    expect(combat.hero.fp).toBe(2);
  });

  it('refuses an illegal one with its reason, and resolves nothing', () => {
    const combat = fight();
    applyCondition(combat.hero, 'webbed');
    const resolveAction = vi.fn();
    const record = takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'attack', kind: 'melee' }),
      resolveAction,
    });
    expect(record.steps[0]).toMatchObject({ type: 'illegal', why: 'webbed' });
    expect(resolveAction).not.toHaveBeenCalled();
  });

  it('can be cancelled by a beforeAction hook, the way Counterspell does', () => {
    const combat = fight();
    combat.hooks.on('beforeAction', (payload) => payload.cancel('counterspell'), {
      name: 'counterspell',
    });
    const resolveAction = vi.fn();
    const record = takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'attack', kind: 'melee' }),
      resolveAction,
    });
    expect(record.steps[0]).toMatchObject({ type: 'cancelled', by: 'counterspell' });
    expect(resolveAction).not.toHaveBeenCalled();
  });

  it('allows one free action beside the main one, and refuses a second', () => {
    const combat = fight();
    const record = takeHeroTurn(combat, combat.hero, {
      chooseAction: () => [
        { id: 'item', free: true },
        { id: 'attack', kind: 'melee', target: 'rat-1' },
        { id: 'item', free: true },
      ],
      resolveAction: () => ({}),
    });
    const refused = record.steps.filter((entry) => entry.type === 'illegal');
    expect(refused).toHaveLength(1);
    expect(refused[0].why).toBe('freeUsed');
  });

  it('Defend gives +4 DEF and 1 FP back', () => {
    const combat = fight({ hero: { fp: 1 } });
    takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'defend' }) });
    expect(combat.hero.fp).toBe(2);
    expect(defendBonus(combat.hero)).toBe(4);
  });

  it('Break Free rolls d20 + the better modifier against TN 12', () => {
    const combat = fight();
    applyCondition(combat.hero, 'webbed');
    combat.rng.d20 = () => 9;
    const record = takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'breakFree', bonus: 3 }),
    });
    expect(record.steps[0]).toMatchObject({ type: 'breakFree', total: 12, tn: 12, freed: true });
    expect(has(combat.hero, 'webbed')).toBe(false);
  });
});

describe("a monster's turn, step by step", () => {
  it('leaves the field when it is fleeing, dropping half its gold', () => {
    const combat = fight({ monsters: [monster('kobold', { gold: 7, fleeing: true })] });
    const record = takeMonsterTurn(combat, combat.units[1], {});
    expect(record.steps[0]).toMatchObject({ type: 'fled', gold: 3 });
    expect(combat.units[1].fled).toBe(true);
    expect(combat.droppedGold).toBe(3);
  });

  it('loses its turn to Stunned, and has no Grit to save it', () => {
    const combat = fight();
    const rat = combat.units[1];
    for (let i = 0; i < 3; i += 1) {
      applyCondition(rat, 'stunned');
      expect(takeMonsterTurn(combat, rat, {}).lost).toBe('stunned');
    }
    expect(rat.lostTurns).toBe(3);
  });

  it('rolls recharges only once it is certainly acting', () => {
    const combat = fight({
      monsters: [monster('kobold', { abilities: [{ id: 'breath', recharges: true, ready: false }] })],
    });
    const kobold = combat.units[1];
    applyCondition(kobold, 'asleep');
    takeMonsterTurn(combat, kobold, {});
    expect(kobold.abilities[0].ready).toBe(false);
  });

  it('runs its script when nothing is waiting', () => {
    const combat = fight();
    const script = vi.fn(() => ({ id: 'attack', kind: 'melee', target: 'hero' }));
    const resolveAction = vi.fn(() => ({ hit: false }));
    takeMonsterTurn(combat, combat.units[1], { script, resolveAction });
    expect(script).toHaveBeenCalled();
    expect(resolveAction).toHaveBeenCalled();
  });
});

describe('recharge rolls (06 section 5 step 6)', () => {
  const rollsOf = (...rolls) => {
    const queue = [...rolls];
    return { die: () => queue.shift() };
  };

  it('bring an ability back on a 5 or 6, and not on a 4', () => {
    const unit = {
      abilities: [
        { id: 'a', recharges: true, ready: false },
        { id: 'b', recharges: true, ready: false },
      ],
    };
    expect(rechargeAbilities(unit, rollsOf(4, 5))).toEqual(['b']);
    expect(unit.abilities[0].ready).toBe(false);
  });

  it('leave an ability that is already ready alone', () => {
    const unit = { abilities: [{ id: 'a', recharges: true, ready: true }] };
    expect(rechargeAbilities(unit, rollsOf(6))).toEqual([]);
  });

  it('widen to 4-6 for a monster that is nearly dead, as Vyrmathrax does', () => {
    const unit = {
      hp: 9,
      maxHp: 100,
      desperateRechargeFrom: 4,
      abilities: [{ id: 'breath', recharges: true, ready: false }],
    };
    expect(rechargeAbilities(unit, rollsOf(4))).toEqual(['breath']);
  });
});

describe('telegraphs (06 section 5, Telegraph Timing)', () => {
  it('waits for the hero to have a turn, however initiative falls', () => {
    const combat = fight();
    const rat = combat.units[1];
    telegraph(combat, rat, 'slam');
    // The monster acts again in the next round before the hero: still waiting.
    expect(telegraphDue(combat, rat)).toBe(null);
    takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });
    expect(telegraphDue(combat, rat)).toMatchObject({ ability: 'slam' });
  });

  it('resolves instead of the script, once', () => {
    const combat = fight();
    const rat = combat.units[1];
    telegraph(combat, rat, 'slam');
    takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });

    const script = vi.fn();
    const resolveAction = vi.fn();
    const record = takeMonsterTurn(combat, rat, { script, resolveAction });
    expect(types(record)).toContain('telegraphResolves');
    expect(resolveAction).toHaveBeenCalledWith(combat, rat, expect.objectContaining({ telegraphed: true }));
    expect(script).not.toHaveBeenCalled();
    expect(rat.telegraph).toBe(null);
  });

  it('is cancelled when the monster is stunned before it lands', () => {
    const combat = fight();
    const rat = combat.units[1];
    telegraph(combat, rat, 'slam');
    const record = takeHeroTurn(combat, combat.hero, {
      chooseAction: () => ({ id: 'attack', kind: 'melee', target: 'rat-1' }),
      resolveAction: () => {
        applyCondition(rat, 'stunned');
      },
    });
    expect(types(record)).toContain('telegraphCancelled');
    expect(rat.telegraph).toBe(null);
  });

  it('is cancelled when the monster dies', () => {
    const combat = fight();
    const rat = combat.units[1];
    telegraph(combat, rat, 'slam');
    rat.alive = false;
    expect(cancelTelegraph(rat, 'killed')).toMatchObject({ ability: 'slam', why: 'killed' });
    expect(rat.telegraph).toBe(null);
  });
});

describe('the turnStart event', () => {
  it('fires once for the clock and once for the free traits', () => {
    const combat = fight();
    const phases = [];
    combat.hooks.on('turnStart', (payload) => phases.push(payload.phase), { name: 'freeTraits' });
    takeMonsterTurn(combat, combat.units[1], {});
    expect(phases).toEqual(['start', 'free']);
  });

  it('does not take condition damage twice for it', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 20, maxHp: 20 })] });
    const rat = combat.units[1];
    applyCondition(rat, 'burning', { dc: 12 });
    const before = rat.hp;
    const record = takeMonsterTurn(combat, rat, {});
    expect(record.steps.filter((entry) => entry.type === 'turnDamage')).toHaveLength(1);
    expect(before - rat.hp).toBeLessThanOrEqual(6);
  });

  it('gives the hero only the clock, with no free-trait phase', () => {
    const combat = fight();
    const phases = [];
    combat.hooks.on('turnStart', (payload) => phases.push(payload.phase), { name: 'freeTraits' });
    takeHeroTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) });
    expect(phases).toEqual(['start']);
  });
});

describe('takeTurn', () => {
  it('sends the hero and the monsters down their own sections', () => {
    const combat = fight();
    expect(takeTurn(combat, combat.hero, { chooseAction: () => ({ id: 'wait' }) }).kind).toBe('hero');
    expect(takeTurn(combat, combat.units[1], {}).kind).toBe('monster');
  });

  it('is what the round calls, and the two fit together', async () => {
    const { runRound } = await import('../src/engine/round.js');
    const combat = fight({ monsters: [monster('rat'), monster('rat')] });
    combat.round = 0;
    const result = runRound(combat, {
      takeTurn: (c, unit) =>
        takeTurn(c, unit, {
          chooseAction: () => ({ id: 'defend' }),
          script: () => ({ id: 'attack', kind: 'melee', target: 'hero' }),
          resolveAction: () => ({ hit: false }),
        }),
      isOver: () => false,
    });
    expect(result.turns).toHaveLength(3);
    expect(result.turns.every((turn) => turn.result.acted)).toBe(true);
  });
});
