/**
 * @vitest-environment happy-dom
 *
 * The Shop (`04` sections 1 and 15).
 *
 * What is on the shelves is the tiers the hero has unlocked plus the rotating
 * lines, rerolled on each return; the prices are section 1's, with Luck and
 * the Merchant's Seal on top. The screen draws those and strikes the deal.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SHOP_RULES,
  TABS,
  TIERS,
  buy,
  buyDiscount,
  fixedStock,
  offerFor,
  openShop,
  priceOf,
  repair,
  repairCost,
  repairable,
  rollRotating,
  sell,
  sellBonus,
  sellable,
  whyNotBuy,
  whyNotSell,
} from '../src/systems/shop.js';
import { shop as shopScreen, REGIONS, average, compareChips, nameOfStock } from '../src/ui/screens/shop.js';
import { summaryOf } from '../src/ui/parts/item-line.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { bossDefeated, createTown } from '../src/systems/town.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem, equipNew } from '../src/systems/inventory.js';
import { rebuildSheet } from '../src/systems/levelling.js';
import { isIdentified } from '../src/systems/identification.js';
import { costOf, item } from '../src/data/items.js';
import { restockStream } from '../src/engine/rng.js';
import { t } from '../src/data/strings.js';

const SCORES = { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 12, luck: 10 };

function makeHero(scores = SCORES) {
  const who = finish(
    setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores }, 'sellsword'), 'Harrow'),
  );
  who.gold = 1000;
  return who;
}

/** A town with the bosses that open each tier. */
function townAt(tier, day = 1) {
  const town = createTown({ day });
  for (const row of TIERS) {
    if (row.tier <= tier && row.unlockedBy) bossDefeated(town, row.unlockedBy.boss);
  }
  return town;
}

function mount({ frame = 'tall', hero = makeHero(), open, params = {} } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const shelves = open ?? openShop({ town: townAt(1), masterSeed: 7 });
  const run = { hero, floor: { floor: 1 } };
  const built = shopScreen.build({ router, run, shop: shelves, params, frame, settings: { all: {} } });
  return { built, router, hero, open: shelves, placed: placeRegions(shopScreen, frame) };
}

/** Every button in a built screen, by its visible label. */
function buttons(built) {
  const found = new Map();
  for (const node of Object.values(built)) {
    const nodes = [
      ...(node.tagName === 'BUTTON' ? [node] : []),
      ...(node.querySelectorAll?.('button') ?? []),
    ];
    for (const btn of nodes) {
      const label = (btn.querySelector('.label')?.textContent ?? btn.textContent).trim();
      if (label && !found.has(label)) found.set(label, btn);
    }
  }
  return found;
}

describe('what is on the shelves (04 section 15)', () => {
  it('opens with every base weapon and the first tier\'s list', () => {
    const stock = fixedStock(1);
    for (const id of ['club', 'crossbow', 'long_sword']) expect(stock).toContain(id);
    for (const id of ['robe', 'chain_mail', 'shield', 'healing_potion', 'scroll_of_light', 'crowbar']) {
      expect(stock).toContain(id);
    }
    // And nothing from a tier that has not been unlocked.
    for (const id of ['plate', 'greater_healing_potion', 'elixir_of_life']) {
      expect(stock).not.toContain(id);
    }
  });

  it('adds each tier as its boss falls', () => {
    expect(fixedStock(2)).toContain('plate');
    expect(fixedStock(2)).toContain('scroll_of_identify');
    expect(fixedStock(3)).toContain('masterwork_lockpicks');
    expect(fixedStock(4)).toContain('scroll_of_fireball');
    expect(fixedStock(5)).toContain('restoration_draught');
  });

  it('never stocks a unique, a legendary or anything it cannot price', () => {
    for (const id of fixedStock(5)) {
      expect([id, item(id).rarity]).not.toEqual([id, 'unique']);
      expect([id, item(id).cost]).not.toEqual([id, null]);
    }
  });

  it('rolls the rotating lines the table names', () => {
    const rng = restockStream(7, 1);
    const rotating = rollRotating(3, rng);
    // Tier 3: two +1 weapons, one +1 armour or shield, a charm, a robe.
    expect(rotating).toHaveLength(5);
    expect(rotating.filter((row) => row.bonus === 1)).toHaveLength(3);
    for (const row of rotating) expect(row.rotating).toBe(true);
  });

  it('never rolls better than a +2 (04 section 15)', () => {
    for (let day = 1; day <= 20; day += 1) {
      for (const row of rollRotating(5, restockStream(day, day))) {
        expect([day, row.bonus]).toEqual([day, expect.any(Number)]);
        expect(row.bonus).toBeLessThanOrEqual(SHOP_RULES.maxBonus);
        expect(item(row.baseId).rarity).not.toBe('unique');
      }
    }
  });

  it('rerolls the rotating stock on each return, and not before', () => {
    const first = openShop({ town: townAt(3, 1), masterSeed: 5 });
    const same = openShop({ town: townAt(3, 1), masterSeed: 5 });
    const later = openShop({ town: townAt(3, 2), masterSeed: 5 });
    const ids = (shelf) => shelf.stock.filter((row) => row.rotating).map((row) => row.baseId).join();
    expect(ids(same)).toBe(ids(first));
    expect(ids(later)).not.toBe(ids(first));
  });

  it('sells the once-only item once in a game', () => {
    const town = townAt(5);
    const sold = [];
    const hero = makeHero();
    hero.gold = 5000;
    const first = openShop({ town, masterSeed: 3, sold });
    const vestments = first.stock.find((row) => row.baseId === 'archons_vestments');
    expect(vestments).toBeTruthy();

    // Buying it remembers it, and the next visit does not stock it again.
    expect(buy(first, hero, vestments.id).ok).toBe(true);
    expect(sold).toEqual(['archons_vestments']);
    const after = openShop({ town: townAt(5, 2), masterSeed: 3, sold });
    expect(after.stock.some((row) => row.baseId === 'archons_vestments')).toBe(false);
  });
});

describe('prices (04 section 1)', () => {
  it('asks the listed price, and takes 5% off per point of Luck', () => {
    const plain = makeHero({ ...SCORES, luck: 10 });
    const lucky = makeHero({ ...SCORES, luck: 16 });
    const entry = { baseId: 'long_sword', bonus: 0, property: null };
    expect(buyDiscount(plain)).toBe(1);
    expect(priceOf(plain, entry)).toBe(costOf('long_sword'));
    expect(buyDiscount(lucky)).toBeCloseTo(0.9);
    expect(priceOf(lucky, entry)).toBe(Math.round(costOf('long_sword') * 0.9));
  });

  it('prices the magic on a rotating line', () => {
    const hero = makeHero();
    expect(priceOf(hero, { baseId: 'long_sword', bonus: 1 })).toBe(costOf('long_sword', { bonus: 1 }));
    expect(priceOf(hero, { baseId: 'shield', bonus: 2, property: 'warded' })).toBe(
      costOf('shield', { bonus: 2, property: 'warded' }),
    );
    // A Rare charm is sold at one and a half times the price.
    expect(priceOf(hero, { baseId: 'bloodstone', priceMultiplier: 1.5 })).toBe(1200);
  });

  it('pays half, all of a valuable, and an unknown item as a plain one', () => {
    const hero = makeHero();
    expect(offerFor(hero, { baseId: 'long_sword' })).toBe(7);
    expect(offerFor(hero, { baseId: 'ruby' })).toBe(500);
    const unknown = { baseId: 'long_sword', bonus: 2, identified: false };
    expect(offerFor(hero, unknown)).toBe(7);
    const known = { baseId: 'long_sword', bonus: 2, identified: true, revealed: ['bonus'] };
    expect(offerFor(hero, known)).toBe(307);
  });

  it('lets the Merchant\'s Seal help both ways (04 section 7)', () => {
    const hero = makeHero();
    equipNew(hero.pack, 'merchants_seal');
    rebuildSheet(hero);
    expect(sellBonus(hero)).toBeCloseTo(0.1);
    expect(buyDiscount(hero)).toBeCloseTo(0.9);
    expect(offerFor(hero, { baseId: 'ruby' })).toBe(550);
  });
});

describe('doing business', () => {
  it('buys, takes the gold and hands over an identified item', () => {
    const hero = makeHero();
    const open = openShop({ town: townAt(1), masterSeed: 7 });
    const entry = open.stock.find((row) => row.baseId === 'healing_potion');
    const gold = hero.gold;
    const done = buy(open, hero, entry.id);
    expect(done).toMatchObject({ ok: true, paid: 25 });
    expect(hero.gold).toBe(gold - 25);
    const held = hero.pack.items.find((row) => row.baseId === 'healing_potion');
    expect(isIdentified(hero.identification, held)).toBe(true);
  });

  it('takes a rotating line off the shelf once it is bought', () => {
    const hero = makeHero();
    hero.gold = 5000;
    const open = openShop({ town: townAt(3), masterSeed: 7 });
    const entry = open.stock.find((row) => row.rotating);
    expect(buy(open, hero, entry.id).ok).toBe(true);
    expect(open.stock.some((row) => row.id === entry.id)).toBe(false);
    // The fixed stock is not a single item: a shop always has torches.
    const torch = open.stock.find((row) => row.baseId === 'torch');
    expect(buy(open, hero, torch.id).ok).toBe(true);
    expect(open.stock.some((row) => row.id === torch.id)).toBe(true);
  });

  it('says why it cannot sell to a hero who cannot pay or cannot carry', () => {
    const broke = makeHero();
    broke.gold = 0;
    const open = openShop({ town: townAt(1), masterSeed: 7 });
    const entry = open.stock.find((row) => row.baseId === 'plate') ??
      open.stock.find((row) => row.baseId === 'chain_mail');
    expect(whyNotBuy(broke, entry)).toBe('notEnoughGold');
    expect(buy(open, broke, entry.id)).toMatchObject({ ok: false, why: 'notEnoughGold' });

    const full = makeHero();
    full.pack.capacity = 0;
    expect(whyNotBuy(full, entry)).toBe('packFull');
  });

  it('buys from the hero, and refuses what is worn or bound', () => {
    const hero = makeHero();
    const potion = addItem(hero.pack, 'healing_potion', { count: 2 }).entry;
    const gold = hero.gold;
    expect(sell(hero, potion.instanceId)).toMatchObject({ ok: true, paid: 12 });
    expect(hero.gold).toBe(gold + 12);
    expect(potion.count).toBe(1);

    const worn = hero.pack.items.find((row) => row.baseId === 'long_sword');
    expect(whyNotSell(hero, worn)).toBe('worn');
    const cursed = addItem(hero.pack, 'mace', { curse: 'leaden', bound: true }).entry;
    expect(whyNotSell(hero, cursed)).toBe('cursedInPlace');
    expect(sellable(hero).map((row) => row.baseId)).not.toContain('mace');
  });

  it('mends what a slime corroded, for the flat fee (04 section 1)', () => {
    const hero = makeHero();
    const sword = addItem(hero.pack, 'short_sword').entry;
    expect(repairable(hero)).toEqual([]);
    sword.corroded = true;
    expect(repairable(hero)).toEqual([sword]);
    expect(repairCost()).toBe(10);
    const gold = hero.gold;
    expect(repair(hero, sword.instanceId)).toMatchObject({ ok: true, paid: 10 });
    expect(hero.gold).toBe(gold - 10);
    expect(sword.corroded).toBeUndefined();
    expect(repair(hero, sword.instanceId)).toMatchObject({ ok: false, why: 'notCorroded' });
  });
});

describe('where the Shop puts things', () => {
  it("follows the outline's Shop table", () => {
    // Top bar 1-2, tabs 3-4, list 5-13, detail 14-16, price and BUY 17-18.
    expect(REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(REGIONS.tabs.tall).toEqual([1, 9, 3, 4]);
    expect(REGIONS.list.tall).toEqual([1, 9, 5, 13]);
    expect(REGIONS.detail.tall).toEqual([1, 9, 14, 16]);
    expect(REGIONS.price.tall).toEqual([1, 4, 17, 18]);
    expect(REGIONS.deal.tall).toEqual([5, 9, 17, 18]);
  });

  it('puts tabs and list left, detail and the button right when wide', () => {
    expect(shopScreen.pattern).toBe('list-detail');
    for (const name of ['tabs', 'list']) expect([name, REGIONS[name].wide[1]]).toEqual([name, 9]);
    for (const name of ['detail', 'price', 'deal']) {
      expect([name, REGIONS[name].wide[0]]).toBeTruthy();
      expect(REGIONS[name].wide[0]).toBeGreaterThanOrEqual(10);
    }
  });

  it('places cleanly in both frames and lets only the list scroll', () => {
    expect(validateScreen(shopScreen, 'tall')).toEqual([]);
    expect(validateScreen(shopScreen, 'wide')).toEqual([]);
    const { built } = mount();
    const scrolls = Object.values(built).filter((node) => node.querySelector?.('.scroll'));
    expect(scrolls).toEqual([built.list]);
  });
});

describe('what the Shop shows', () => {
  it('names the shop, what it pays, and the gold on hand', () => {
    const hero = makeHero();
    hero.gold = 312;
    const { built } = mount({ hero });
    expect(built.topBar.textContent).toContain(t('shop.title'));
    expect(built.topBar.textContent).toContain(t('shop.sub', { n: 50 }));
    expect(built.topBar.textContent).toContain(t('shop.gold', { n: 312 }));
  });

  it('gives every row a one-line summary and a price', () => {
    const { built } = mount();
    expect(built.list.textContent).toContain('Healing Potion');
    expect(built.list.textContent).toContain(summaryOf({ baseId: 'healing_potion' }));
    expect(built.list.textContent).toContain(t('shop.price', { n: 25 }));
  });

  it('labels the rotating stock, and names it with its magic', () => {
    const open = openShop({ town: townAt(3), masterSeed: 7 });
    const { built } = mount({ open });
    expect(built.list.textContent).toContain(t('items.line.rotating', { line: '' }).trim().split('{')[0].trim());
    const rotating = open.stock.find((row) => row.rotating && row.bonus === 1);
    expect(nameOfStock(rotating)).toContain('+1');
    expect(built.list.textContent).toContain(nameOfStock(rotating));
  });

  it('compares a weapon with the one the hero is holding', () => {
    const hero = makeHero();
    const { chips, against } = compareChips(hero, { baseId: 'great_sword', bonus: 0 });
    expect(against.baseId).toBe('long_sword');
    // 1d12 averages 6.5 against the long sword's 4.5.
    expect(average('1d12')).toBe(6.5);
    expect(chips.some((chip) => chip.label.startsWith('DMG') && chip.better)).toBe(true);
    // Nothing to compare a potion with.
    expect(compareChips(hero, { baseId: 'healing_potion' }).chips).toEqual([]);
  });

  it('switches tabs, and says when a tab has nothing in it', () => {
    const hero = makeHero();
    const { built } = mount({ hero });
    expect(built.list.textContent).not.toContain(t('shop.empty.repair'));
    const repairTab = buttons(built).get(t('shop.tabs.repair'));
    repairTab.click();
    expect(built.list.textContent).toContain(t('shop.empty.repair'));
    expect(TABS).toEqual(['buy', 'sell', 'repair']);
  });

  it('buys what is picked, and the gold in the bar goes with it', () => {
    const hero = makeHero();
    hero.gold = 100;
    const { built } = mount({ hero });
    const row = [...built.list.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Healing Potion'),
    );
    row.click();
    expect(built.price.textContent).toContain(t('shop.price', { n: 25 }));
    // BUY the tab and BUY the button read alike, so this is the one in the
    // key slot rather than whichever came first.
    built.deal.querySelector('button').click();
    expect(hero.gold).toBe(75);
    expect(hero.pack.items.some((entry) => entry.baseId === 'healing_potion')).toBe(true);
  });

  it('has one primary button, and it says why it is off', () => {
    const hero = makeHero();
    hero.gold = 0;
    const { built } = mount({ hero });
    const primary = Object.values(built).flatMap((node) => [
      ...(node.querySelectorAll?.('.btn--primary') ?? []),
    ]);
    expect(primary).toHaveLength(1);
    expect(primary[0].disabled).toBe(true);
    expect(built.deal.textContent).toContain(t('shop.pick'));
  });
});
