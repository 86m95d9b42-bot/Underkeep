/**
 * The event hook system (`06` section 16).
 *
 * The rule that matters most is the ordering: the target's hooks, then the
 * attacker's, then the field's, and inside each group the order the section's
 * own table lists. Everything else here is about a hook being able to change
 * what happens without the engine knowing it exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHooks, EVENTS, ORDER, orderOf, GROUPS } from '../src/engine/hooks.js';
import { registerConditionHooks } from '../src/engine/condition-hooks.js';
import { applyCondition, has, listed } from '../src/engine/conditions.js';

const unit = (id, extra = {}) => ({ id, conditions: {}, controlImmunity: {}, lostTurns: 0, immunities: [], ...extra });

function fakeRng(...rolls) {
  const queue = [...rolls];
  const rng = () => 0;
  rng.die = () => (queue.length > 1 ? queue.shift() : queue[0]);
  rng.d20 = () => rng.die(20);
  rng.roll = (notation) => rng.die(Number(/d(\d+)/.exec(notation)?.[1] ?? 6));
  return rng;
}

describe('the events themselves', () => {
  it('are the ones 06 section 16 lists, in its order', () => {
    expect(EVENTS).toEqual([
      'combatStart',
      'roundStart',
      'turnStart',
      'beforeAction',
      'attackRoll',
      'hit',
      'miss',
      'damageCalc',
      'damageTaken',
      'zeroHP',
      'kill',
      'turnEnd',
      'roundEnd',
      'combatEnd',
    ]);
  });

  it('refuses an event that does not exist', () => {
    const hooks = createHooks();
    expect(() => hooks.on('elevenses', () => {})).toThrow(/elevenses/);
    expect(() => hooks.fire('elevenses')).toThrow(/elevenses/);
  });

  it('knows where each documented hook sits in its event', () => {
    // 06 section 16: "Poison, Burning, Bleeding, Latch, Regeneration…"
    expect(ORDER.turnStart.slice(0, 3)).toEqual(['poisoned', 'burning', 'bleeding']);
    expect(orderOf('turnStart', 'poisoned')).toBe(0);
    expect(orderOf('turnStart', 'bleeding')).toBe(2);
    // Anything the list does not name runs after the ones it does — the
    // recharge rolls among them, which `06` section 5 makes step 6 of a
    // monster's turn rather than a start-of-turn hook.
    expect(orderOf('turnStart', 'somethingNew')).toBeGreaterThan(
      orderOf('turnStart', 'trollRegeneration'),
    );
  });
});

describe('firing', () => {
  it('calls the hooks on that event and no others', () => {
    const hooks = createHooks();
    const onTurn = vi.fn();
    const onRound = vi.fn();
    hooks.on('turnStart', onTurn);
    hooks.on('roundStart', onRound);

    hooks.fire('turnStart', { unit: unit('hero') });
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(onRound).not.toHaveBeenCalled();
  });

  it("hands every hook the same payload, so each sees the last one's work", () => {
    const hooks = createHooks();
    hooks.on('damageCalc', (payload) => { payload.amount *= 2; }, { name: 'crit' });
    hooks.on('damageCalc', (payload) => { payload.amount -= 3; }, { name: 'dr' });

    const result = hooks.fire('damageCalc', { amount: 10 });
    expect(result.amount).toBe(17);
    expect(result.fired).toEqual(['crit', 'dr']);
  });

  it('collects log lines from whoever wrote them', () => {
    const hooks = createHooks();
    hooks.on('hit', (payload) => payload.say('the blade bites'));
    expect(hooks.fire('hit').log).toEqual(['the blade bites']);
  });

  it('stops the chain when a hook cancels, which is how Counterspell works', () => {
    const hooks = createHooks();
    const after = vi.fn();
    hooks.on('beforeAction', (payload) => payload.cancel('counterspell'), { name: 'counterspell' });
    hooks.on('beforeAction', after, { name: 'guardian' });

    const result = hooks.fire('beforeAction', {});
    expect(result.cancelled).toBe(true);
    expect(result.cancelledBy).toBe('counterspell');
    expect(after).not.toHaveBeenCalled();
  });

  it('takes a returned false as a cancel, for one-line hooks', () => {
    const hooks = createHooks();
    hooks.on('attackRoll', () => false, { name: 'blink' });
    const result = hooks.fire('attackRoll', {});
    expect(result.cancelled).toBe(true);
    expect(result.cancelledBy).toBe('blink');
  });
});

describe('the order within one event', () => {
  it("runs the target's hooks, then the attacker's, then the field's", () => {
    // 06 section 16, Hook priority.
    const hooks = createHooks();
    const order = [];
    hooks.on('hit', () => order.push('field'));
    hooks.on('hit', () => order.push('attacker'), { owner: 'ogre' });
    hooks.on('hit', () => order.push('target'), { owner: 'hero' });

    hooks.fire('hit', { target: unit('hero'), attacker: unit('ogre') });
    expect(order).toEqual(['target', 'attacker', 'field']);
    expect(GROUPS).toEqual(['target', 'attacker', 'field']);
  });

  it("follows the table's order inside a group", () => {
    const hooks = createHooks();
    const order = [];
    hooks.on('turnStart', () => order.push('bleeding'), { name: 'bleeding' });
    hooks.on('turnStart', () => order.push('regeneration'), { name: 'regeneration' });
    hooks.on('turnStart', () => order.push('poisoned'), { name: 'poisoned' });

    hooks.fire('turnStart', {});
    expect(order).toEqual(['poisoned', 'bleeding', 'regeneration']);
  });

  it('keeps registration order for hooks the table does not name', () => {
    const hooks = createHooks();
    const order = [];
    hooks.on('kill', () => order.push('first'));
    hooks.on('kill', () => order.push('second'));
    hooks.on('kill', () => order.push('cleave'), { name: 'cleave' });

    hooks.fire('kill', {});
    expect(order).toEqual(['cleave', 'first', 'second']);
  });

  it('lets a hook say plainly where it goes', () => {
    const hooks = createHooks();
    const order = [];
    hooks.on('roundEnd', () => order.push('late'), { order: 99 });
    hooks.on('roundEnd', () => order.push('early'), { order: -1 });
    hooks.fire('roundEnd', {});
    expect(order).toEqual(['early', 'late']);
  });
});

describe("a hook's life", () => {
  it('can be removed by the call that made it', () => {
    const hooks = createHooks();
    const handler = vi.fn();
    const off = hooks.on('turnEnd', handler);
    hooks.fire('turnEnd', {});
    off();
    hooks.fire('turnEnd', {});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(hooks.count('turnEnd')).toBe(0);
  });

  it('goes with its owner, which is what a death does', () => {
    const hooks = createHooks();
    hooks.on('turnStart', () => {}, { owner: 'rat' });
    hooks.on('hit', () => {}, { owner: 'rat' });
    hooks.on('hit', () => {}, { owner: 'hero' });

    expect(hooks.offAll({ owner: 'rat' })).toBe(2);
    expect(hooks.count()).toBe(1);
  });

  it('fires once when it is a once', () => {
    const hooks = createHooks();
    const handler = vi.fn();
    hooks.on('zeroHP', handler, { name: 'undying', once: true });
    hooks.fire('zeroHP', {});
    hooks.fire('zeroHP', {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('counts its uses, and gets them back when the turn or round does', () => {
    // 06 has "Cleave (once per turn)" and "Ferocity: once per combat".
    const hooks = createHooks();
    const cleave = vi.fn();
    hooks.on('kill', cleave, { name: 'cleave', limit: { uses: 1, per: 'turn' } });

    hooks.fire('kill', {});
    hooks.fire('kill', {});
    expect(cleave).toHaveBeenCalledTimes(1);

    expect(hooks.resetLimits('round')).toBe(0);
    expect(hooks.resetLimits('turn')).toBe(1);
    hooks.fire('kill', {});
    expect(cleave).toHaveBeenCalledTimes(2);
  });

  it('starts empty again for a new fight', () => {
    const hooks = createHooks();
    hooks.on('hit', () => {});
    hooks.clear();
    expect(hooks.count()).toBe(0);
  });
});

describe('conditions, registered as hooks', () => {
  it('deals their damage on turnStart, in the documented order', () => {
    const hooks = createHooks();
    const hero = unit('hero', { protected: true });
    applyCondition(hero, 'poisoned');
    applyCondition(hero, 'bleeding');
    registerConditionHooks(hooks, { rng: fakeRng(3) });

    const payload = hooks.fire('turnStart', { unit: hero });
    expect(payload.damage.map((d) => d.id)).toEqual(['poisoned', 'bleeding']);
    expect(payload.damage.map((d) => d.amount)).toEqual([3, 2]);
  });

  it('applies the damage through the engine when it is given one', () => {
    const hooks = createHooks();
    const hero = unit('hero');
    applyCondition(hero, 'burning');
    const hurt = vi.fn();
    registerConditionHooks(hooks, { rng: fakeRng(5), hurt });

    hooks.fire('turnStart', { unit: hero });
    expect(hurt).toHaveBeenCalledWith(hero, 5, { kind: 'condition', id: 'burning' });
  });

  it('saves and then ticks on turnEnd, in that order', () => {
    const hooks = createHooks();
    const hero = unit('hero', { protected: true });
    applyCondition(hero, 'feared', { dc: 10 }); // no duration: only a save ends it
    applyCondition(hero, 'blinded'); // 2 rounds
    registerConditionHooks(hooks, { rng: fakeRng(15), saveBonus: () => 0 });

    const payload = hooks.fire('turnEnd', { unit: hero });
    expect(payload.saves.map((s) => s.id)).toEqual(['feared']);
    expect(payload.saves[0].passed).toBe(true);
    expect(has(hero, 'feared')).toBe(false);
    expect(hero.conditions.blinded.rounds).toBe(1);
  });

  it('wakes a sleeper on damageTaken', () => {
    const hooks = createHooks();
    const rat = unit('rat');
    applyCondition(rat, 'asleep');
    registerConditionHooks(hooks, { rng: fakeRng(1) });

    hooks.fire('damageTaken', { target: rat, amount: 4 });
    expect(has(rat, 'asleep')).toBe(false);
  });

  it('gathers advantage and disadvantage from both sides of an attack', () => {
    const hooks = createHooks();
    const hero = unit('hero', { protected: true });
    const rat = unit('rat');
    applyCondition(hero, 'blinded'); // the attacker cannot see
    applyCondition(rat, 'stunned'); // and the target is reeling
    registerConditionHooks(hooks, { rng: fakeRng(1) });

    const payload = hooks.fire('attackRoll', { attacker: hero, target: rat });
    expect(payload.disadvantage).toBe(true);
    expect(payload.advantage).toBe(true);
  });

  it('ends Hidden when the hero acts, through beforeAction', () => {
    const hooks = createHooks();
    const hero = unit('hero', { protected: true });
    applyCondition(hero, 'hidden');
    registerConditionHooks(hooks, { rng: fakeRng(1) });

    hooks.fire('beforeAction', { unit: hero, action: 'attack' });
    expect(has(hero, 'hidden')).toBe(false);
  });

  it('clears the field at combatEnd, keeping what lasts', () => {
    const hooks = createHooks();
    const hero = unit('hero', { protected: true });
    applyCondition(hero, 'weakened');
    applyCondition(hero, 'blinded');
    applyCondition(hero, 'poisoned', { dc: 12 });
    registerConditionHooks(hooks, { rng: fakeRng(1) });

    const payload = hooks.fire('combatEnd', { units: [hero] });
    expect(listed(hero).sort()).toEqual(['poisoned', 'weakened']);
    expect(payload.log.join(' ')).toContain('still poisoned');
  });

  it('can be taken off again, all at once', () => {
    const hooks = createHooks();
    const remove = registerConditionHooks(hooks, { rng: fakeRng(1) });
    expect(hooks.count()).toBeGreaterThan(5);
    remove();
    expect(hooks.count()).toBe(0);
  });
});
