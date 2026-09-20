/**
 * @vitest-environment happy-dom
 *
 * The Inn, the Temple and the Sage (`01` sections 5 and 7, `04` section 5,
 * and the Temple prices in DECISIONS).
 *
 * Three shopfronts on one screen: the rules are what each offers and what it
 * costs, and the screen is that list with one button under it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PRICES,
  SERVICE_SCREENS,
  cursedItems,
  drainedStacks,
  endsOnRest,
  isAilment,
  offersOf,
  take,
  unknownItems,
  whyNot,
} from '../src/systems/services.js';
import { inn, sage, temple, REGIONS, nameFor, subFor } from '../src/ui/screens/service.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem } from '../src/systems/inventory.js';
import { isIdentified } from '../src/systems/identification.js';
import { learn } from '../src/systems/skill-tree.js';
import { t } from '../src/data/strings.js';

const SCORES = { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 12, luck: 10 };

function makeHero({ gold = 1000, level = 1 } = {}) {
  const who = finish(
    setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores: SCORES }, 'sellsword'), 'Harrow'),
  );
  who.gold = gold;
  who.level = level;
  return who;
}

function mount(screen, { frame = 'tall', hero = makeHero() } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = screen.build({ router, run: { hero }, frame, settings: { all: {} } });
  return { built, router, hero, placed: placeRegions(screen, frame) };
}

/** The offer of one id, from a service's list. */
const offerOf = (service, hero, id) => offersOf(service, hero).find((offer) => offer.id === id);

describe('the Inn (01 section 7, and the Inn ruling)', () => {
  it('charges 5 gp a level for a full rest', () => {
    expect(PRICES.inn.goldPerLevel).toBe(5);
    const who = makeHero({ level: 7 });
    who.hp = 1;
    expect(offerOf('inn', who, 'rest').cost).toBe(35);
  });

  it('gives back hit points, Focus and what a night mends', () => {
    const who = makeHero();
    who.hp = 3;
    who.fp = 0;
    who.conditions = { weakened: {}, drained: { stacks: 1 } };
    const done = take(who, offerOf('inn', who, 'rest'));
    expect(done).toMatchObject({ ok: true, paid: 5 });
    expect(who.hp).toBe(who.maxHp);
    expect(who.fp).toBe(who.maxFp);
    // `01` section 7: both of these end on "a full rest in town".
    expect(who.conditions.weakened).toBeUndefined();
    expect(who.conditions.drained).toBeUndefined();
    expect(endsOnRest('weakened')).toBe(true);
    expect(endsOnRest('drained')).toBe(true);
    expect(endsOnRest('burning')).toBe(false);
  });

  it('has nothing to sell a hero who is already whole', () => {
    const who = makeHero();
    const offer = offerOf('inn', who, 'rest');
    expect(offer.why).toBe('nothingToRest');
    expect(whyNot(who, offer)).toBe('nothingToRest');
    expect(take(who, offer)).toMatchObject({ ok: false, why: 'nothingToRest' });
    expect(who.gold).toBe(1000);
  });

  it('will not rest a hero who cannot pay', () => {
    const who = makeHero({ gold: 2 });
    who.hp = 1;
    expect(whyNot(who, offerOf('inn', who, 'rest'))).toBe('notEnoughGold');
  });
});

describe('the Temple (the prices in DECISIONS)', () => {
  it('cures ailments at 10 gp a level, and nothing else', () => {
    const who = makeHero({ level: 7 });
    who.conditions = { poisoned: {}, drained: { stacks: 1 } };
    const offer = offerOf('temple', who, 'cure');
    expect(offer.cost).toBe(70);
    take(who, offer);
    expect(who.conditions.poisoned).toBeUndefined();
    // The drain has its own price, so the cure leaves it alone.
    expect(drainedStacks(who)).toBe(1);
    expect(isAilment('poisoned')).toBe(true);
    expect(isAilment('drained')).toBe(false);
  });

  it('restores one stack of the drain at 100 gp a level', () => {
    const who = makeHero({ level: 3, gold: 1000 });
    who.conditions = { drained: { stacks: 2 } };
    const offer = offerOf('temple', who, 'restore');
    expect(offer.cost).toBe(300);
    expect(take(who, offer)).toMatchObject({ ok: true, paid: 300 });
    expect(drainedStacks(who)).toBe(1);
    take(who, offerOf('temple', who, 'restore'));
    expect(drainedStacks(who)).toBe(0);
    expect(offerOf('temple', who, 'restore').why).toBe('notDrained');
  });

  it('lifts a curse for 50 gp a floor, and the item with it', () => {
    const who = makeHero({ gold: 1000 });
    const cursed = addItem(who.pack, 'long_sword', {
      curse: 'leaden',
      bonus: -1,
      foundOnFloor: 4,
      identified: false,
    }).entry;
    expect(cursedItems(who)).toEqual([cursed]);

    const offer = offersOf('temple', who).find((one) => one.id === 'removeCurse');
    expect(offer.cost).toBe(200);
    expect(offer.target).toBe(cursed.instanceId);
    expect(take(who, offer)).toMatchObject({ ok: true, paid: 200 });
    expect(who.gold).toBe(800);
    expect(who.pack.items).not.toContain(cursed);
    expect(cursedItems(who)).toEqual([]);
  });

  it('gives every spent point back for 100 gp a level', () => {
    const who = makeHero({ level: 4, gold: 1000 });
    who.skillPoints = 3;
    learn(who, 'weapon_training');
    learn(who, 'toughness');
    const offer = offerOf('temple', who, 'respec');
    expect(offer.cost).toBe(400);
    take(who, offer);
    expect(who.skills.every((row) => row.free)).toBe(true);
    expect(offerOf('temple', who, 'respec').why).toBe('nothingSpent');
  });
});

describe('the Sage (04 section 5)', () => {
  it('names one thing for 20 gp', () => {
    const who = makeHero();
    const tonic = addItem(who.pack, 'focus_tonic', { identified: false }).entry;
    const offer = offersOf('sage', who).find((one) => one.target === tonic.instanceId);
    expect(offer.cost).toBe(20);
    expect(take(who, offer)).toMatchObject({ ok: true, paid: 20 });
    expect(isIdentified(who.identification, tonic)).toBe(true);
  });

  it('names the lot, at 20 gp each', () => {
    const who = makeHero();
    addItem(who.pack, 'focus_tonic', { identified: false });
    addItem(who.pack, 'long_sword', { bonus: 1, identified: false });
    expect(unknownItems(who)).toHaveLength(2);
    const offer = offerOf('sage', who, 'identifyAll');
    expect(offer.cost).toBe(40);
    take(who, offer);
    expect(unknownItems(who)).toHaveLength(0);
  });

  it('has nothing to say to a hero who knows their pack', () => {
    const who = makeHero();
    expect(unknownItems(who)).toEqual([]);
    expect(offerOf('sage', who, 'identifyAll').why).toBe('nothingUnknown');
  });
});

describe('the one screen the three share', () => {
  it("follows the outline's Temple table", () => {
    // Bar 1-2, portrait 3-5, list 6-14, detail 15-16, cost and PAY 17-18.
    expect(REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(REGIONS.flavour.tall).toEqual([1, 9, 3, 5]);
    expect(REGIONS.list.tall).toEqual([1, 9, 6, 14]);
    expect(REGIONS.detail.tall).toEqual([1, 9, 15, 16]);
    expect(REGIONS.cost.tall).toEqual([1, 4, 17, 18]);
    expect(REGIONS.pay.tall).toEqual([5, 9, 17, 18]);
  });

  it('is the same screen three times over', () => {
    expect(SERVICE_SCREENS).toEqual(['inn', 'temple', 'sage']);
    for (const screen of [inn, temple, sage]) {
      expect(screen.regions).toBe(REGIONS);
      expect(screen.pattern).toBe('list-detail');
      expect(validateScreen(screen, 'tall')).toEqual([]);
      expect(validateScreen(screen, 'wide')).toEqual([]);
    }
    expect([inn.id, temple.id, sage.id]).toEqual(['inn', 'temple', 'sage']);
  });

  it('lets only the service list scroll', () => {
    const { built } = mount(temple);
    const scrolls = Object.values(built).filter((node) => node.querySelector?.('.scroll'));
    expect(scrolls).toEqual([built.list]);
  });

  it('names each house and shows the gold on hand', () => {
    for (const [screen, id] of [[inn, 'inn'], [temple, 'temple'], [sage, 'sage']]) {
      const { built } = mount(screen, { hero: makeHero({ gold: 312 }) });
      expect(built.topBar.textContent).toContain(t(`service.${id}.title`));
      expect(built.topBar.textContent).toContain(t('service.gold', { n: 312 }));
      expect(built.flavour.textContent).toContain(t(`service.${id}.flavour`));
    }
  });

  it('lists what is on offer, dimming what it cannot do', () => {
    const who = makeHero();
    const { built } = mount(temple, { hero: who });
    expect(built.list.textContent).toContain(t('service.temple.cure.name'));
    expect(built.list.textContent).toContain(t('service.temple.cure.nothing'));
    const rows = [...built.list.querySelectorAll('button')];
    expect(rows.find((row) => row.textContent.includes(t('service.temple.cure.name'))).disabled).toBe(true);
  });

  it('pays for what is picked, and says why the button is off until then', () => {
    const who = makeHero();
    who.hp = 1;
    const { built } = mount(inn, { hero: who });
    expect(built.pay.textContent).toContain(t('service.why.pick'));

    const row = [...built.list.querySelectorAll('button')].find((node) =>
      node.textContent.includes(t('service.inn.rest.name')),
    );
    row.click();
    expect(built.detail.textContent).toContain(t('service.inn.rest.detail'));
    expect(built.cost.textContent).toContain(t('service.cost', { n: 5 }));

    built.pay.querySelector('button').click();
    expect(who.hp).toBe(who.maxHp);
    expect(who.gold).toBe(995);
  });

  it('names a cursed item and the floor it came from', () => {
    const who = makeHero();
    const cursed = addItem(who.pack, 'mace', { curse: 'gloom', foundOnFloor: 5, identified: false }).entry;
    const offer = offersOf('temple', who).find((one) => one.id === 'removeCurse');
    expect(nameFor('temple', offer)).toBe(t('service.temple.removeCurse.name'));
    const sub = subFor('temple', offer, who);
    expect(sub).toContain('5');
    expect(sub).toContain('Unknown Mace');
    expect(cursed.curse).toBe('gloom');
  });

  it('has one primary button on each of the three', () => {
    for (const screen of [inn, temple, sage]) {
      const { built } = mount(screen);
      const primary = Object.values(built).flatMap((node) => [
        ...(node.querySelectorAll?.('.btn--primary') ?? []),
      ]);
      expect([screen.id, primary.length]).toEqual([screen.id, 1]);
    }
  });
});
