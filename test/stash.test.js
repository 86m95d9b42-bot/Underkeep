/**
 * @vitest-environment happy-dom
 *
 * The Town Stash (`04` section 1: fifty slots of things that stay safe
 * between trips).
 *
 * A stash is a pack with a bigger capacity, so the slot and stacking rules
 * are the pack's own; what is tested here is the two ways across and the
 * screen that shows both lists at once.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  STASH_SLOTS,
  stashOf,
  stashUse,
  storable,
  store,
  whyNotStore,
  whyNotWithdraw,
  withdraw,
} from '../src/systems/stash.js';
import { stash as stashScreen, REGIONS, pickOf } from '../src/ui/screens/stash.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem, equipNew, slotsUsed } from '../src/systems/inventory.js';
import { isIdentified } from '../src/systems/identification.js';
import { t } from '../src/data/strings.js';

const SCORES = { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 12, luck: 10 };

function makeHero() {
  return finish(
    setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores: SCORES }, 'sellsword'), 'Harrow'),
  );
}

function mount({ frame = 'tall', hero = makeHero() } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = stashScreen.build({ router, run: { hero }, frame, settings: { all: {} } });
  return { built, router, hero, placed: placeRegions(stashScreen, frame) };
}

/** The row in one of the two lists whose text contains this. */
const rowIn = (box, text) =>
  [...box.querySelectorAll('button')].find((node) => node.textContent.includes(text));

describe('fifty slots in town (04 section 1)', () => {
  it('is a pack with the document\'s own capacity', () => {
    const hero = makeHero();
    expect(STASH_SLOTS).toBe(50);
    expect(stashOf(hero).capacity).toBe(50);
    expect(stashUse(hero)).toEqual({ used: 0, total: 50 });
    // And it is made once, not on every ask.
    expect(stashOf(hero)).toBe(hero.stash);
  });

  it('numbers its own items, so an id never means two things', () => {
    const hero = makeHero();
    const ration = hero.pack.items.find((entry) => entry.baseId === 'ration');
    store(hero, ration.instanceId, 1);
    expect(hero.stash.items[0].instanceId).toMatch(/^sth_/);
    expect(hero.pack.items.every((entry) => entry.instanceId.startsWith('itm_'))).toBe(true);
  });

  it('puts things away and takes them back, keeping what they are', () => {
    const hero = makeHero();
    const tonic = addItem(hero.pack, 'focus_tonic', { identified: false }).entry;
    expect(store(hero, tonic.instanceId, 1)).toMatchObject({ ok: true, moved: 1 });
    expect(hero.pack.items).not.toContain(tonic);

    const stored = hero.stash.items[0];
    expect(stored.baseId).toBe('focus_tonic');
    // Unknown when it went in, unknown when it comes out.
    expect(isIdentified(hero.identification, stored)).toBe(false);
    expect(withdraw(hero, stored.instanceId, 1)).toMatchObject({ ok: true, moved: 1 });
    expect(stashUse(hero).used).toBe(0);
    expect(hero.pack.items.some((entry) => entry.baseId === 'focus_tonic')).toBe(true);
  });

  it('moves part of a stack', () => {
    const hero = makeHero();
    const potions = addItem(hero.pack, 'healing_potion', { count: 4 }).entry;
    store(hero, potions.instanceId, 3);
    expect(potions.count).toBe(1);
    expect(hero.stash.items[0].count).toBe(3);
  });

  it('will not store what is worn or bound', () => {
    const hero = makeHero();
    const worn = hero.pack.items.find((entry) => entry.baseId === 'long_sword');
    expect(whyNotStore(hero, worn.instanceId)).toBe('worn');
    const cursed = addItem(hero.pack, 'mace', { curse: 'leaden', bound: true }).entry;
    expect(whyNotStore(hero, cursed.instanceId)).toBe('cursedInPlace');
    expect(store(hero, cursed.instanceId)).toMatchObject({ ok: false, why: 'cursedInPlace' });
    expect(storable(hero).map((entry) => entry.baseId)).not.toContain('long_sword');
  });

  it('says when either side has no room', () => {
    const hero = makeHero();
    const plate = addItem(hero.pack, 'plate').entry;
    stashOf(hero).capacity = 2;
    expect(whyNotStore(hero, plate.instanceId)).toBe('stashFull');

    stashOf(hero).capacity = 50;
    store(hero, plate.instanceId);
    const stored = hero.stash.items.find((entry) => entry.baseId === 'plate');
    hero.pack.capacity = slotsUsed(hero.pack);
    expect(whyNotWithdraw(hero, stored.instanceId)).toBe('packFull');
    expect(withdraw(hero, stored.instanceId)).toMatchObject({ ok: false, why: 'packFull' });
  });

  it('answers for things that are not there', () => {
    const hero = makeHero();
    expect(whyNotStore(hero, 'itm_9999')).toBe('notCarried');
    expect(whyNotWithdraw(hero, 'sth_9999')).toBe('notStored');
  });
});

describe('where the Stash puts things', () => {
  it("follows the outline's Stash table", () => {
    // Bar 1-2, pack 3-9, stash 10-16, the two buttons 17-18.
    expect(REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(REGIONS.pack.tall).toEqual([1, 9, 3, 9]);
    expect(REGIONS.stash.tall).toEqual([1, 9, 10, 16]);
    expect(REGIONS.toStash.tall).toEqual([1, 5, 17, 18]);
    expect(REGIONS.toPack.tall).toEqual([6, 9, 17, 18]);
  });

  it('puts the pack left and the stash right when wide', () => {
    // 00: "Pack left, stash right, move buttons in row 9 under each".
    expect(REGIONS.pack.wide[1]).toBe(9);
    expect(REGIONS.stash.wide[0]).toBe(10);
    expect(REGIONS.toStash.wide[3]).toBe(9);
    expect(REGIONS.toPack.wide[3]).toBe(9);
  });

  it('places cleanly in both frames, and both lists scroll', () => {
    expect(validateScreen(stashScreen, 'tall')).toEqual([]);
    expect(validateScreen(stashScreen, 'wide')).toEqual([]);
    const { built } = mount();
    const scrolls = Object.values(built).filter((node) => node.querySelector?.('.scroll'));
    expect(scrolls).toEqual([built.pack, built.stash]);
  });
});

describe('what the Stash shows', () => {
  it('counts the slots on both sides, as the mockup does', () => {
    const hero = makeHero();
    const { built } = mount({ hero });
    expect(built.pack.textContent).toContain(
      t('stash.pack', { used: slotsUsed(hero.pack), total: hero.pack.capacity }),
    );
    expect(built.stash.textContent).toContain(t('stash.stash', { used: 0, total: 50 }));
    expect(built.stash.textContent).toContain(t('stash.emptyStash'));
  });

  it('marks what is worn, and keeps it out of the move', () => {
    const hero = makeHero();
    const { built } = mount({ hero });
    expect(built.pack.textContent).toContain(t('pack.equipped'));
    rowIn(built.pack, 'Long Sword').click();
    expect(built.toStash.textContent).toContain(t('stash.why.worn'));
  });

  it('moves what is picked, from whichever side it was picked on', () => {
    const hero = makeHero();
    addItem(hero.pack, 'healing_potion', { count: 2 });
    const { built } = mount({ hero });

    rowIn(built.pack, 'Healing Potion').click();
    expect(built.toStash.textContent).toContain(t('stash.moves', { name: 'Healing Potion' }));
    expect(built.toPack.textContent).toContain(t('stash.why.pick'));
    built.toStash.querySelector('button').click();
    expect(stashUse(hero).used).toBe(1);
    expect(built.stash.textContent).toContain('Healing Potion');

    rowIn(built.stash, 'Healing Potion').click();
    built.toPack.querySelector('button').click();
    expect(stashUse(hero).used).toBe(0);
  });

  it('makes the button that applies the primary one', () => {
    const hero = makeHero();
    const { built } = mount({ hero });
    // Nothing picked: neither is primary, and both say why.
    expect(built.toStash.querySelector('.btn--primary')).toBe(null);
    expect(built.toPack.querySelector('.btn--primary')).toBe(null);

    rowIn(built.pack, 'Ration').click();
    expect(built.toStash.querySelector('.btn--primary')).toBeTruthy();
    expect(built.toPack.querySelector('.btn--primary')).toBe(null);
    expect(built.toPack.querySelector('button').disabled).toBe(true);
  });

  it('keeps the two lists\' picks apart', () => {
    const hero = makeHero();
    const ration = hero.pack.items.find((entry) => entry.baseId === 'ration');
    expect(pickOf('pack', ration)).toBe(`pack:${ration.instanceId}`);
    expect(pickOf('stash', { instanceId: 'sth_0001' })).toBe('stash:sth_0001');
  });

  it('shows an unknown item by its look on either side', () => {
    const hero = makeHero();
    const tonic = addItem(hero.pack, 'focus_tonic', { identified: false }).entry;
    store(hero, tonic.instanceId, 1);
    const { built } = mount({ hero });
    expect(built.stash.textContent).not.toContain('Focus Tonic');
    expect(built.stash.textContent).toContain('Potion');
  });

  it('carries a worn charm out of the way before it can be stored', () => {
    const hero = makeHero();
    const ring = equipNew(hero.pack, 'ring_of_protection');
    expect(whyNotStore(hero, ring.instanceId)).toBe('worn');
  });
});
