/**
 * Knowing what you are carrying (`04` section 5).
 *
 * Two halves: the per-game shuffle — a look for every unknown potion and a
 * title for every scroll, the same in one game and different in the next — and
 * the table of ways to learn what something is.
 */
import { describe, it, expect } from 'vitest';
import {
  BONUS_COMBATS,
  CHARM_STEPS,
  afterCombat,
  afterSteps,
  createIdentification,
  curseName,
  describe as describeItem,
  identify,
  identifyPack,
  isIdentified,
  isKnownType,
  isRevealed,
  learnType,
  lookOf,
  nameOf,
  onBuy,
  onEquip,
  onPickUp,
  onTrigger,
  onUse,
  sageFee,
  scrollTypes,
  secretsOf,
  titleOf,
  unknownIn,
  unknownPotions,
} from '../src/systems/identification.js';
import { IDENTIFICATION } from '../src/data/items.js';
import { addItem, createPack, equip, equipNew } from '../src/systems/inventory.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { learn } from '../src/systems/skill-tree.js';

const SCORES = { might: 13, agility: 12, vigor: 12, intellect: 13, wits: 12, luck: 10 };

function hero(origin = 'apprentice', seed = 8) {
  return finish(setName(chooseOrigin({ ...createDraft({ seed }), scores: SCORES }, origin), 'Ora'));
}

describe('the looks and titles of one game (04 sections 5 and 17)', () => {
  it('gives every unknown potion its own appearance', () => {
    const state = createIdentification(1);
    const potions = unknownPotions();
    expect(potions.length).toBeGreaterThan(12);
    const looks = potions.map((id) => lookOf(state, id));
    expect(looks.every(Boolean)).toBe(true);
    expect(new Set(looks).size).toBe(looks.length);
    for (const look of looks) expect(IDENTIFICATION.potionLooks).toContain(look);
    // Healing Potions and Antidotes are always known, so they have none.
    expect(lookOf(state, 'healing_potion')).toBe(null);
  });

  it('gives every scroll its own two-word title', () => {
    const state = createIdentification(1);
    const titles = scrollTypes().map((id) => titleOf(state, id));
    expect(titles).toHaveLength(19);
    expect(new Set(titles).size).toBe(19);
    for (const title of titles) {
      const words = title.split(' ');
      expect(words).toHaveLength(2);
      expect(words[0]).not.toBe(words[1]);
      for (const word of words) expect(IDENTIFICATION.scrollWords).toContain(word);
    }
  });

  it('shuffles differently in another game, and the same in the same one', () => {
    const one = createIdentification(1);
    const two = createIdentification(2);
    const again = createIdentification(1);
    expect(again).toEqual(one);
    expect(two.potionLooks).not.toEqual(one.potionLooks);
    expect(two.scrollTitles).not.toEqual(one.scrollTitles);
  });

  it('knows the two the document says are never a mystery', () => {
    const state = createIdentification(3);
    expect(state.knownTypes).toEqual(['healing_potion', 'antidote']);
    expect(isKnownType(state, 'healing_potion')).toBe(true);
    expect(isKnownType(state, 'focus_tonic')).toBe(false);
  });

  it('is made once when the hero is, and the kit is known from the start', () => {
    const who = hero();
    expect(who.identification.potionLooks).toBeTruthy();
    // The Apprentice walks in with a Scroll of Sleep, and knows it.
    expect(isKnownType(who.identification, 'scroll_of_sleep')).toBe(true);
    for (const entry of who.pack.items) expect(isIdentified(who.identification, entry)).toBe(true);
  });
});

describe('what an item is called (04 sections 5 and 16)', () => {
  const state = createIdentification(5);

  it('shows an unknown potion by its look and a scroll by its title', () => {
    expect(nameOf({ baseId: 'focus_tonic' }, state)).toBe(`${lookOf(state, 'focus_tonic')} Potion`);
    expect(nameOf({ baseId: 'scroll_of_fireball' }, state)).toBe(
      `Scroll labeled ${titleOf(state, 'scroll_of_fireball')}`,
    );
    // And by its real name once the type is known.
    const known = { ...state, knownTypes: [...state.knownTypes, 'focus_tonic'] };
    expect(nameOf({ baseId: 'focus_tonic' }, known)).toBe('Focus Tonic');
  });

  it('shows unknown gear as its base type, and an unknown charm as a plain one', () => {
    expect(nameOf({ baseId: 'long_sword', bonus: 2 }, state)).toBe('Unknown Long Sword');
    expect(nameOf({ baseId: 'ring_of_protection' }, state)).toBe('Plain Ring');
    expect(nameOf({ baseId: 'ring_of_warmth' }, state)).toBe('Plain Ring');
    // A legendary is a plain-looking thing until someone names it.
    expect(nameOf({ baseId: 'whisper' }, state)).toBe('Unknown Dagger');
    expect(nameOf({ baseId: 'mages_robe' }, state)).toBe('Unknown Robe');
  });

  it('builds the name up as the secrets come out', () => {
    const sword = { baseId: 'long_sword', bonus: 2, property: 'flaming' };
    expect(nameOf(sword, state)).toBe('Unknown Long Sword');
    identify(state, sword);
    expect(nameOf(sword, state)).toBe('Flaming Long Sword +2');
  });

  it('shows a cursed item for what it is, and a negative bonus with its sign', () => {
    const cursed = { baseId: 'long_sword', bonus: -1, curse: 'leaden' };
    identify(state, cursed);
    expect(nameOf(cursed, state)).toBe('Cursed Long Sword -1');
    expect(curseName('leaden')).toBe('Leaden');
  });

  it('never shows an unknown item’s rarity, which would give a curse away', () => {
    const cursed = { baseId: 'long_sword', bonus: -1, curse: 'leaden', rarity: 'cursed' };
    const card = describeItem(cursed, state);
    expect(card).toMatchObject({ rarity: 'unknown', badge: '?', identified: false, cursed: false });
    identify(state, cursed);
    expect(describeItem(cursed, state)).toMatchObject({ rarity: 'cursed', badge: '!', cursed: true });
  });

  it('describes a plain item as itself', () => {
    const card = describeItem({ baseId: 'torch', count: 3, rarity: 'common' }, state);
    expect(card).toMatchObject({ name: 'Torch', count: 3, identified: true, rarity: 'common', badge: null });
  });
});

describe('what an item is keeping secret', () => {
  it('counts the bonus, the property and the curse on gear', () => {
    expect(secretsOf({ baseId: 'long_sword', bonus: 2, property: 'keen' })).toEqual(['bonus', 'property']);
    expect(secretsOf({ baseId: 'plate', bonus: -2, curse: 'gloom' })).toEqual(['bonus', 'curse']);
    expect(secretsOf({ baseId: 'long_sword' })).toEqual([]);
  });

  it('counts what a charm or a magic robe does as one secret', () => {
    expect(secretsOf({ baseId: 'ring_of_protection' })).toEqual(['effect']);
    expect(secretsOf({ baseId: 'mages_robe' })).toEqual(['effect']);
  });

  it('counts a potion or a scroll as its type, shared by every one like it', () => {
    expect(secretsOf({ baseId: 'focus_tonic' })).toEqual(['type']);
    expect(secretsOf({ baseId: 'healing_potion' })).toEqual([]);
  });
});

describe('the ways to identify (04 section 5)', () => {
  it('charges the Sage twenty gold an item', () => {
    expect(sageFee()).toBe(20);
    expect(sageFee(4)).toBe(80);
  });

  it('lets a hero with Lore know at a glance, and everyone else carry it blind', () => {
    const plain = hero('sellsword');
    const drop = { baseId: 'long_sword', bonus: 1 };
    expect(onPickUp(plain, drop)).toMatchObject({ identified: false, by: null });

    const scholar = hero('apprentice');
    scholar.skillPoints = 1;
    learn(scholar, 'lore');
    const other = { baseId: 'long_sword', bonus: 1 };
    expect(onPickUp(scholar, other)).toMatchObject({ identified: true, by: 'lore' });
    expect(isIdentified(scholar.identification, other)).toBe(true);
  });

  it('identifies everything bought in a shop', () => {
    const state = createIdentification(7);
    const potion = { baseId: 'focus_tonic' };
    expect(onBuy(state, potion)).toMatchObject({ identified: true, by: 'bought' });
    expect(isKnownType(state, 'focus_tonic')).toBe(true);
  });

  it('learns the whole type from drinking one or reading one', () => {
    const state = createIdentification(7);
    expect(onUse(state, { baseId: 'quicksilver' })).toMatchObject({ by: 'drunk', identified: true });
    expect(isKnownType(state, 'quicksilver')).toBe(true);
    // Every other one of that type is now known too.
    expect(isIdentified(state, { baseId: 'quicksilver' })).toBe(true);
    expect(onUse(state, { baseId: 'scroll_of_knock' })).toMatchObject({ by: 'read' });
    expect(nameOf({ baseId: 'scroll_of_knock' }, state)).toBe('Scroll of Knock');
  });

  it('identifies every unknown item in the pack, which is what the scroll does', () => {
    const state = createIdentification(9);
    const pack = createPack({ capacity: 12 });
    addItem(pack, 'focus_tonic', { identified: false });
    addItem(pack, 'long_sword', { bonus: 1, identified: false });
    addItem(pack, 'torch', { count: 2 });
    expect(unknownIn(state, pack)).toHaveLength(2);
    const learned = identifyPack(state, pack);
    expect(learned).toHaveLength(2);
    expect(unknownIn(state, pack)).toHaveLength(0);
    expect(isKnownType(state, 'focus_tonic')).toBe(true);
  });

  it('learns a type once and not twice', () => {
    const state = createIdentification(9);
    expect(learnType(state, 'quicksilver')).toBe(true);
    expect(learnType(state, 'quicksilver')).toBe(false);
  });
});

describe('what wearing something teaches you (04 section 5, Equipping)', () => {
  it('gives a curse away the moment it goes on', () => {
    const state = createIdentification(11);
    const cursed = { baseId: 'long_sword', bonus: -1, curse: 'unlucky' };
    const put = onEquip(state, cursed);
    expect(put).toMatchObject({ by: 'curse', cursed: true });
    expect(isRevealed(cursed, 'curse')).toBe(true);
    // The bonus is still a mystery, so it is not identified yet.
    expect(isIdentified(state, cursed)).toBe(false);
    expect(nameOf(cursed, state)).toBe('Cursed Long Sword');
  });

  it('shows the bonus after one combat, and not before', () => {
    const state = createIdentification(11);
    const pack = createPack({ capacity: 10 });
    const sword = addItem(pack, 'long_sword', { bonus: 2, identified: false }).entry;
    equip(pack, sword.instanceId);
    onEquip(state, sword);
    expect(BONUS_COMBATS).toBe(1);
    expect(isRevealed(sword, 'bonus')).toBe(false);
    const learned = afterCombat(state, pack);
    expect(learned).toEqual([sword]);
    expect(nameOf(sword, state)).toBe('Long Sword +2');
    // Nothing more to learn, so it is identified.
    expect(isIdentified(state, sword)).toBe(true);
    expect(afterCombat(state, pack)).toEqual([]);
  });

  it('keeps the property back until it first triggers', () => {
    const state = createIdentification(11);
    const pack = createPack({ capacity: 10 });
    const sword = addItem(pack, 'long_sword', { bonus: 1, property: 'flaming', identified: false }).entry;
    equip(pack, sword.instanceId);
    afterCombat(state, pack);
    expect(nameOf(sword, state)).toBe('Long Sword +1');
    expect(isIdentified(state, sword)).toBe(false);
    onTrigger(state, sword);
    expect(nameOf(sword, state)).toBe('Flaming Long Sword +1');
    expect(isIdentified(state, sword)).toBe(true);
  });

  it('gives a charm a hundred steps before it shows what it does', () => {
    const state = createIdentification(11);
    const pack = createPack({ capacity: 10 });
    const ring = equipNew(pack, 'ring_of_protection', { identified: false });
    onEquip(state, ring);
    expect(CHARM_STEPS).toBe(100);
    expect(afterSteps(state, pack, 99)).toEqual([]);
    expect(nameOf(ring, state)).toBe('Plain Ring');
    expect(afterSteps(state, pack, 1)).toEqual([ring]);
    expect(nameOf(ring, state)).toBe('Ring of Protection');
  });

  it('or the moment it triggers, whichever comes first', () => {
    const state = createIdentification(11);
    const pack = createPack({ capacity: 10 });
    const stone = equipNew(pack, 'bloodstone', { identified: false });
    onEquip(state, stone);
    expect(onTrigger(state, stone)).toMatchObject({ identified: true, by: 'triggered' });
    expect(nameOf(stone, state)).toBe('Bloodstone');
  });

  it('leaves what is not worn alone', () => {
    const state = createIdentification(11);
    const pack = createPack({ capacity: 10 });
    const carried = addItem(pack, 'long_sword', { bonus: 2, identified: false }).entry;
    afterCombat(state, pack);
    afterSteps(state, pack, 500);
    expect(isIdentified(state, carried)).toBe(false);
  });
});
