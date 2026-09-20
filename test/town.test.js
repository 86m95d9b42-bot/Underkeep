/**
 * @vitest-environment happy-dom
 *
 * The Town Hub, and the counters over it (`00-build-outline.md`, "Town";
 * `05` sections 8 and 12).
 *
 * A day is a stay in town and a trip is a descent, so the two move at
 * different moments: the gate counts a trip on the way down, and coming back
 * turns the day over. The Hub draws those, what the hero has left, and which
 * services are open.
 */
import { describe, it, expect, vi } from 'vitest';
import { town as townScreen, REGIONS, hintFor, subtitleFor } from '../src/ui/screens/town.js';
import {
  SERVICES,
  SHOP_TIERS,
  arrive,
  bossDefeated,
  createTown,
  deepestBoss,
  descend,
  innCost,
  isOpen,
  nextTrip,
  sageCost,
  servicesOf,
  shopTier,
  unlockFloorFor,
} from '../src/systems/town.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { STASH_SLOTS } from '../src/systems/inventory.js';
import { t } from '../src/data/strings.js';

function makeHero() {
  return finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 },
        },
        'sellsword',
      ),
      'Harrow',
    ),
  );
}

function mount({
  frame = 'tall',
  hero = makeHero(),
  town = createTown(),
  descend: onDescend,
  has = () => true,
} = {}) {
  const router = { has, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const run = { hero, floor: { floor: 1 } };
  const built = townScreen.build({ router, run, town, descend: onDescend, frame, settings: { all: {} } });
  return { built, router, placed: placeRegions(townScreen, frame), hero, town };
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

describe('the day and the trip (05 section 12)', () => {
  it('starts on day one, with the first trip still to take', () => {
    const town = createTown();
    expect(town).toMatchObject({ day: 1, trips: 0 });
    expect(nextTrip(town)).toBe(1);
  });

  it('counts a trip on the way down and a day on the way back', () => {
    const town = createTown();
    expect(descend(town)).toBe(1);
    expect(town).toMatchObject({ day: 1, trips: 1 });
    expect(nextTrip(town)).toBe(2);
    expect(arrive(town)).toBe(2);
    expect(town).toMatchObject({ day: 2, trips: 1 });
  });

  it('reads as the mockup writes it: "Day 7 · Return trip 8"', () => {
    const town = createTown({ day: 7, trips: 7 });
    expect(subtitleFor(town)).toBe(t('town.subReturn', { day: 7, trip: 8 }));
    // The first trip is not a return.
    expect(subtitleFor(createTown())).toBe(t('town.sub', { day: 1, trip: 1 }));
  });
});

describe('what is open (04 sections 12 and 15)', () => {
  it('opens everything but the Alchemist on the first day', () => {
    const town = createTown();
    for (const service of SERVICES) {
      if (service === 'alchemist') expect([service, isOpen(town, service)]).toEqual([service, false]);
      else expect([service, isOpen(town, service)]).toEqual([service, true]);
    }
    expect(unlockFloorFor('alchemist')).toBe(2);
    expect(unlockFloorFor('shop')).toBe(null);
  });

  it('opens the Alchemist after the floor 2 boss', () => {
    const town = createTown();
    bossDefeated(town, 2);
    expect(isOpen(town, 'alchemist')).toBe(true);
    expect(deepestBoss(town)).toBe(2);
    // And a boss is only counted once.
    bossDefeated(town, 2);
    expect(town.bosses).toEqual([2]);
  });

  it('raises the Shop a tier per boss the table names', () => {
    const town = createTown();
    expect(SHOP_TIERS).toHaveLength(5);
    expect(shopTier(town)).toBe(1);
    for (const [floor, tier] of [[2, 2], [4, 3], [6, 4], [8, 5]]) {
      bossDefeated(town, floor);
      expect([floor, shopTier(town)]).toEqual([floor, tier]);
    }
  });

  it('lists every service with what still shuts it', () => {
    const listed = servicesOf(createTown());
    expect(listed.map((row) => row.id)).toEqual([...SERVICES]);
    expect(listed.find((row) => row.id === 'alchemist')).toMatchObject({ open: false, unlockFloor: 2 });
  });

  it('prices the Inn by level and the Sage by item', () => {
    expect(innCost({ level: 7 })).toBe(35);
    expect(innCost({ level: 1 })).toBe(5);
    expect(sageCost()).toBe(20);
  });
});

describe('where the Hub puts things', () => {
  it("follows the outline's Town Hub table", () => {
    // Top bar 1-2, bars 3-4, six services 5-16 four rows each, gate 17-18.
    expect(REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(REGIONS.bars.tall).toEqual([1, 9, 3, 4]);
    expect(REGIONS.inn.tall).toEqual([1, 4, 5, 8]);
    expect(REGIONS.shop.tall).toEqual([6, 9, 5, 8]);
    expect(REGIONS.temple.tall).toEqual([1, 4, 9, 12]);
    expect(REGIONS.sage.tall).toEqual([6, 9, 9, 12]);
    expect(REGIONS.alchemist.tall).toEqual([1, 4, 13, 16]);
    expect(REGIONS.stash.tall).toEqual([6, 9, 13, 16]);
    expect(REGIONS.gate.tall).toEqual([1, 9, 17, 18]);
  });

  it('puts the bars and three services left, three and the gate right', () => {
    // 00: "Fold + nudge | Bars and three services left; three services and
    // DUNGEON GATE right".
    for (const name of ['bars', 'inn', 'shop', 'temple']) {
      expect([name, REGIONS[name].wide[1]]).toEqual([name, 9]);
    }
    for (const name of ['sage', 'alchemist', 'stash', 'gate']) {
      expect([name, REGIONS[name].wide[0]]).toEqual([name, 10]);
    }
  });

  it('places cleanly in both frames and draws the same things', () => {
    expect(validateScreen(townScreen, 'tall')).toEqual([]);
    expect(validateScreen(townScreen, 'wide')).toEqual([]);
    const text = (frame) =>
      Object.values(mount({ frame }).built)
        .map((node) => node.textContent)
        .join(' ');
    expect(text('wide')).toBe(text('tall'));
    expect(mount({ frame: 'wide' }).placed.size).toBe(Object.keys(REGIONS).length);
  });

  it('never scrolls: every service is a tap target of its own', () => {
    const { built } = mount();
    for (const node of Object.values(built)) expect(node.querySelector?.('.scroll')).toBeFalsy();
    for (const name of SERVICES) expect(REGIONS[name].tap).toBe(true);
  });
});

describe('what the Hub shows', () => {
  it('names the town, the day, the level and the gold', () => {
    const hero = makeHero();
    hero.gold = 312;
    hero.level = 7;
    const { built } = mount({ hero, town: createTown({ day: 7, trips: 7 }) });
    const text = built.topBar.textContent;
    expect(text).toContain(t('town.title'));
    expect(text).toContain(t('town.subReturn', { day: 7, trip: 8 }));
    expect(text).toContain(t('town.level', { n: 7 }));
    expect(text).toContain(t('town.gold', { n: 312 }));
  });

  it('shows what the hero has left of themselves', () => {
    const hero = makeHero();
    hero.hp = 7;
    const { built } = mount({ hero });
    expect(built.bars.textContent).toContain(`7/${hero.maxHp}`);
    expect(built.bars.textContent).toContain(`${hero.fp}/${hero.maxFp}`);
  });

  it('gives every service the hint the mockup gives it', () => {
    const hero = makeHero();
    hero.level = 7;
    const town = createTown();
    expect(hintFor('inn', { town, hero })).toBe(t('town.hints.inn', { n: 35 }));
    expect(hintFor('shop', { town, hero })).toBe(t('town.hints.shop', { n: 1 }));
    expect(hintFor('sage', { town, hero })).toBe(t('town.hints.sage', { n: 20 }));
    expect(hintFor('stash', { town, hero })).toBe(
      t('town.hints.stash', { used: 0, total: STASH_SLOTS }),
    );
    expect(hintFor('temple', { town, hero })).toBe(t('town.hints.temple'));
  });

  it('dims a locked service with the boss that opens it', () => {
    const { built } = mount();
    const alchemist = built.alchemist.querySelector('button');
    expect(alchemist.disabled).toBe(true);
    expect(built.alchemist.textContent).toContain(t('town.locked', { n: 2 }));

    // And once that boss has fallen it says what it does instead.
    const beaten = createTown();
    bossDefeated(beaten, 2);
    const open = mount({ town: beaten });
    expect(open.built.alchemist.textContent).toContain(t('town.hints.alchemist'));
  });

  it('opens the Dungeon Gate, which is where a trip is chosen', () => {
    const { built, router } = mount();
    const gate = buttons(built).get(t('town.gate'));
    expect(gate.classList.contains('btn--primary')).toBe(true);
    gate.click();
    expect(router.go).toHaveBeenCalledWith('gate');
  });

  it('goes straight down while there is no Gate screen to open', () => {
    const onDescend = vi.fn();
    const { built, router } = mount({ descend: onDescend, has: () => false });
    buttons(built).get(t('town.gate')).click();
    expect(onDescend).toHaveBeenCalledOnce();
    expect(router.go).toHaveBeenCalledWith('explore');
  });

  it('has one primary button, which is the gate', () => {
    const { built } = mount();
    const primary = Object.values(built).flatMap((node) => [
      ...(node.querySelectorAll?.('.btn--primary') ?? []),
    ]);
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toContain(t('town.gate'));
  });
});
