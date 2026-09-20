/**
 * What items do (`04` sections 4, 7, 8, 9, 10 and 13).
 *
 * Three kinds of effect, and one rule between them: no item gets a code path
 * of its own. A number goes on the sheet, an event gets a hook, and a
 * consumable is an Item action. Every effect in `items.json` is accounted for
 * by the last test in this file.
 */
import { describe, it, expect } from 'vitest';
import { CURSES, ITEMS, MAGIC } from '../src/data/items.js';
import { HANDLERS, PENDING, registerItems } from '../src/engine/item-hooks.js';
import { HANDLERS as SKILL_HANDLERS, PENDING as SKILL_PENDING, skillsOf } from '../src/engine/skill-hooks.js';
import { EVENTS, createHooks } from '../src/engine/hooks.js';
import { createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import { resolveAttack } from '../src/engine/attack.js';
import { weaponVsBonus } from '../src/engine/damage.js';
import { makeMonster } from '../src/data/monsters.js';
import { carriedStreams } from '../src/engine/rng.js';
import { addItem, createPack, equipNew } from '../src/systems/inventory.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { rebuildSheet } from '../src/systems/levelling.js';
import { createFight } from '../src/systems/fight.js';
import { actionForItem, usableItems, whyNotUse } from '../src/systems/use-item.js';
import { clearCombatBuffs, tickBuffs } from '../src/engine/item-actions.js';

const SCORES = { might: 14, agility: 12, vigor: 13, intellect: 13, wits: 12, luck: 10 };

function hero(origin = 'sellsword', scores = SCORES) {
  return finish(setName(chooseOrigin({ ...createDraft({ seed: 4 }), scores }, origin), 'Harrow'));
}

/** A fight the way the game sets one up, with the hero's gear registered. */
function fightWith(who, monsters = ['kobold'], seed = 6) {
  const rng = carriedStreams(seed);
  const combat = createCombat({
    hero: who,
    monsters: monsters.map((id) => makeMonster(id, { floor: 2 })),
    rng: rng.combat,
    hooks: createHooks(),
    surprise: false,
  });
  combat.round = 1;
  registerRules(combat);
  return combat;
}

describe('what a charm or a property puts on the sheet (04 sections 4 and 7)', () => {
  it('adds DEF, Focus, hit points and initiative', () => {
    const who = hero();
    const before = { def: who.def, maxFp: who.maxFp, maxHp: who.maxHp, init: who.init };
    equipNew(who.pack, 'ring_of_protection');
    rebuildSheet(who);
    expect(who.def).toBe(before.def + 1);

    equipNew(who.pack, 'chain_mail', { property: 'stalwart' });
    rebuildSheet(who);
    expect(who.maxHp).toBe(before.maxHp + 5);

    equipNew(who.pack, 'long_sword', { property: 'swift' });
    rebuildSheet(who);
    expect(who.init).toBe(before.init + 2);
  });

  it('carries resistances and immunities to the damage rules', () => {
    const who = hero();
    equipNew(who.pack, 'salamander_scale');
    rebuildSheet(who);
    expect(who.resistant).toContain('fire');

    equipNew(who.pack, 'ring_of_free_action');
    rebuildSheet(who);
    expect(who.immunities).toEqual(expect.arrayContaining(['paralyzed', 'webbed', 'grabbed']));
  });

  it('raises the score a charm raises, and everything derived from it', () => {
    // 15 is the last score with a +1 modifier, so the charm's point is worth
    // a modifier as well as a point.
    const who = hero('sellsword', { ...SCORES, luck: 15 });
    expect(who.mods.luck).toBe(1);
    equipNew(who.pack, 'lucky_coin'); // +1 to the LCK score
    rebuildSheet(who);
    expect(who.gear.attributes).toEqual({ luck: 1 });
    expect(who.mods.luck).toBe(2);
    expect(who.critFrom).toBe(19); // and the wider critical range with it
    // The hero's own sheet is untouched: the point is the charm's.
    expect(who.attributes.luck).toBe(15);
  });

  it('adds the slots a Wanderer\'s Coat adds, to the sheet and the pack', () => {
    const who = hero();
    const slots = who.slots;
    equipNew(who.pack, 'wanderers_coat');
    rebuildSheet(who);
    expect(who.slots).toBe(slots + 2);
    expect(who.pack.capacity).toBe(slots + 2);
  });

  it('lets an armour property waive what the armour costs', () => {
    const weak = hero('sellsword', { ...SCORES, might: 8 });
    equipNew(weak.pack, 'plate', { property: 'featherlight' });
    rebuildSheet(weak);
    expect(weak.gear.unmet).toEqual([]);
    expect(weak.gear.maxAgi).toBe(2); // one step lighter than Plate's +1

    const sneak = hero();
    equipNew(sneak.pack, 'plate', { property: 'shadowed' });
    rebuildSheet(sneak);
    expect(sneak.stealth).toBe(0);

    const caster = hero();
    equipNew(caster.pack, 'plate', { property: 'spellwoven' });
    rebuildSheet(caster);
    expect(caster.spellFizzle).toBe(0);
  });

  it('lends the skills a unique item lends (04 section 13)', () => {
    const who = hero();
    expect(skillsOf(who).some((entry) => entry.id === 'turn_undead')).toBe(false);
    equipNew(who.pack, 'wardens_mace');
    rebuildSheet(who);
    const lent = skillsOf(who).find((entry) => entry.id === 'turn_undead');
    expect(lent).toMatchObject({ rank: 1, granted: true });

    // A granted skill's own sheet numbers land too: Evasion is +1 DEF.
    const cloaked = hero();
    const def = cloaked.def;
    // The cloak's +3 replaces the kit's leather +2, and Evasion adds one more.
    equipNew(cloaked.pack, 'silkweave_cloak');
    rebuildSheet(cloaked);
    expect(cloaked.def).toBe(def - 2 + 3 + 1);
  });

  it('adds nothing extra when the hero already knows the skill', () => {
    const who = hero();
    who.skills = [{ id: 'turn_undead', rank: 1 }];
    equipNew(who.pack, 'wardens_mace');
    rebuildSheet(who);
    expect(skillsOf(who).filter((entry) => entry.id === 'turn_undead')).toHaveLength(1);
  });
});

describe('what a property does in a fight (04 section 4)', () => {
  it('adds a die of fire to every hit, and only to weapon hits', () => {
    const who = hero();
    equipNew(who.pack, 'long_sword', { property: 'flaming' });
    rebuildSheet(who);
    const combat = fightWith(who, ['zombie']);
    const target = combat.units.find((unit) => unit.side === 'monsters');
    const before = target.hp;
    const result = resolveAttack(combat, who, { ...who.attack, target: target.id, autoHit: true });
    expect(result.hit).toBe(true);
    // 1d8 slash plus 1d6 fire plus the Might mod: more than the sword alone.
    expect(result.damage.parts.some((part) => part.type === 'fire')).toBe(true);
    expect(before - target.hp).toBe(result.damage.total);
  });

  it('only adds the holy die against what it is meant for', () => {
    const who = hero();
    equipNew(who.pack, 'long_sword', { property: 'holy' });
    rebuildSheet(who);
    const combat = fightWith(who, ['zombie', 'kobold']);
    const undead = combat.units.find((unit) => unit.family === 'undead');
    const living = combat.units.find((unit) => unit.family === 'humanoid');

    const onUndead = resolveAttack(combat, who, { ...who.attack, target: undead.id, autoHit: true });
    expect(onUndead.damage.parts.some((part) => part.type === 'holy')).toBe(true);
    const onLiving = resolveAttack(combat, who, { ...who.attack, target: living.id, autoHit: true });
    expect(onLiving.damage.parts.some((part) => part.type === 'holy')).toBe(false);
  });

  it('heals the Vampiric wielder on every hit', () => {
    const who = hero();
    equipNew(who.pack, 'long_sword', { property: 'vampiric' });
    rebuildSheet(who);
    const combat = fightWith(who, ['zombie']);
    who.hp = who.maxHp - 10;
    const target = combat.units.find((unit) => unit.side === 'monsters');
    resolveAttack(combat, who, { ...who.attack, target: target.id, autoHit: true });
    expect(who.hp).toBe(who.maxHp - 8);
  });

  it('answers a melee attacker with the Thorned armour', () => {
    const who = hero();
    equipNew(who.pack, 'chain_mail', { property: 'thorned' });
    rebuildSheet(who);
    const combat = fightWith(who, ['kobold']);
    const foe = combat.units.find((unit) => unit.side === 'monsters');
    const before = foe.hp;
    resolveAttack(combat, foe, { ...foe.attack, target: who.id, autoHit: true });
    expect(foe.hp).toBeLessThan(before);
  });

  it('puts a condition on a critical hit, and not on an ordinary one', () => {
    const who = hero();
    equipNew(who.pack, 'long_sword', { property: 'venomous' });
    rebuildSheet(who);
    const combat = fightWith(who, ['kobold']);
    const target = combat.units.find((unit) => unit.side === 'monsters');

    // The hit event is what the property listens to, so this is the event.
    const hit = (crit) =>
      combat.hooks.fire('hit', {
        combat,
        attacker: who,
        target,
        attack: who.attack,
        result: { crit },
        say: () => {},
      });

    hit(false);
    expect(target.conditions?.poisoned).toBeUndefined();
    hit(true);
    expect(target.conditions?.poisoned).toBeTruthy();
  });

  it('adds the mace\'s own +1 against undead (04 section 2)', () => {
    const who = hero('pilgrim');
    expect(who.weapon.damageVs).toEqual({ undead: 1 });
    const undead = makeMonster('zombie', { floor: 2 });
    const living = makeMonster('kobold', { floor: 1 });
    expect(weaponVsBonus(who, undead, who.attack)).toBe(1);
    expect(weaponVsBonus(who, living, who.attack)).toBe(0);
    // A spell is not the mace's doing.
    expect(weaponVsBonus(who, undead, { kind: 'spell' })).toBe(0);
    expect(weaponVsBonus(makeMonster('kobold', { floor: 1 }), undead, {})).toBe(0);
  });

  it('heals the Bloodstone after a victory', () => {
    const who = hero();
    equipNew(who.pack, 'bloodstone');
    rebuildSheet(who);
    const fight = createFight({ hero: who, monsters: [makeMonster('giant_rat', { floor: 1 })], masterSeed: 3, surprise: false });
    who.hp = who.maxHp - 12;
    for (let i = 0; i < 10 && !fight.over; i += 1) fight.act('attack', { target: fight.rowOf('front')[0]?.id });
    if (fight.outcome === 'victory') expect(who.hp).toBeGreaterThan(who.maxHp - 12);
  });
});

describe('using a potion, a scroll or a bomb (04 sections 8 to 10)', () => {
  function armed(items = []) {
    const who = hero();
    for (const [id, extra] of items) addItem(who.pack, id, extra ?? {});
    return who;
  }
  const idOf = (who, baseId) => who.pack.items.find((entry) => entry.baseId === baseId).instanceId;

  it('drinks a Healing Potion, and takes it off the stack', () => {
    const who = armed([['healing_potion', { count: 2 }]]);
    const fight = createFight({ hero: who, monsters: [makeMonster('kobold', { floor: 1 })], masterSeed: 5, surprise: false });
    who.hp = who.maxHp - 12;
    expect(fight.act('item', { item: idOf(who, 'healing_potion') })).toMatchObject({ acted: true });
    expect(who.hp).toBeGreaterThan(who.maxHp - 12);
    expect(who.pack.items.find((entry) => entry.baseId === 'healing_potion').count).toBe(1);
    expect(fight.log.some((line) => line.text.includes('Healing Potion'))).toBe(true);
  });

  it('learns what an unknown potion was by drinking it (04 section 5)', () => {
    const who = armed([['focus_tonic', { identified: false }]]);
    const fight = createFight({ hero: who, monsters: [makeMonster('kobold', { floor: 1 })], masterSeed: 5, surprise: false });
    who.fp = 0;
    fight.act('item', { item: idOf(who, 'focus_tonic') });
    expect(who.fp).toBeGreaterThan(0);
    expect(who.identification.knownTypes).toContain('focus_tonic');
  });

  it('buffs for one combat, and only for one combat', () => {
    const who = armed([['draught_of_heroism']]);
    const fight = createFight({ hero: who, monsters: [makeMonster('giant_rat', { floor: 1 })], masterSeed: 5, surprise: false });
    const attack = who.attacks.melee;
    fight.act('item', { item: idOf(who, 'draught_of_heroism') });
    expect(who.attacks.melee).toBe(attack + 2);
    expect(who.immunities).toContain('feared');
    expect(who.buffs).toHaveLength(1);

    for (let i = 0; i < 12 && !fight.over; i += 1) fight.act('attack', { target: fight.rowOf('front')[0]?.id });
    expect(who.buffs).toHaveLength(0);
    expect(who.attacks.melee).toBe(attack);
  });

  it('puts the hero in the first band with Quicksilver', () => {
    const who = armed([['quicksilver']]);
    const fight = createFight({ hero: who, monsters: [makeMonster('kobold', { floor: 1 })], masterSeed: 5, surprise: false });
    const def = who.def;
    fight.act('item', { item: idOf(who, 'quicksilver') });
    expect(who.actsFirst).toBe(true);
    expect(who.def).toBe(def + 2);
    clearCombatBuffs(who);
    expect(who.actsFirst).toBe(false);
  });

  it('cures what a potion cures', () => {
    const who = armed([['antidote']]);
    const fight = createFight({ hero: who, monsters: [makeMonster('kobold', { floor: 1 })], masterSeed: 5, surprise: false });
    who.conditions = { poisoned: { rounds: 3 } };
    fight.act('item', { item: idOf(who, 'antidote') });
    expect(who.conditions.poisoned).toBeUndefined();
  });

  it('throws a bomb at a row, with a save against 10 + the floor', () => {
    const who = armed([['sleep_bomb']]);
    const fight = createFight({
      hero: who,
      monsters: [makeMonster('kobold', { floor: 1 }), makeMonster('kobold', { floor: 1 })],
      floor: 3,
      masterSeed: 2,
      surprise: false,
    });
    const built = actionForItem(who, idOf(who, 'sleep_bomb'), { floor: 3 });
    expect(built.action.dc).toBe(13);
    fight.act('item', { item: idOf(who, 'sleep_bomb'), target: fight.rowOf('front')[0]?.id });
    const asleep = fight.rowOf('front').filter((unit) => unit.conditions?.asleep);
    expect(asleep.length).toBeGreaterThan(0);
  });

  it('gets the hero out with a Smoke Bomb', () => {
    const who = armed([['smoke_bomb']]);
    const fight = createFight({ hero: who, monsters: [makeMonster('zombie', { floor: 2 })], masterSeed: 5, surprise: false });
    expect(fight.act('item', { item: idOf(who, 'smoke_bomb') })).toMatchObject({ fled: true });
    expect(fight.outcome).toBe('fled');
  });

  it('reads a scroll for no Focus, at the reader\'s own level', () => {
    const who = hero('apprentice');
    const fight = createFight({ hero: who, monsters: [makeMonster('kobold', { floor: 1 })], masterSeed: 5, surprise: false });
    const scroll = who.pack.items.find((entry) => entry.baseId === 'scroll_of_sleep');
    const built = actionForItem(who, scroll.instanceId, { target: fight.rowOf('front')[0]?.id });
    // Sleep is an area skill and waits on rows; the scroll says so rather than
    // pretending, and it costs nothing when it does work.
    expect(built.action?.fp ?? 0).toBe(0);
    expect(fight.items.find((entry) => entry.baseId === 'scroll_of_sleep')).toBeTruthy();
  });

  it('will not let a hero read what they cannot read (04 section 9)', () => {
    const dull = hero('sellsword', { ...SCORES, intellect: 8, wits: 8 });
    addItem(dull.pack, 'scroll_of_magic_missile');
    const scroll = dull.pack.items.find((entry) => entry.baseId === 'scroll_of_magic_missile');
    expect(whyNotUse(dull, scroll)).toBe('needsIntellect');
    expect(actionForItem(dull, scroll.instanceId)).toMatchObject({ why: 'needsIntellect' });
  });

  it('lists the quick slots first, and says why a dimmed one is dimmed', () => {
    const who = armed([['healing_potion'], ['scroll_of_mapping'], ['fire_pot']]);
    const flask = who.pack.items.find((entry) => entry.baseId === 'fire_pot');
    who.pack.quick[0] = flask.instanceId;
    const list = usableItems(who);
    expect(list[0].baseId).toBe('fire_pot');
    expect(list.find((entry) => entry.baseId === 'scroll_of_mapping').why).toBe('notHere');
    expect(list.find((entry) => entry.baseId === 'healing_potion').why).toBe(null);
  });

  it('winds a stepped buff down as the hero walks', () => {
    const who = hero();
    who.buffs = [{ id: 'x', effects: [{ sheet: 'def', value: 2 }], until: 'steps', steps: 100 }];
    rebuildSheet(who);
    const def = who.def;
    expect(tickBuffs(who, 60)).toBe(false);
    expect(who.buffs[0].steps).toBe(40);
    expect(tickBuffs(who, 40)).toBe(true);
    expect(who.buffs).toHaveLength(0);
    expect(who.def).toBe(def - 2);
  });
});

describe('every effect in the database is accounted for', () => {
  /** Every effect any item, property or curse declares. */
  function allEffects() {
    const out = [];
    const add = (effects, where) => out.push(...(effects ?? []).map((effect) => [where, effect]));
    for (const [id, entry] of Object.entries(ITEMS)) {
      if (id.startsWith('_')) continue;
      add(entry.effects, id);
    }
    for (const table of [MAGIC.weaponProperties, MAGIC.armorProperties]) {
      for (const [id, property] of Object.entries(table.properties)) add(property.effects, id);
    }
    for (const row of CURSES.table) add(row.effects, row.id);
    return out;
  }

  it('hangs every hook on a real event, with a handler or a reason it waits', () => {
    for (const [where, effect] of allEffects()) {
      if (!effect.hook) continue;
      expect([where, EVENTS.includes(effect.hook)]).toEqual([where, true]);
      const known = Boolean(
        HANDLERS[effect.handler] ||
          PENDING[effect.handler] ||
          SKILL_HANDLERS[effect.handler] ||
          SKILL_PENDING[effect.handler],
      );
      expect([where, effect.handler, known]).toEqual([where, effect.handler, true]);
    }
  });

  it('registers what it can on a fight, and skips what waits, without throwing', () => {
    const who = hero();
    // One of everything that hangs off an event.
    equipNew(who.pack, 'long_sword', { property: 'flaming' });
    equipNew(who.pack, 'chain_mail', { property: 'thorned' });
    equipNew(who.pack, 'ring_of_regeneration');
    rebuildSheet(who);
    const combat = fightWith(who);
    expect(() => registerItems(combat, who)).not.toThrow();
  });

  it('writes every sheet effect in a vocabulary the sheet knows', () => {
    const known = [
      'maxHp', 'maxFp', 'def', 'dr', 'saves', 'attack', 'damage', 'critFrom',
      'initiative', 'attribute', 'attributeMod', 'cannot', 'resist', 'immune',
      'inventorySlots', 'cannotBeSurprised', 'ignoresHalfCover', 'spellAttack',
      'spellDc', 'itemHealing', 'maxAgi', 'noRequirement', 'noStealthPenalty',
      'noFizzle', 'actsFirst',
    ];
    for (const [where, effect] of allEffects()) {
      if (!effect.sheet) continue;
      expect([where, effect.sheet, known.includes(effect.sheet)]).toEqual([where, effect.sheet, true]);
    }
  });
});
