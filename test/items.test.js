/**
 * The item database and the loot tables (`04`).
 *
 * These are data tests: every row the document prints has to come back out of
 * `items.json` with the same numbers, and every table that turns a base item
 * into a found one — the bonuses, the properties, the curses, the gems — has
 * to be whole. The helpers in `items.js` and `loot.js` are checked against the
 * document's own worked examples.
 */
import { describe, it, expect } from 'vitest';
import {
  ALCHEMY,
  CURSES,
  IDENTIFICATION,
  ITEM_IDS,
  ITEM_RULES,
  MAGIC,
  armorPropertyFor,
  bonusTier,
  costOf,
  curseChanceOn,
  curseFor,
  damageOf,
  effectsOf,
  gemFor,
  item,
  itemOf,
  itemIds,
  itemsOfCategory,
  itemsOfRarity,
  recipeFor,
  sellFor,
  slotsFor,
  valueOf,
  weaponPropertyFor,
} from '../src/data/items.js';
import {
  CATEGORY_ROLL,
  GEAR_RULES,
  categoryFor,
  lootTable,
  lootTables,
  poolFor,
  poolNames,
  rareGearOn,
  rollFor,
} from '../src/data/loot.js';
import { ORIGINS, ORIGIN_ORDER } from '../src/data/origins.js';

/** `04` section 2, every row of it. */
const WEAPONS = [
  ['club', '1d4', 'crush', 'blunt', 1, 1],
  ['dagger', '1d4', 'pierce', 'blade', 1, 2],
  ['hand_axe', '1d6', 'slash', 'blade', 1, 8],
  ['short_sword', '1d6', 'slash', 'blade', 1, 10],
  ['rapier', '1d6', 'pierce', 'blade', 1, 25],
  ['long_sword', '1d8', 'slash', 'blade', 1, 15],
  ['great_sword', '1d12', 'slash', 'blade', 2, 50],
  ['mace', '1d6', 'crush', 'blunt', 1, 8],
  ['flail', '1d8', 'crush', 'blunt', 1, 20],
  ['warhammer', '1d10', 'crush', 'blunt', 2, 30],
  ['staff', '1d6', 'crush', 'blunt', 2, 5],
  ['spear', '1d8', 'pierce', 'polearm', 2, 5],
  ['halberd', '1d10', 'slash', 'polearm', 2, 40],
  ['sling', '1d4', 'crush', 'bow', 1, 3],
  ['shortbow', '1d6', 'pierce', 'bow', 2, 25],
  ['longbow', '1d8', 'pierce', 'bow', 2, 60],
  ['crossbow', '1d10', 'pierce', 'bow', 2, 50],
];

/** `04` section 3: armour, then the two shields. */
const ARMOR = [
  ['robe', 0, 1, 2],
  ['padded_armor', 1, 2, 5],
  ['leather_armor', 2, 2, 10],
  ['studded_leather', 3, 2, 45],
  ['chain_mail', 4, 4, 75],
  ['scale_mail', 5, 4, 200],
  ['plate', 6, 4, 400],
  ['shield', 1, 2, 10],
  ['tower_shield', 2, 3, 60],
];

describe('the item database (04 sections 2 and 3)', () => {
  it('has every weapon the table lists, with its dice, its slots and its price', () => {
    for (const [id, damage, damageType, group, slots, cost] of WEAPONS) {
      expect([id, item(id)]).toEqual([
        id,
        expect.objectContaining({ category: 'weapon', damage, damageType, group, slots, cost }),
      ]);
    }
    // The table's seventeen, plus the eight unique and legendary weapons.
    expect(itemsOfCategory('weapon')).toHaveLength(WEAPONS.length + 8);
  });

  it('gives the weapons that ask for an attribute their requirement', () => {
    expect(item('rapier').requires).toEqual({ agility: 12 });
    expect(item('great_sword').requires).toEqual({ might: 13 });
    expect(item('longbow').requires).toEqual({ might: 11 });
    expect(ITEM_RULES.requirementNotMet).toMatchObject({ toHit: -2, keepsDef: true });
  });

  it("keeps the three weapons whose row is more than a die: the rapier's, the mace's and the staff's", () => {
    expect(item('rapier').toHit).toBe(1);
    expect(item('crossbow')).toMatchObject({ toHit: 1, properties: ['ranged', 'twoHanded', 'reload'] });
    expect(item('mace').damageVs).toEqual({ undead: 1 });
    expect(effectsOf('staff')).toEqual([{ sheet: 'maxFp', value: 2 }]);
  });

  it('has every armour and shield, with DEF, slots and price', () => {
    for (const [id, def, slots, cost] of ARMOR) {
      expect([id, item(id)]).toEqual([id, expect.objectContaining({ def, slots, cost })]);
    }
  });

  it('carries the heavy armour penalties 04 section 3 lists', () => {
    expect(item('chain_mail')).toMatchObject({ heavy: true, maxAgi: 2, stealth: -2, requires: { might: 11 } });
    expect(item('scale_mail')).toMatchObject({ stealth: -3, toHit: -1, fizzle: 0.1 });
    expect(item('plate')).toMatchObject({ stealth: -4, toHit: -2, fizzle: 0.2, cancelsSneak: true });
    expect(item('tower_shield')).toMatchObject({ toHit: -1, fizzle: 0.1, slots: 3 });
    expect(item('studded_leather').maxAgi).toBe(3);
  });

  it('writes damage the way the engine reads it', () => {
    expect(damageOf('long_sword')).toBe('1d8 slash');
    expect(damageOf('crowbar')).toBe('1d4 crush');
    expect(damageOf('healing_potion')).toBe(null);
  });
});

describe('inventory and prices (04 section 1)', () => {
  it('counts slots the way section 1 does, stacks included', () => {
    expect(ITEM_RULES.inventory).toEqual({ base: 10, perMightMod: 2 });
    expect(ITEM_RULES.stashSlots).toBe(50);
    expect(ITEM_RULES.quickSlots).toBe(4);
    expect(slotsFor('long_sword')).toBe(1);
    expect(slotsFor('plate')).toBe(4);
    expect(slotsFor('tower_shield')).toBe(3);
    // Five to a slot, so six torches need two.
    expect(slotsFor('torch', 5)).toBe(1);
    expect(slotsFor('torch', 6)).toBe(2);
    expect(slotsFor('quartz', 10)).toBe(1);
    expect(slotsFor('quartz', 11)).toBe(2);
    // The Floor Key is the one thing that is carried for nothing.
    expect(slotsFor('floor_key')).toBe(0);
  });

  it('prices magic gear from the bonus and the property (04 section 4)', () => {
    expect(bonusTier(1)).toMatchObject({ rarity: 'uncommon', fromFloor: 1, price: 150 });
    expect(bonusTier(2)).toMatchObject({ rarity: 'rare', fromFloor: 4, price: 600 });
    expect(bonusTier(3)).toMatchObject({ rarity: 'rare', fromFloor: 8, price: 2000 });
    expect(costOf('long_sword')).toBe(15);
    expect(costOf('long_sword', { bonus: 1 })).toBe(165);
    expect(costOf('long_sword', { bonus: 2, property: 'flaming' })).toBe(915);
    expect(costOf('shield', { bonus: 1, property: 'warded' })).toBe(460);
  });

  it('sells at half price, valuables at all of it, and an unknown item as plain', () => {
    expect(ITEM_RULES.shop).toMatchObject({ sellRate: 0.5, valuableSellRate: 1, luckDiscountPerMod: 0.05 });
    expect(sellFor('long_sword')).toBe(7);
    expect(sellFor('long_sword', { bonus: 2 })).toBe(307);
    expect(sellFor('long_sword', { bonus: 2, identified: false })).toBe(7);
    expect(sellFor('ruby')).toBe(500);
    expect(sellFor('rat_tail')).toBe(1);
    expect(sellFor('troll_blood')).toBe(100);
    expect(sellFor('floor_key')).toBe(0);
  });

  it('scales the parts that are worth more the deeper they are found', () => {
    expect(valueOf('trap_parts', 1)).toBe(5);
    expect(valueOf('trap_parts', 7)).toBe(35);
    expect(valueOf('crossbow_parts')).toBe(50);
    expect(valueOf('long_sword')).toBe(null);
  });
});

describe('consumables and gear (04 sections 8 to 11)', () => {
  it('has the potions the document prices', () => {
    expect(item('healing_potion')).toMatchObject({ rarity: 'common', cost: 25, use: { heal: '2d6+2' } });
    expect(item('greater_healing_potion')).toMatchObject({ rarity: 'uncommon', cost: 100, use: { heal: '4d6+4' } });
    expect(item('elixir_of_life')).toMatchObject({ rarity: 'rare', cost: 500 });
    expect(item('focus_tonic').use).toEqual({ restoreFp: '2d4' });
    expect(item('potion_of_clarity').use.cure).toEqual(['weakened', 'sickened', 'feared', 'blinded']);
    // Found only, and the document gives it a sale price instead of a cost.
    expect(item('troll_blood')).toMatchObject({ cost: null, sell: 100 });
  });

  it('keeps the four harmful potions out of every loot pool', () => {
    for (const id of ['tainted_potion', 'draught_of_slumber', 'potion_of_confusion', 'potion_of_weakness']) {
      expect([id, item(id).harmful]).toEqual([id, true]);
      expect(poolFor('rare_potion')).not.toContain(id);
      expect(poolFor('uncommon_potion')).not.toContain(id);
    }
  });

  it('has all nineteen scrolls, each in a school, and the spells they cast', () => {
    const scrolls = itemsOfCategory('scroll');
    expect(scrolls).toHaveLength(19);
    expect(item('scroll_of_identify')).toMatchObject({ school: 'arcane', rarity: 'uncommon', cost: 40 });
    expect(item('scroll_of_fireball')).toMatchObject({ school: 'arcane', rarity: 'rare', cost: 200, casts: 'fireball', minimum: '5d6' });
    expect(item('scroll_of_mend')).toMatchObject({ school: 'spirit', casts: 'mend' });
    expect(item('scroll_of_dispel').casts).toBe('dispel_ward');
    expect(ITEM_RULES.scrollRequirements).toEqual({ arcane: { intellect: 11 }, spirit: { wits: 11 } });
  });

  it('has the bombs, with the save DC 04 section 10 gives them', () => {
    expect(itemsOfCategory('bomb')).toHaveLength(8);
    expect(item('oil_flask')).toMatchObject({ rarity: 'common', cost: 5, fireSource: true });
    expect(item('sleep_bomb').use).toMatchObject({ target: 'row', save: 'mind', condition: 'asleep' });
    expect(ITEM_RULES.bombSaveDc).toEqual({ base: 10, perFloor: 1 });
  });

  it('has the exploration gear, torches and rations included', () => {
    expect(item('torch')).toMatchObject({ category: 'gear', cost: 1, stack: 5, use: { light: true, steps: 200 } });
    expect(item('ration')).toMatchObject({ cost: 2, stack: 5 });
    expect(item('lockpicks')).toMatchObject({ cost: 15, breakInSix: 1 });
    expect(item('crowbar')).toMatchObject({ cost: 10, damage: '1d4' });
    expect(effectsOf('crowbar')).toContainEqual({ explore: 'bash', value: 2 });
    expect(effectsOf('masterwork_lockpicks')).toContainEqual({ explore: 'picksNeverBreak' });
    expect(item('skeleton_key').use).toMatchObject({ opensLock: 'any', except: ['sealed'], usedUp: true });
  });

  it('has the charms of both tiers at their two prices', () => {
    const charms = itemsOfCategory('charm');
    const uncommon = charms.filter((id) => item(id).rarity === 'uncommon');
    const rare = charms.filter((id) => item(id).rarity === 'rare');
    expect(uncommon).toHaveLength(14);
    expect(rare).toHaveLength(12);
    for (const id of uncommon) expect([id, item(id).cost]).toEqual([id, 200]);
    for (const id of rare) expect([id, item(id).cost]).toEqual([id, 800]);
    expect(effectsOf('ring_of_protection')).toEqual([{ sheet: 'def', value: 1 }]);
    expect(effectsOf('amulet_of_vigor')).toEqual([{ sheet: 'maxHp', value: 8 }]);
    expect(effectsOf('ring_of_free_action')[0].conditions).toEqual(['paralyzed', 'webbed', 'grabbed']);
  });

  it('has the three magic robes of section 4', () => {
    expect(item('mages_robe')).toMatchObject({ rarity: 'uncommon', cost: 150 });
    expect(effectsOf('mages_robe')).toContainEqual({ sheet: 'maxFp', value: 2 });
    expect(item('archons_vestments')).toMatchObject({ rarity: 'rare', def: 2, cost: 900 });
  });
});

describe('magic, curses and identification (04 sections 4, 5 and 6)', () => {
  it('rolls a weapon property on a whole d12', () => {
    expect(MAGIC.weaponProperties.die).toBe(12);
    expect(MAGIC.weaponProperties.price).toBe(300);
    expect(weaponPropertyFor(1).id).toBe('flaming');
    expect(weaponPropertyFor(1).effects).toEqual([{ sheet: 'damage', add: '1d6', damageType: 'fire' }]);
    expect(weaponPropertyFor(5).effects).toEqual([{ sheet: 'critFrom', widen: 1 }]);
    expect(weaponPropertyFor(11)).toMatchObject({ id: 'seeking', rerollFor: ['melee'] });
    expect(weaponPropertyFor(12).id).toBe('thundering');
    for (let roll = 1; roll <= 12; roll += 1) expect(weaponPropertyFor(roll).name).toBeTruthy();
  });

  it('rolls an armour property on a whole d10', () => {
    expect(MAGIC.armorProperties.die).toBe(10);
    expect(armorPropertyFor(3).effects).toEqual([{ sheet: 'dr', value: 1 }]);
    expect(armorPropertyFor(9).effects).toEqual([{ sheet: 'maxHp', value: 5 }]);
    for (let roll = 1; roll <= 10; roll += 1) expect(armorPropertyFor(roll).name).toBeTruthy();
  });

  it('curses on a d8, more often the deeper the item was found', () => {
    expect(curseChanceOn(1)).toBe(0.05);
    expect(curseChanceOn(2)).toBe(0.05);
    expect(curseChanceOn(3)).toBe(0.1);
    expect(curseChanceOn(10)).toBe(0.1);
    expect(CURSES.bonus).toEqual([-1, -2]);
    expect(CURSES.alsoPropertyShare).toBe(0.5);
    expect(CURSES.cannotUnequip).toBe(true);
    expect(curseFor(1).id).toBe('leaden');
    expect(curseFor(6).effects).toEqual([{ sheet: 'maxFp', value: -3 }]);
    expect(curseFor(8).id).toBe('unlucky');
    expect(CURSES.removal).toMatchObject({ scroll: 'scroll_of_remove_curse', temple: { goldPerFloor: 50, destroysItem: true } });
  });

  it('knows healing potions and antidotes from the start, and nothing else', () => {
    expect(IDENTIFICATION.alwaysKnown).toEqual(['healing_potion', 'antidote']);
    expect(item('healing_potion').alwaysKnown).toBe(true);
    expect(item('greater_healing_potion').alwaysKnown).toBeUndefined();
  });

  it('has an appearance for every unknown potion and words for every scroll title', () => {
    const unknown = itemsOfCategory('potion').filter((id) => !item(id).alwaysKnown);
    expect(IDENTIFICATION.potionLooks.length).toBeGreaterThanOrEqual(unknown.length);
    expect(new Set(IDENTIFICATION.potionLooks).size).toBe(IDENTIFICATION.potionLooks.length);
    expect(IDENTIFICATION.potionLooks.slice(0, 3)).toEqual(['Murky', 'Bubbling', 'Silver']);
    expect(IDENTIFICATION.scrollTitleWords).toBe(2);
    expect(IDENTIFICATION.scrollWords).toContain('VORN');
    expect(IDENTIFICATION.scrollWords).toContain('ESKEL');
  });

  it('gives every way to identify something the cost the document gives it', () => {
    expect(IDENTIFICATION.methods.sage).toMatchObject({ cost: 20, per: 'item' });
    expect(IDENTIFICATION.methods.lore).toMatchObject({ skill: 'lore', when: 'pickedUp' });
    expect(IDENTIFICATION.methods.equipping).toMatchObject({ curseRevealsAtOnce: true, curseBinds: true });
    expect(IDENTIFICATION.methods.wearingCharm.afterSteps).toBe(100);
  });
});

describe('valuables, uniques and the Alchemist (04 sections 12 and 13)', () => {
  it('finds the gem a roll of d100 + floor x 5 lands on', () => {
    expect(gemFor(1, { floor: 1 })).toBe('quartz');
    expect(gemFor(30, { floor: 3 })).toBe('garnet');
    expect(gemFor(90, { floor: 1 })).toBe('emerald');
    expect(gemFor(95, { floor: 2 })).toBe('ruby');
    expect(gemFor(100, { floor: 5 })).toBe('diamond');
    // The common table caps floors 1-3 at Pearl.
    expect(gemFor(95, { floor: 2, capTo: 'pearl' })).toBe('pearl');
    expect(gemFor(20, { floor: 2, capTo: 'pearl' })).toBe('quartz');
    expect(valueOf('quartz')).toBe(10);
    expect(valueOf('diamond')).toBe(1000);
  });

  it('has the ten boss rewards and the six legendary finds, each once', () => {
    const uniques = itemsOfRarity('unique');
    expect(uniques.filter((id) => item(id).boss)).toHaveLength(10);
    expect(uniques.filter((id) => item(id).legendary)).toHaveLength(6);
  });

  it("gives a unique its base item's numbers and its own bonus", () => {
    expect(itemOf('wardens_mace')).toMatchObject({
      category: 'weapon',
      damage: '1d6',
      damageType: 'crush',
      bonus: 1,
      boss: 'bone_warden',
    });
    expect(itemOf('wardens_mace').effects).toContainEqual({ grants: 'turn_undead' });
    expect(itemOf('ashen_fang')).toMatchObject({ base: 'long_sword', damage: '1d8', bonus: 3 });
    expect(itemOf('pale_flame_staff').effects).toEqual([
      { sheet: 'maxFp', value: 2 },
      { sheet: 'maxFp', value: 4 },
      { grants: 'fireball' },
    ]);
    expect(itemOf('stormstring')).toMatchObject({ base: 'longbow', properties: ['ranged', 'twoHanded'] });
  });

  it("has the Alchemist's nine recipes, made of parts that exist", () => {
    expect(ALCHEMY.unlockedBy).toEqual({ boss: 2 });
    expect(ALCHEMY.recipes).toHaveLength(9);
    expect(recipeFor('antidote')).toMatchObject({ fee: 5, ingredients: [{ item: 'rat_tail', count: 5 }] });
    expect(recipeFor('fire_pot').result).toEqual({ item: 'fire_pot', count: 2 });
    expect(recipeFor('dragonscale_mail')).toMatchObject({ fee: 500, ingredients: [{ item: 'dragon_scale', count: 3 }] });
    expect(item('dragonscale_mail')).toMatchObject({ def: 6, maxAgi: 2, stealth: -2, craftedOnly: true });
  });

  it('prices every monster part the bestiary drops', () => {
    expect(valueOf('rat_tail')).toBe(1);
    expect(valueOf('spider_silk')).toBe(15);
    expect(valueOf('dragon_scale')).toBe(100);
    expect(itemsOfCategory('part')).toHaveLength(11);
  });
});

describe('the database as a whole', () => {
  it('lists every item once, and every id is findable', () => {
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    expect(itemIds()).toHaveLength(ITEM_IDS.length);
    for (const id of ITEM_IDS) expect([id, item(id).name]).toEqual([id, expect.any(String)]);
    expect(() => item('nothing_like_this')).toThrow(/unknown item/);
  });

  it('carries everything the four origins start with (01 section 3)', () => {
    for (const origin of ORIGIN_ORDER) {
      for (const line of ORIGINS[origin].kit) {
        expect([origin, line.item, Boolean(item(line.item))]).toEqual([origin, line.item, true]);
      }
    }
  });
});

describe('the loot tables (04 section 14, 02 section 17)', () => {
  it('rolls the category on d100 + LCK mod x 5', () => {
    expect(CATEGORY_ROLL).toMatchObject({ roll: 'd100', perLuckMod: 5 });
    expect(categoryFor(1).category).toBe(null);
    expect(categoryFor(50).category).toBe(null);
    expect(categoryFor(51).category).toBe('common');
    expect(categoryFor(76).category).toBe('uncommon');
    expect(categoryFor(93).category).toBe('rare');
    expect(categoryFor(100)).toMatchObject({ category: 'rare', rollAgain: true });
  });

  it('has the Common d12 the document prints', () => {
    expect(rollFor('common', 1).item).toBe('healing_potion');
    expect(rollFor('common', 3).item).toBe('healing_potion');
    expect(rollFor('common', 4).item).toBe('antidote');
    expect(rollFor('common', 5)).toMatchObject({ item: 'torch', count: 2 });
    expect(rollFor('common', 7)).toMatchObject({ item: 'ration', count: 2 });
    expect(rollFor('common', 8).item).toBe('healing_herb');
    expect(rollFor('common', 9).item).toBe('oil_flask');
    expect(rollFor('common', 10).item).toBe('holy_water');
    expect(rollFor('common', 11).pick).toBe('base_gear');
    expect(rollFor('common', 12).gem).toMatchObject({ capTo: 'pearl', onFloors: [1, 3] });
  });

  it('has the Uncommon d12, with the +1 gear at the top of it', () => {
    expect(rollFor('uncommon', 1)).toMatchObject({ pick: 'base_weapon', bonus: 1 });
    expect(rollFor('uncommon', 3)).toMatchObject({ pick: 'base_armor', bonus: 1 });
    expect(rollFor('uncommon', 4).pick).toBe('uncommon_scroll');
    expect(rollFor('uncommon', 6).item).toBe('focus_tonic');
    expect(rollFor('uncommon', 7).item).toBe('greater_healing_potion');
    expect(rollFor('uncommon', 10).pick).toBe('uncommon_charm');
    expect(rollFor('uncommon', 12).gem).toMatchObject({ plus: 20 });
  });

  it('has the Rare d12, with the legendary behind a floor', () => {
    expect(rollFor('rare', 1)).toMatchObject({ pick: 'base_weapon', rareGear: true });
    expect(rollFor('rare', 4)).toMatchObject({ pick: 'base_armor', rareGear: true });
    expect(rollFor('rare', 6).pick).toBe('rare_charm');
    expect(rollFor('rare', 9)).toMatchObject({ pick: 'base_gear', bonus: 1, property: true });
    expect(rollFor('rare', 11).oneOf).toEqual(['skeleton_key', 'masterwork_lockpicks']);
    expect(rollFor('rare', 12)).toMatchObject({ pick: 'legendary', fromFloor: 8 });
    expect(rollFor('rare', 12).else).toMatchObject({ pick: 'base_weapon', property: true });
  });

  it('gives rare gear the bonus its floor allows (Gear Details 2)', () => {
    expect(rareGearOn(1)).toMatchObject({ bonus: 1, property: true });
    expect(rareGearOn(3)).toMatchObject({ bonus: 1, property: true });
    expect(rareGearOn(4)).toMatchObject({ bonus: 2 });
    expect(rareGearOn(7)).toMatchObject({ bonus: 2 });
    expect(rareGearOn(8)).toMatchObject({ bonus: 2, upgrade: { die: 6, from: 5, to: 3 } });
    expect(GEAR_RULES.propertyChance).toBe(0.5);
    expect(GEAR_RULES.unidentified).toBe(true);
    expect(GEAR_RULES.curseCheck).toBe(true);
  });

  it('fills every pool with items that exist, and leaves the found-only ones out', () => {
    for (const name of poolNames()) {
      const pool = poolFor(name);
      expect([name, pool.length > 0]).toEqual([name, true]);
      for (const id of pool) expect([name, id, Boolean(item(id))]).toEqual([name, id, true]);
    }
    expect(poolFor('base_weapon')).toHaveLength(17);
    expect(poolFor('base_armor')).toHaveLength(9);
    expect(poolFor('legendary')).toHaveLength(6);
    // Found-only and crafted gear is never rolled for.
    expect(poolFor('base_armor')).not.toContain('dragonscale_mail');
    expect(poolFor('uncommon_gear')).not.toContain('rune_key');
    expect(poolFor('rare_charm')).not.toContain('eye_of_the_deep');
  });

  it('points every named row at a real item', () => {
    for (const table of Object.values(lootTables())) {
      for (const row of table) {
        if (row.item) expect(item(row.item)).toBeTruthy();
        for (const id of row.oneOf ?? []) expect(item(id)).toBeTruthy();
      }
    }
    expect(lootTable('common')).toHaveLength(9);
    expect(() => lootTable('mythic')).toThrow(/no loot table/);
    expect(() => rollFor('common', 13)).toThrow(/off the common table/);
  });
});
