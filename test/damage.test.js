/**
 * The damage order of operations (`06` section 7), step by step.
 *
 * Dice are stubbed to fixed numbers throughout, because the point of the
 * section is the *order*: what multiplies what, and when the rounding down
 * happens. Each test names the step it belongs to.
 */
import { describe, it, expect } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { registerConditionHooks } from '../src/engine/condition-hooks.js';
import { createCombat } from '../src/engine/field.js';
import {
  DAMAGE,
  calcDamage,
  conditionHurt,
  damageReduction,
  dealDamage,
  gatherParts,
  overTimeDamage,
  parsePart,
  resolveDamage,
  typeMultiplier,
  weaponMod,
} from '../src/engine/damage.js';
import { applyCondition, has } from '../src/engine/conditions.js';
import { modFor } from '../src/data/attributes.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  hp: 20,
  maxHp: 20,
  atk: 3,
  def: 12,
  protected: true,
  ...extra,
});
const monster = (type, extra = {}) => ({ type, hp: 30, maxHp: 30, atk: 2, def: 11, row: 'front', ...extra });

function fight({ monsters = [monster('rat')], hero = {}, seed = 'damage', hooks = true } = {}) {
  const register = hooks ? createHooks() : undefined;
  const rng = createStream(seed, 'combat');
  const combat = createCombat({ hero: heroTemplate(hero), monsters, rng, hooks: register, surprise: false });
  if (register) registerConditionHooks(register, { rng, hurt: conditionHurt(combat) });
  combat.round = 1;
  return combat;
}

/** Every die comes up the same number, so the arithmetic is the only variable. */
function everyDie(combat, value) {
  combat.rng.dice = (count) => count * value;
  combat.rng.die = () => value;
}

const hit = (combat, attack, target = combat.units[1], result = {}) => ({
  attacker: combat.hero,
  target,
  attack,
  result,
});

describe('reading what the documents write', () => {
  it('parses the bestiary and item notations', () => {
    expect(parsePart('1d6+1 crush')).toEqual({ count: 1, sides: 6, flat: 1, type: 'crush' });
    expect(parsePart('2d6 fire')).toEqual({ count: 2, sides: 6, flat: 0, type: 'fire' });
    expect(parsePart('d8')).toEqual({ count: 1, sides: 8, flat: 0 });
    expect(parsePart('3')).toEqual({ count: 0, sides: 0, flat: 3 });
  });

  it('gathers the weapon part, then extra dice, then property dice', () => {
    const parts = gatherParts({
      damage: '1d8 slash',
      extraDice: ['2d6 slash'],
      propertyDice: ['1d6 fire'],
    });
    expect(parts.map((part) => part.type)).toEqual(['slash', 'slash', 'fire']);
    expect(parts.filter((part) => part.main)).toHaveLength(1);
    expect(parts[0].main).toBe(true);
  });
});

describe('step 2: a critical multiplies the number of dice', () => {
  it('doubles every part, and never the flats', () => {
    const combat = fight();
    everyDie(combat, 3);
    // 1d8+1 becomes 2d8+1: 3 + 3 + 1 = 7.
    const normal = calcDamage(combat, hit(combat, { damage: '1d8+1 slash' }));
    const crit = calcDamage(combat, hit(combat, { damage: '1d8+1 slash' }, combat.units[1], { crit: true }));
    expect(normal.total).toBe(4);
    expect(crit.total).toBe(7);
    expect(crit.parts[0].diceCount).toBe(2);
  });

  it('triples with Weapon Mastery', () => {
    const combat = fight();
    everyDie(combat, 3);
    const result = calcDamage(
      combat,
      hit(combat, { damage: '1d8 slash', mastery: true }, combat.units[1], { crit: true }),
    );
    expect(result.parts[0].diceCount).toBe(DAMAGE.critDiceWithMastery);
    expect(result.total).toBe(9);
  });

  it('multiplies the extra dice too', () => {
    const combat = fight();
    everyDie(combat, 2);
    const result = calcDamage(
      combat,
      hit(combat, { damage: '1d8 slash', extraDice: ['2d6 slash'] }, combat.units[1], { crit: true }),
    );
    // (1d8 → 2d8) + (2d6 → 4d6) = 2 dice + 4 dice, each a 2.
    expect(result.total).toBe(12);
  });
});

describe('step 4: flat bonuses land on the main part only', () => {
  it('adds the attribute modifier once, not once per part', () => {
    const combat = fight();
    everyDie(combat, 4);
    const result = calcDamage(
      combat,
      hit(combat, { damage: '1d8 slash', flat: 3, propertyDice: ['1d6 fire'] }),
    );
    // main 4 + 3, property 4.
    expect(result.parts.map((part) => part.amount)).toEqual([7, 4]);
  });
});

describe('step 4: the attacker\u2019s own modifier', () => {
  it('adds MIG to a melee weapon (01 section 8)', () => {
    const combat = fight({ hero: { attributes: { might: 16, agility: 10 } } });
    everyDie(combat, 4);
    const result = calcDamage(combat, hit(combat, { damage: '1d8 slash', kind: 'melee' }));
    // 4 rolled + the +3 a Might of 16 gives.
    expect(result.total).toBe(4 + modFor(16));
    expect(weaponMod(combat.hero, { kind: 'melee' })).toBe(modFor(16));
  });

  it('adds AGI to a thrown weapon and nothing to a bow or a spell', () => {
    const who = { attributes: { might: 16, agility: 14, intellect: 8 } };
    expect(weaponMod(who, { kind: 'thrown' })).toBe(modFor(14));
    expect(weaponMod(who, { kind: 'ranged' })).toBe(0);
    expect(weaponMod(who, { kind: 'spell' })).toBe(0);
  });

  it('takes the attribute a skill names instead, when it names one', () => {
    const who = { attributes: { might: 16, intellect: 14 } };
    expect(weaponMod(who, { kind: 'spell', damageAttribute: 'intellect' })).toBe(modFor(14));
  });

  it('adds nothing for a monster, whose damage line already carries its flat', () => {
    const combat = fight();
    everyDie(combat, 3);
    const rat = combat.units[1];
    expect(weaponMod(rat, { kind: 'melee' })).toBe(0);
    const result = calcDamage(combat, {
      attacker: rat,
      target: combat.hero,
      attack: { damage: '1d6+1 pierce', kind: 'melee' },
      result: {},
    });
    expect(result.total).toBe(4);
  });
});

describe('step 5: a Weakened attacker', () => {
  it('halves every part of a weapon attack, rounding down', () => {
    const combat = fight();
    everyDie(combat, 5);
    applyCondition(combat.hero, 'weakened');
    const result = calcDamage(
      combat,
      hit(combat, { damage: '1d8+1 slash', propertyDice: ['1d6 fire'] }),
    );
    // main (5 + 1) / 2 = 3, property 5 / 2 = 2.
    expect(result.parts.map((part) => part.amount)).toEqual([3, 2]);
  });

  it('leaves a spell alone', () => {
    const combat = fight();
    everyDie(combat, 5);
    applyCondition(combat.hero, 'weakened');
    const result = calcDamage(combat, hit(combat, { kind: 'spell', damage: '2d6 fire' }));
    expect(result.total).toBe(10);
  });
});

describe('step 6: what the target is made of', () => {
  it('takes half from a Resistance and half again from nothing else', () => {
    const skeleton = { resistant: ['slash', 'pierce'], weak: ['crush', 'holy'], immune: ['poison'] };
    expect(typeMultiplier(skeleton, { type: 'slash' })).toBe(0.5);
    expect(typeMultiplier(skeleton, { type: 'crush' })).toBe(1.5);
    expect(typeMultiplier(skeleton, { type: 'poison' })).toBe(0);
    expect(typeMultiplier(skeleton, { type: 'fire' })).toBe(1);
  });

  it('cancels a Resistance against a Weakness', () => {
    expect(typeMultiplier({ resistant: ['fire'], weak: ['fire'] }, { type: 'fire' })).toBe(1);
  });

  it('never stacks two Resistances', () => {
    // Incorporeal and resistant to slash: still half, not a quarter.
    const wraith = { resistant: ['slash'], resistNonMagic: true };
    expect(typeMultiplier(wraith, { type: 'slash' }, {})).toBe(0.5);
  });

  it('resists the physical parts of a non-magic weapon, and yields to a magic one', () => {
    const wraith = { resistNonMagic: true, weak: ['holy'] };
    expect(typeMultiplier(wraith, { type: 'slash' }, { magic: false })).toBe(0.5);
    expect(typeMultiplier(wraith, { type: 'slash' }, { magic: true })).toBe(1);
    expect(typeMultiplier(wraith, { type: 'holy' }, {})).toBe(1.5);
  });

  it("lets crush through the Gargoyle's stone", () => {
    const gargoyle = { resistNonMagic: true, crushIgnoresResistance: true };
    expect(typeMultiplier(gargoyle, { type: 'crush' }, {})).toBe(1);
    expect(typeMultiplier(gargoyle, { type: 'slash' }, {})).toBe(0.5);
  });

  it('honours the named exceptions: fire ×2, and a warded binding ×½', () => {
    expect(typeMultiplier({ multipliers: { fire: 2 } }, { type: 'fire' })).toBe(2);
    expect(typeMultiplier({ allPartsMultiplier: 0.5 }, { type: 'slash' })).toBe(0.5);
  });

  it('applies the multiplier per part, each rounded down', () => {
    const combat = fight({ monsters: [monster('skeleton', { resistant: ['slash'], weak: ['fire'] })] });
    everyDie(combat, 5);
    const result = calcDamage(
      combat,
      hit(combat, { damage: '1d8 slash', propertyDice: ['1d6 fire'] }),
    );
    // slash 5 → 2 (rounded down), fire 5 → 7.
    expect(result.parts.map((part) => part.amount)).toEqual([2, 7]);
    expect(result.subtotal).toBe(9);
  });
});

describe('step 7: a telegraphed blow on a Defending hero', () => {
  it('halves each part', () => {
    const combat = fight();
    everyDie(combat, 6);
    combat.hero.defending = true;
    const result = calcDamage(combat, {
      attacker: combat.units[1],
      target: combat.hero,
      attack: { damage: '2d6 crush', telegraphed: true },
      result: {},
    });
    expect(result.total).toBe(6);
  });

  it('does nothing when the hero is not Defending', () => {
    const combat = fight();
    everyDie(combat, 6);
    const result = calcDamage(combat, {
      attacker: combat.units[1],
      target: combat.hero,
      attack: { damage: '2d6 crush', telegraphed: true },
      result: {},
    });
    expect(result.total).toBe(12);
  });
});

describe('step 9: damage reduction', () => {
  it('comes off once per hit, however many parts there were', () => {
    const combat = fight({ monsters: [monster('armor', { dr: 4 })] });
    everyDie(combat, 5);
    const result = calcDamage(
      combat,
      hit(combat, { damage: '1d8 slash', propertyDice: ['1d6 fire'] }),
    );
    expect(result.subtotal).toBe(10);
    expect(result.dr).toBe(4);
    expect(result.total).toBe(6);
  });

  it('is ignored entirely by a crush hit on Animated Armor, and by 2 on the Colossus', () => {
    const armor = { dr: 5, crushIgnoresDr: 'all' };
    expect(damageReduction(armor, [{ type: 'crush' }])).toBe(0);
    expect(damageReduction(armor, [{ type: 'slash' }])).toBe(5);

    const colossus = { dr: 5, crushIgnoresDr: 2 };
    expect(damageReduction(colossus, [{ type: 'crush' }])).toBe(3);
  });

  it('stacks the sources, Petrified among them', () => {
    const combat = fight({ monsters: [monster('statue', { dr: 2 })] });
    const target = combat.units[1];
    applyCondition(target, 'petrified');
    everyDie(combat, 6);
    const result = calcDamage(combat, hit(combat, { damage: '2d6 crush' }));
    // 2 of its own plus Petrified's 5.
    expect(result.dr).toBe(7);
    expect(result.total).toBe(5);
  });
});

describe('step 10: the minimum', () => {
  it('leaves at least 1 through when a part was not Immune', () => {
    const combat = fight({ monsters: [monster('armor', { dr: 20 })] });
    everyDie(combat, 2);
    expect(calcDamage(combat, hit(combat, { damage: '1d6 slash' })).total).toBe(DAMAGE.minimum);
  });

  it('leaves nothing when every part was Immune', () => {
    const combat = fight({ monsters: [monster('skeleton', { immune: ['poison'] })] });
    everyDie(combat, 4);
    const result = calcDamage(combat, hit(combat, { damage: '2d6 poison' }));
    expect(result).toMatchObject({ immuneAll: true, total: 0 });
  });

  it('still pays out when only one of two parts was Immune', () => {
    const combat = fight({ monsters: [monster('skeleton', { immune: ['poison'] })] });
    everyDie(combat, 4);
    const result = calcDamage(
      combat,
      hit(combat, { damage: '1d6 poison', propertyDice: ['1d6 fire'] }),
    );
    expect(result.total).toBe(4);
  });
});

describe('steps 11 and 12: applying it', () => {
  it('spends temporary HP first', () => {
    const combat = fight();
    const target = combat.units[1];
    target.tempHp = 4;
    const result = dealDamage(combat, target, 6);
    expect(result).toMatchObject({ absorbed: 4, toHp: 2 });
    expect(target.tempHp).toBe(0);
    expect(target.hp).toBe(28);
  });

  it('wakes a sleeper, even when temporary HP took the blow', () => {
    const combat = fight();
    const target = combat.units[1];
    applyCondition(target, 'asleep');
    target.tempHp = 10;
    dealDamage(combat, target, 3);
    expect(has(target, 'asleep')).toBe(false);
  });

  it('frees a grabbed hero who hits what holds them (06 section 8)', () => {
    const combat = fight();
    const rat = combat.units[1];
    applyCondition(combat.hero, 'grabbed', { source: rat.id });
    dealDamage(combat, rat, 3, { attacker: combat.hero });
    expect(has(combat.hero, 'grabbed')).toBe(false);
  });

  it('leaves step 13 to the caller: nothing here decides a death', () => {
    const combat = fight();
    const target = combat.units[1];
    dealDamage(combat, target, 99);
    expect(target.hp).toBeLessThan(0);
    expect(target.alive).toBe(true);
  });
});

describe('Magic Missile', () => {
  it('is its own hit per missile, each paying DR and each at least 1', () => {
    const combat = fight({ monsters: [monster('armor', { dr: 3 })] });
    everyDie(combat, 3);
    const result = resolveDamage(combat, hit(combat, { damage: '1d4+1 force', missiles: 3, autoHit: true }));
    // Each missile: 3 + 1 = 4, less DR 3 = 1.
    expect(result.total).toBe(3);
    expect(result.missiles).toHaveLength(3);
    expect(combat.units[1].hp).toBe(27);
  });
});

describe('damage over time', () => {
  it('skips the critical, the telegraph halving and the DR', () => {
    const combat = fight({ monsters: [monster('armor', { dr: 10 })] });
    const result = overTimeDamage(combat, combat.units[1], 4, 'fire');
    expect(result.dealt).toBe(4);
  });

  it('still reads the damage type, so a fire-immune unit ignores Burning', () => {
    const combat = fight({ monsters: [monster('elemental', { immune: ['fire'] })] });
    const before = combat.units[1].hp;
    expect(overTimeDamage(combat, combat.units[1], 6, 'fire')).toMatchObject({ dealt: 0, immune: true });
    expect(combat.units[1].hp).toBe(before);
  });

  it('halves against a Resistance, rounding down', () => {
    const combat = fight({ monsters: [monster('imp', { resistant: ['fire'] })] });
    expect(overTimeDamage(combat, combat.units[1], 5, 'fire').dealt).toBe(2);
  });

  it('is what a burning condition deals, through the hurt service', () => {
    const combat = fight({ monsters: [monster('elemental', { immune: ['fire'] })] });
    const rat = combat.units[1];
    applyCondition(rat, 'burning', { dc: 12 });
    const before = rat.hp;
    combat.hooks.fire('turnStart', { combat, unit: rat, phase: 'start', rng: combat.rng });
    expect(rat.hp).toBe(before);
  });
});

describe('the whole hit, as an attack asks for it', () => {
  it('rolls, applies, and reports one number', () => {
    const combat = fight({ monsters: [monster('rat', { resistant: ['slash'], dr: 1 })] });
    everyDie(combat, 6);
    const result = resolveDamage(combat, hit(combat, { damage: '1d8+2 slash', flat: 3 }));
    // (6 + 2 + 3) = 11, halved to 5, less DR 1 = 4.
    expect(result.total).toBe(4);
    expect(combat.units[1].hp).toBe(26);
  });

  it('lets a damageCalc hook add a part before any of it happens', () => {
    const combat = fight();
    everyDie(combat, 4);
    combat.hooks.on('damageCalc', (payload) => {
      payload.parts.push(parsePart('2d6 holy', { extra: true }));
    }, { name: 'backstab' });
    const result = calcDamage(combat, hit(combat, { damage: '1d8 slash' }));
    expect(result.parts).toHaveLength(2);
    expect(result.total).toBe(12);
  });
});
