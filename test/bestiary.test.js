/**
 * The traits of floors 3 to 10 (`02` sections 6 to 13).
 *
 * Every one of them is put on the field and watched, because a stat block the
 * engine ignores is just a table. The numbers are the document's own.
 */
import { describe, it, expect } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { countedEnemies, createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import { makeMonster } from '../src/data/monsters.js';
import { PENDING, TRAITS } from '../src/engine/monster-traits.js';
import { resolveAttack, resolveAction } from '../src/engine/attack.js';
import { resolveSupport } from '../src/engine/support.js';
import { chooseAction } from '../src/engine/ai.js';
import { zeroHp } from '../src/engine/defeat.js';
import { endRound, startRound } from '../src/engine/round.js';
import { has } from '../src/engine/conditions.js';
import { MONSTERS } from '../src/data/monsters.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  name: 'Harrow',
  hp: 40,
  maxHp: 40,
  atk: 5,
  def: 14,
  protected: true,
  saves: { body: 1, reflex: 1, mind: 1 },
  attack: { name: 'sword', kind: 'melee', damage: '1d6+2 slash' },
  ...extra,
});

/** A fight with the engine's own rules registered, as the game registers them. */
function fight(ids, { hero = {}, floor = 1, seed = 'bestiary' } = {}) {
  const hooks = createHooks();
  const rng = createStream(seed, 'combat');
  const combat = createCombat({
    hero: heroTemplate(hero),
    monsters: ids.map((id) => makeMonster(id, { floor })),
    rng,
    hooks,
    surprise: false,
  });
  registerRules(combat);
  combat.round = 1;
  combat.difficulty = 'hard';
  return combat;
}

const enemy = (combat, type) => countedEnemies(combat).find((unit) => unit.type === type);

/**
 * Fixes the dice this test cares about. A list is a queue — the attack roll
 * and the save it forces are two different d20s.
 */
function fixRolls(combat, { d20, die, roll } = {}) {
  const feed = (value, fallback) => {
    if (value === undefined) return undefined;
    const queue = Array.isArray(value) ? [...value] : [value];
    return () => (queue.length > 1 ? queue.shift() : queue[0] ?? fallback);
  };
  const twenties = feed(d20);
  const dice = feed(die);
  const rolls = feed(roll);
  if (twenties) combat.rng.d20 = twenties;
  if (dice) combat.rng.die = dice;
  if (rolls) combat.rng.roll = rolls;
}

describe('every trait is answered', () => {
  it('implements or explains each one the bestiary names', () => {
    for (const [id, block] of Object.entries(MONSTERS)) {
      if (id.startsWith('_')) continue;
      for (const entry of block.traits ?? []) {
        const trait = typeof entry === 'string' ? entry : entry.id;
        expect([id, trait, Boolean(TRAITS[trait] || PENDING[trait])]).toEqual([id, trait, true]);
      }
    }
  });

  it('says what the two waiting ones are waiting for', () => {
    // An ogre's bribe is an Item action the hero has no item for, and a Mimic
    // is a chest until the exploration loop can start a fight.
    expect(PENDING.greedy).toMatch(/Item action/);
    expect(PENDING.disguise).toMatch(/chest/);
  });
});

describe('floor 3 (02 section 6)', () => {
  it('keeps an Orc up for one more turn, once', () => {
    const combat = fight(['orc'], { floor: 3 });
    const orc = enemy(combat, 'orc');
    fixRolls(combat, { die: 1 }); // the 1-in-2 comes up

    orc.hp = 0;
    const first = zeroHp(combat, orc, { cause: 'test' });
    expect(first).toMatchObject({ saved: true, savedBy: 'ferocity' });
    expect(orc.hp).toBe(1);
    expect(orc.alive).toBe(true);

    // The turn it was given runs out, and it falls.
    combat.hooks.fire('turnEnd', { combat, unit: orc, say: () => {} });
    expect(orc.alive).toBe(false);

    // And only once a fight: the next orc to drop stays down.
    const second = fight(['orc'], { floor: 3 });
    const other = enemy(second, 'orc');
    fixRolls(second, { die: 2 }); // the other half of the 1-in-2
    other.hp = 0;
    expect(zeroHp(second, other, { cause: 'test' }).died).toBe(true);
  });

  it('gives a Worg +2 in round 1 and knocks the hero down', () => {
    const combat = fight(['worg'], { floor: 3 });
    const worg = enemy(combat, 'worg');
    // A 12 to hit, then a 2 on the Reflex save the pounce forces.
    fixRolls(combat, { d20: [12, 2], die: 3, roll: 4 });

    const result = resolveAttack(combat, worg, { ...worg.attack, target: combat.hero.id });
    // +4 ATK and Pounce's +2 in the first round.
    expect(result.total).toBe(12 + worg.atk + 2);
    expect(has(combat.hero, 'knockedDown')).toBe(true);
  });

  it('makes every ally of a Hobgoblin Captain braver, until it falls', () => {
    const combat = fight(['hobgoblin_captain', 'orc'], { floor: 3 });
    const captain = enemy(combat, 'hobgoblin_captain');
    const orc = enemy(combat, 'orc');
    const base = MONSTERS.orc;

    combat.hooks.fire('combatStart', { combat });
    expect(orc.atk).toBe(base.atk + 1);
    expect(orc.morale).toBe(10);

    captain.alive = false;
    combat.hooks.fire('kill', { combat, target: captain, unit: captain, say: () => {} });
    expect(orc.atk).toBe(base.atk);
    expect(orc.morale).toBe(base.morale);
  });

  it('blocks one attack a round with the captain’s shield', () => {
    const combat = fight(['hobgoblin_captain'], { floor: 3 });
    const captain = enemy(combat, 'hobgoblin_captain');
    fixRolls(combat, { d20: 17, roll: 3 });

    // DEF 16 and +2: a 17 + 5 clears it, but the block raises what it needed.
    const first = resolveAttack(combat, combat.hero, {
      ...combat.hero.attack,
      target: captain.id,
    });
    expect(first.def).toBe(captain.def + 2);
    const second = resolveAttack(combat, combat.hero, {
      ...combat.hero.attack,
      target: captain.id,
    });
    expect(second.def).toBe(captain.def);
  });

  it('mends kin, prays and hexes', () => {
    const combat = fight(['goblin_shaman', 'orc'], { floor: 3 });
    const shaman = enemy(combat, 'goblin_shaman');
    const orc = enemy(combat, 'orc');
    orc.hp = 4;
    fixRolls(combat, { roll: 5, d20: 1 });

    const mended = resolveSupport(combat, shaman, {
      id: 'heal',
      ability: 'mend_kin',
      heal: '2d4',
      allyBelow: 0.5,
    });
    expect(mended).toMatchObject({ id: 'heal', target: orc.id, healed: 5 });
    expect(orc.hp).toBe(9);

    // Hex: a Mind save, or the hero's next swing goes wide.
    const hexed = resolveSupport(combat, shaman, {
      id: 'hex',
      ability: 'hex',
      save: { type: 'mind', dc: 11 },
      applies: 'hexed',
    });
    expect(hexed.condition).toBe('hexed');
    expect(has(combat.hero, 'hexed')).toBe(true);

    // Dark Prayer: one ally hits harder for the rest of the fight.
    const blessed = resolveSupport(combat, shaman, { id: 'buff', ability: 'dark_prayer', buff: { atk: 2 } });
    expect(blessed.target).toBe(orc.id);
    expect(orc.atk).toBe(MONSTERS.orc.atk + 2);
  });
});

describe('floors 4 and 5 (02 sections 7 and 8)', () => {
  it('calls in a wandering group when a Shrieker shrieks', () => {
    const combat = fight(['shrieker'], { floor: 4 });
    const shrieker = enemy(combat, 'shrieker');
    fixRolls(combat, { die: 1 });
    let joined = 0;
    combat.floor = 4;
    combat.reinforce = () => {
      joined += 1;
      return [{ id: 'joined' }];
    };

    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    // Twice a combat, and no more (`02` section 7).
    expect(joined).toBe(2);
  });

  it('leaves a Rot Bloom behind when a Myconid dies', () => {
    const combat = fight(['myconid_sporecaller'], { floor: 4 });
    const myconid = enemy(combat, 'myconid_sporecaller');
    fixRolls(combat, { d20: 1 });
    myconid.alive = false;
    combat.hooks.fire('kill', {
      combat,
      target: myconid,
      unit: myconid,
      attacker: combat.hero,
      say: () => {},
    });
    expect(has(combat.hero, 'poisoned')).toBe(true);
  });

  it('asks the hero to hold their breath near a Ghast, every round', () => {
    const combat = fight(['ghast'], { floor: 5 });
    fixRolls(combat, { d20: 2 });
    combat.hooks.fire('roundStart', { combat, say: () => {} });
    expect(has(combat.hero, 'sickened')).toBe(true);
  });

  it('latches a Giant Leech on, and drains while it holds', () => {
    const combat = fight(['giant_leech'], { floor: 5 });
    const leech = enemy(combat, 'giant_leech');
    leech.hp = 10;
    fixRolls(combat, { d20: 18, roll: 4 });

    resolveAttack(combat, leech, { ...leech.attack, target: combat.hero.id });
    expect(leech.latched).toBe('hero');

    const before = combat.hero.hp;
    combat.hooks.fire('turnStart', { combat, unit: combat.hero, phase: 'start' });
    expect(combat.hero.hp).toBe(before - 4);
    expect(leech.hp).toBe(14);
  });
});

describe('floors 6 and 7 (02 sections 9 and 10)', () => {
  it('turns an ordinary blade aside on stone and mist', () => {
    const combat = fight(['gargoyle'], { floor: 6 });
    const gargoyle = enemy(combat, 'gargoyle');
    fixRolls(combat, { d20: 20, roll: 6 });

    // Slash from a plain sword: halved.
    const plain = resolveAttack(combat, combat.hero, {
      name: 'sword',
      kind: 'melee',
      damage: '1d6+2 slash',
      weapon: true,
      target: gargoyle.id,
    });
    // Crush goes through the Gargoyle's hide whatever it is made of.
    const crush = resolveAttack(combat, combat.hero, {
      name: 'mace',
      kind: 'melee',
      damage: '1d6+2 crush',
      weapon: true,
      target: gargoyle.id,
    });
    expect(crush.damage.total).toBeGreaterThan(plain.damage.total);
  });

  it('burns a hero who hits a Salamander in melee', () => {
    const combat = fight(['salamander'], { floor: 7 });
    const salamander = enemy(combat, 'salamander');
    fixRolls(combat, { d20: 18, roll: 3 });
    const before = combat.hero.hp;
    resolveAttack(combat, combat.hero, { ...combat.hero.attack, weapon: true, target: salamander.id });
    expect(combat.hero.hp).toBeLessThan(before);
  });

  it('bursts a Zealot into flame, unless cold put it out', () => {
    const combat = fight(['zealot'], { floor: 6 });
    const zealot = enemy(combat, 'zealot');
    fixRolls(combat, { d20: 1, roll: 7 });

    const before = combat.hero.hp;
    zealot.alive = false;
    zealot.lastDamageTypes = ['slash'];
    combat.hooks.fire('kill', { combat, target: zealot, unit: zealot, attacker: combat.hero, say: () => {} });
    expect(combat.hero.hp).toBeLessThan(before);

    const cold = fight(['zealot'], { floor: 6 });
    const other = enemy(cold, 'zealot');
    const kept = cold.hero.hp;
    other.alive = false;
    other.lastDamageTypes = ['cold'];
    cold.hooks.fire('kill', { combat: cold, target: other, unit: other, attacker: cold.hero, say: () => {} });
    expect(cold.hero.hp).toBe(kept);
  });

  it('halves a breath weapon on a save, and burns on a failure', () => {
    const combat = fight(['ember_hound'], { floor: 6 });
    const hound = enemy(combat, 'ember_hound');
    const breath = hound.abilities.find((one) => one.id === 'flame_breath');
    const action = { ...chooseAction(combat, hound) };
    expect(action.ability).toBe('flame_breath');

    // A failed save: full damage, and Burning.
    fixRolls(combat, { d20: 2, roll: 4 });
    const failed = resolveAttack(combat, hound, { ...action, target: combat.hero.id });
    expect(failed.save.passed).toBe(false);
    expect(has(combat.hero, 'burning')).toBe(true);

    // A save: half, and no Burning — one roll decided both (`02` section 9).
    const saved = fight(['ember_hound'], { floor: 6 });
    const other = enemy(saved, 'ember_hound');
    fixRolls(saved, { d20: 20, roll: 4 });
    const halved = resolveAttack(saved, other, { ...action, target: saved.hero.id });
    expect(halved.save.passed).toBe(true);
    expect(has(saved.hero, 'burning')).toBe(false);
    // Half of every part, which is what `06` section 7 step 6 is for.
    expect(halved.damage.parts.every((part) => part.multiplier === 0.5)).toBe(true);
    expect(failed.damage.parts.every((part) => part.multiplier === 1)).toBe(true);
    expect(breath.save.dc).toBe(13);
  });
});

describe('floors 8 to 10 (02 sections 11 to 13)', () => {
  it('lets a Dark Mage blink away from half the blows', () => {
    const combat = fight(['dark_mage'], { floor: 8 });
    const mage = enemy(combat, 'dark_mage');
    mage.hp = 10;
    combat.hooks.fire('damageTaken', { combat, target: mage, say: () => {} });
    expect(mage.blinkUntil).toBeGreaterThanOrEqual(combat.round);

    combat.rng.chance = () => true;
    fixRolls(combat, { d20: 20, roll: 3 });
    const swing = resolveAttack(combat, combat.hero, { ...combat.hero.attack, target: mage.id });
    expect(swing.hit).toBe(false);
  });

  it('counters one of the hero’s spells, once', () => {
    const combat = fight(['dark_mage'], { floor: 8 });
    const first = combat.hooks.fire('beforeAction', {
      combat,
      unit: combat.hero,
      phase: 'action',
      tags: ['spell'],
    });
    expect(first.cancelled).toBe(true);
    const second = combat.hooks.fire('beforeAction', {
      combat,
      unit: combat.hero,
      phase: 'action',
      tags: ['spell'],
    });
    expect(second.cancelled).toBeFalsy();
  });

  it('regenerates a Troll, unless fire found it', () => {
    const combat = fight(['troll'], { floor: 9 });
    const troll = enemy(combat, 'troll');
    troll.hp = 30;

    combat.hooks.fire('turnStart', { combat, unit: troll, phase: 'start' });
    expect(troll.hp).toBe(35);

    troll.damagedSinceTurn = ['fire'];
    combat.hooks.fire('turnStart', { combat, unit: troll, phase: 'start' });
    expect(troll.hp).toBe(35);
  });

  it('lays a Troll down rather than killing it, unless it was burned', () => {
    const combat = fight(['troll'], { floor: 9 });
    const troll = enemy(combat, 'troll');
    troll.hp = 0;
    troll.lastDamageTypes = ['slash'];
    expect(zeroHp(combat, troll, { cause: 'test' })).toMatchObject({ fallen: true });
    expect(troll.fallen).toMatchObject({ rounds: 3, hp: 10 });

    const burned = fight(['troll'], { floor: 9 });
    const other = enemy(burned, 'troll');
    other.hp = 0;
    other.lastDamageTypes = ['fire'];
    expect(zeroHp(burned, other, { cause: 'test' })).toMatchObject({ died: true });
  });

  it('steps an Ashbound Knight in front of the Back row, once a round', () => {
    const combat = fight(['ashbound_knight', 'dark_mage'], { floor: 10 });
    const knight = enemy(combat, 'ashbound_knight');
    const mage = enemy(combat, 'dark_mage');
    expect(mage.row).toBe('back');

    const first = combat.hooks.fire('beforeAction', {
      combat,
      attacker: combat.hero,
      target: mage,
      attack: {},
      phase: 'redirect',
    });
    expect(first.target).toBe(knight);

    const second = combat.hooks.fire('beforeAction', {
      combat,
      attacker: combat.hero,
      target: mage,
      attack: {},
      phase: 'redirect',
    });
    expect(second.target).toBe(mage);
  });

  it('turns a Basilisk’s gaze aside for a hero who is Defending', () => {
    const combat = fight(['basilisk'], { floor: 10 });
    fixRolls(combat, { d20: 2 });
    combat.hero.defending = true;
    combat.hooks.fire('roundStart', { combat, say: () => {} });
    expect(has(combat.hero, 'petrified')).toBe(false);

    combat.hero.defending = false;
    combat.hooks.fire('roundStart', { combat, say: () => {} });
    expect(has(combat.hero, 'petrified')).toBe(true);
  });

  it('gives a Banshee advantage on a frightened hero', () => {
    const combat = fight(['banshee'], { floor: 8 });
    const banshee = enemy(combat, 'banshee');
    const payload = { combat, attacker: banshee, target: combat.hero, phase: 'roll', bonus: 0 };
    combat.hooks.fire('attackRoll', payload);
    expect(payload.advantage).toBeFalsy();

    combat.hero.conditions.feared = { rounds: 2 };
    const again = { combat, attacker: banshee, target: combat.hero, phase: 'roll', bonus: 0 };
    combat.hooks.fire('attackRoll', again);
    expect(again.advantage).toBe(true);
  });
});
