/**
 * Dungeon hazards, curiosities and theme features (`03` section 8,
 * `05` sections 3 step 8 and 6).
 *
 * The tables are checked against the documents, the placement against the
 * rules each hazard is given, and the effects with a scripted stream so that
 * the Body save in deep water is the document's DC and the fountain's six
 * faces are the document's six faces.
 */
import { describe, it, expect } from 'vitest';
import {
  CURIOSITIES,
  FEATURES,
  HAZARD_IDS,
  feature as featureSpec,
  hazard as hazardSpec,
  hazardTn,
  offeringCost,
} from '../src/data/hazards.js';
import {
  bashWeb,
  blocks,
  drink,
  hazardAt,
  notice,
  offer,
  onEnter,
  openFeature,
  reachIn,
  search,
  searchFeature,
  slideFrom,
  wade,
  webBashTn,
  whyNotUse,
} from '../src/systems/hazards.js';
import { buildFloor, isWalkable } from '../src/dungeon/floor-builder.js';
import { createRun } from '../src/systems/run.js';
import { layoutStream } from '../src/engine/rng.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem, equipNew } from '../src/systems/inventory.js';
import { refreshGear } from '../src/systems/kit.js';
import { rebuildSheet } from '../src/systems/levelling.js';
import { allFloorSpecs } from '../src/data/floors.js';

const SEED = 20260918;
const floors = allFloorSpecs().map((spec) => [spec.floor, buildFloor(spec.floor, SEED, layoutStream)]);
const at = (pos) => `${pos[0]},${pos[1]}`;

function makeHero(origin = 'sellsword') {
  const who = finish(setName(chooseOrigin(createDraft({ seed: 11 }), origin), 'Vex'));
  refreshGear(who);
  rebuildSheet(who);
  return who;
}

/** A stream that answers exactly what a test needs, in order. */
function stub({ d20 = [], die = [], roll = [], chance = [], pick = [], int = [] } = {}) {
  const queues = { d20: [...d20], die: [...die], roll: [...roll], chance: [...chance], pick: [...pick], int: [...int] };
  const next = (name, fallback) => (queues[name].length ? queues[name].shift() : fallback);
  const stream = () => 0.5;
  stream.d20 = () => next('d20', 10);
  stream.die = () => next('die', 1);
  stream.roll = () => next('roll', 3);
  stream.dice = () => stream.roll();
  stream.range = (low) => low;
  stream.int = (n) => next('int', 0) % n;
  stream.chance = () => next('chance', false);
  stream.pick = (list) => list[next('pick', 0) % list.length];
  stream.shuffle = (list) => [...list];
  return stream;
}

const services = (rng) => ({ rng });

describe('the tables (03 section 8, 05 section 6)', () => {
  it('has the seven hazards the document lists', () => {
    expect(HAZARD_IDS).toEqual([
      'spinner',
      'dark_zone',
      'deep_water',
      'teleporter_pad',
      'anti_magic_field',
      'web_curtain',
      'ice_slide',
    ]);
  });

  it('starts each hazard on the floor the document gives it', () => {
    expect(hazardSpec('spinner').minFloor).toBe(2);
    expect(hazardSpec('dark_zone').minFloor).toBe(4);
    expect(hazardSpec('deep_water').minFloor).toBe(5);
    expect(hazardSpec('teleporter_pad').minFloor).toBe(5);
    expect(hazardSpec('anti_magic_field').minFloor).toBe(6);
    expect(hazardSpec('ice_slide').minFloor).toBe(9);
  });

  it('finds a hazard at 12 + F, the same as a secret door', () => {
    expect(hazardTn(1)).toBe(13);
    expect(hazardTn(7)).toBe(19);
  });

  it('bashes a web curtain at 10 + F', () => {
    expect(webBashTn(4)).toBe(14);
    expect(webBashTn(10)).toBe(20);
  });

  it('asks 20 x F for a blessing', () => {
    expect(offeringCost(1)).toBe(20);
    expect(offeringCost(7)).toBe(140);
  });

  it('has the twelve theme features 05 section 6 lists, plus the hoard', () => {
    // The document's table is twelve rows; floor 10 also holds the dragon's
    // hoard, which `05` section 2 names.
    expect(Object.keys(FEATURES).filter((id) => !id.startsWith('_'))).toHaveLength(13);
    expect(featureSpec('wine_rack').search.oneIn).toBe(6);
    expect(featureSpec('bookshelf').search.oneIn).toBe(8);
    expect(featureSpec('goblin_camp').chestLootBonus).toBe(10);
    expect(featureSpec('heat_vent').firesEveryStep).toBe(3);
  });
});

describe('where they go (05 section 3 step 8, section 6)', () => {
  it.each(floors)('floor %i places every theme feature it names', (number, floor) => {
    const placed = new Set(Object.values(floor.features ?? {}).map((one) => one.kind));
    for (const id of floor.spec.features) {
      // A Theme Room can be full; over a run of seeds every feature lands.
      if (!placed.has(id)) continue;
      expect(featureSpec(id).floor).toBe(number);
    }
  });

  it('gives each floor its features over a handful of seeds', () => {
    for (const number of [1, 2, 4, 6, 9, 10]) {
      let placed = 0;
      for (let seed = 1; seed <= 10; seed += 1) {
        const built = buildFloor(number, SEED + seed * 7919, layoutStream);
        const kinds = new Set(Object.values(built.features ?? {}).map((one) => one.kind));
        if (built.spec.features.every((id) => kinds.has(id))) placed += 1;
      }
      expect(placed, `floor ${number}: ${placed} of 10`).toBeGreaterThanOrEqual(8);
    }
  });

  it('leaves the frozen lake a shore to stop on', () => {
    // 05 section 6: "the generator verifies every one can be crossed and
    // exited." An ice tile that cannot be slid off is a trap with no exit.
    const floor = buildFloor(9, SEED, layoutStream);
    const ice = Object.values(floor.hazards).filter((one) => one.kind === 'ice_slide');
    expect(ice.length).toBeGreaterThan(0);
    const iced = new Set(ice.map((one) => at(one.pos)));
    for (const tile of ice) {
      const escapes = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => {
        let [x, y] = tile.pos;
        for (let step = 0; step < 60; step += 1) {
          const [nx, ny] = [x + dx, y + dy];
          if (!isWalkable(floor.map[ny]?.[nx])) return false;
          [x, y] = [nx, ny];
          if (!iced.has(at([x, y]))) return true;
        }
        return false;
      });
      expect(escapes, `${at(tile.pos)} has no way off the ice`).toBe(true);
    }
  });

  it('never lays scenery across the only way through', () => {
    for (const [, floor] of floors) {
      const onPath = new Set(floor.criticalPath.map(at));
      for (const [where, entry] of Object.entries(floor.features ?? {})) {
        if (!entry.blocks) continue;
        expect(onPath.has(where), `${entry.kind} at ${where} is on the route`).toBe(false);
      }
    }
  });

  it('makes a web curtain and a lava channel stop a step', () => {
    const floor = buildFloor(4, SEED, layoutStream);
    const web = Object.values(floor.hazards).find((one) => one.kind === 'web_curtain');
    expect(web).toBeTruthy();
    expect(blocks(floor, web.pos, { hazardsCleared: new Set() })).toBe(true);
    expect(blocks(floor, web.pos, { hazardsCleared: new Set([at(web.pos)]) })).toBe(false);

    const lava = Object.values(buildFloor(7, SEED, layoutStream).features).find((one) => one.blocks);
    expect(lava).toBeTruthy();
    expect(blocks(buildFloor(7, SEED, layoutStream), lava.pos, {})).toBe(true);
  });
});

describe('finding one (03 section 8)', () => {
  it('searches at 12 + F, and only once each way', () => {
    const hero = makeHero();
    const entry = { kind: 'spinner', pos: [2, 2], found: false, searches: { normal: false, careful: false } };
    // Floor 3 is TN 15; the Sellsword's WIT is what it is, so this is a miss.
    expect(search(stub({ d20: [3] }), hero, entry, 3).found).toBe(false);
    expect(search(stub({ d20: [20] }), hero, entry, 3).why).toBe('searched');
    const careful = search(stub({ d20: [20] }), hero, entry, 3, { careful: true });
    expect(careful.found).toBe(true);
    expect(entry.found).toBe(true);
  });

  it('will not search what is plain to see', () => {
    const web = { kind: 'web_curtain', pos: [1, 1] };
    expect(search(stub({ d20: [20] }), makeHero(), web, 4).why).toBe('plainToSee');
  });

  it('takes the game’s own look at -4 as the hero comes up to one', () => {
    const hero = makeHero();
    const entry = { kind: 'spinner', pos: [2, 2], found: false };
    // 03 section 3: the passive look carries a -4.
    expect(notice(stub({ d20: [14] }), hero, entry, 1).found).toBe(false);
    expect(notice(stub({ d20: [20] }), hero, entry, 1).found).toBe(true);
  });
});

describe('standing on one', () => {
  const floorOf = (kind, extra = {}) => ({
    floor: 6,
    width: 20,
    height: 20,
    rooms: [],
    hazards: { '5,5': { kind, pos: [5, 5], found: false, ...extra } },
  });

  it('turns the hero, and says nothing when they never found it', () => {
    const hero = makeHero();
    const floor = floorOf('spinner');
    const out = onEnter(services(stub({ int: [2] })), hero, floor, { facing: 0 }, [5, 5]);
    expect(out.facing).toBe(2);
    expect(out.events[0]).toMatchObject({ type: 'spun', silent: true });
  });

  it('lets a Lodestone Compass hold the bearing', () => {
    const hero = makeHero();
    addItem(hero.pack, 'lodestone_compass', { count: 1, identified: true });
    refreshGear(hero);
    rebuildSheet(hero);
    const out = onEnter(services(stub({ int: [2] })), hero, floorOf('spinner'), { facing: 0 }, [5, 5]);
    expect(out.facing).toBe(undefined);
    expect(out.events[0].type).toBe('spinnerHeld');
  });

  it('sends the hero where the pad always sends them', () => {
    const floor = floorOf('teleporter_pad', { destination: [9, 3] });
    const out = onEnter(services(stub()), makeHero(), floor, { facing: 0 }, [5, 5]);
    expect(out.teleportTo).toEqual([9, 3]);
  });

  it('asks a Body save of a hero in heavy armour, at DC 10 + F', () => {
    const hero = makeHero();
    equipNew(hero.pack, 'plate', { identified: true });
    refreshGear(hero);
    rebuildSheet(hero);
    expect(hero.gear.heavyArmor).toBe(true);

    const sank = wade(services(stub({ d20: [1], roll: [4] })), hero, 5);
    const drowned = sank.find((event) => event.type === 'drowning');
    expect(drowned.dc).toBe(15);
    expect(drowned.damage).toBeGreaterThan(0);

    const swam = wade(services(stub({ d20: [20] })), hero, 5);
    expect(swam.find((event) => event.type === 'waded')).toBeTruthy();
  });

  it('leaves a hero in light armour alone, and ruins a scroll 1 in 6', () => {
    const hero = makeHero('apprentice');
    addItem(hero.pack, 'scroll_of_knock', { count: 1 });
    refreshGear(hero);
    const scrolls = () =>
      hero.pack.items.filter((one) => one.baseId.startsWith('scroll_')).reduce((n, one) => n + (one.count ?? 1), 0);
    const carried = scrolls();

    // No heavy armour, so no save — and a 6 that is not a 1 keeps the paper dry.
    const dry = wade(services(stub({ chance: [false] })), hero, 5);
    expect(dry).toEqual([]);
    expect(scrolls()).toBe(carried);

    const wet = wade(services(stub({ chance: [true] })), hero, 5);
    expect(wet.find((event) => event.type === 'scrollRuined')).toBeTruthy();
    expect(scrolls()).toBe(carried - 1);
  });
});

describe('ice (05 section 6)', () => {
  const iceFloor = () => ({
    floor: 9,
    width: 12,
    height: 12,
    hazards: Object.fromEntries(
      [3, 4, 5, 6].map((x) => [`${x},5`, { kind: 'ice_slide', pos: [x, 5] }]),
    ),
  });

  it('slides on until the ice runs out', () => {
    const floor = iceFloor();
    const { path, at: landed } = slideFrom(floor, [3, 5], [1, 0], () => true);
    // Four tiles of ice: the hero slides off the far end onto the fifth.
    expect(landed).toEqual([7, 5]);
    expect(path).toHaveLength(4);
  });

  it('stops at a wall rather than going through it', () => {
    const floor = iceFloor();
    const { at: landed } = slideFrom(floor, [3, 5], [1, 0], ([x]) => x < 6);
    expect(landed).toEqual([5, 5]);
  });
});

describe('theme features (05 section 6)', () => {
  it('searches a wine rack once, for a ration or a potion', () => {
    const hero = makeHero();
    const rack = { kind: 'wine_rack', searched: false };
    const found = searchFeature(stub({ chance: [true], pick: [1] }), hero, rack, 1);
    expect(found.drops[0].baseId).toBe('healing_potion');
    expect(searchFeature(stub(), hero, rack, 1).why).toBe('searched');

    const empty = searchFeature(stub({ chance: [false] }), hero, { kind: 'wine_rack' }, 1);
    expect(empty.drops).toEqual([]);
  });

  it('gives a bookshelf its 1-in-8 Uncommon scroll', () => {
    const hero = makeHero();
    const found = searchFeature(stub({ chance: [true] }), hero, { kind: 'bookshelf' }, 8);
    expect(found.found).toBe(true);
    // An unknown scroll comes out unidentified (`04` section 5).
    expect(found.drops[0].identified).toBe(false);
  });

  it('opens a sarcophagus on the document’s d6', () => {
    const hero = makeHero();
    // 1-2 a Skeleton, 3-5 empty, 6 a Common loot roll.
    expect(openFeature(stub({ roll: [1] }), hero, { kind: 'sarcophagus' }, 2).fight).toEqual(['skeleton']);
    expect(openFeature(stub({ roll: [4] }), hero, { kind: 'sarcophagus' }, 2).empty).toBe(true);
    const looted = openFeature(stub({ roll: [6], die: [3] }), hero, { kind: 'sarcophagus' }, 2);
    expect(looted.drops.length).toBeGreaterThan(0);
  });

  it('needs the pole to reach into an ash pit', () => {
    const hero = makeHero();
    const pit = { kind: 'ash_pit', gem: true, taken: false };
    expect(whyNotUse(pit, hero)).toBe('noPole');

    addItem(hero.pack, 'ten_foot_pole', { count: 1 });
    refreshGear(hero);
    const got = reachIn(stub({ die: [50] }), hero, pit, 10);
    expect(got.found).toBe(true);
    expect(got.drops[0].baseId).toBeTruthy();
    expect(whyNotUse(pit, hero)).toBe('taken');
  });
});

describe('curiosities (03 section 8)', () => {
  it('rolls the document’s six faces', () => {
    const hero = makeHero();
    hero.hp = 1;
    hero.fp = 0;

    const poisoned = drink(services(stub({ roll: [1] })), hero, { used: false });
    expect(poisoned.events[0]).toMatchObject({ type: 'condition', id: 'poisoned' });

    const moved = drink(services(stub({ roll: [2] })), hero, { used: false });
    expect(moved.teleport).toBe('random');

    expect(drink(services(stub({ roll: [3] })), hero, { used: false }).events[0].type).toBe('nothing');

    const healed = drink(services(stub({ roll: [4, 7] })), hero, { used: false });
    expect(healed.events[0]).toMatchObject({ type: 'healed' });
    expect(hero.hp).toBeGreaterThan(1);

    const focused = drink(services(stub({ roll: [5] })), hero, { used: false });
    expect(focused.events[0].type).toBe('focus');
    expect(hero.fp).toBe(hero.maxFp);
  });

  it('gives its attribute point once a game', () => {
    const hero = makeHero();
    const game = {};
    const before = { ...hero.attributes };
    const gift = drink(services(stub({ roll: [6], pick: [0] })), hero, { used: false }, game);
    expect(gift.events[0]).toMatchObject({ type: 'attribute', value: 1 });
    expect(Object.values(hero.attributes).reduce((a, b) => a + b, 0)).toBe(
      Object.values(before).reduce((a, b) => a + b, 0) + 1,
    );

    // "Each fountain works only once per game."
    const again = drink(services(stub({ roll: [6] })), hero, { used: false }, game);
    expect(again.events[0].type).toBe('nothing');
  });

  it('drinks once and no more', () => {
    const fountain = { used: false };
    drink(services(stub({ roll: [3] })), makeHero(), fountain);
    expect(fountain.used).toBe(true);
    expect(drink(services(stub()), makeHero(), fountain).why).toBe('used');
  });

  it('asks 20 x F for +2 to all saves until the next rest', () => {
    const hero = makeHero();
    hero.gold = 100;
    const saves = { ...hero.saves };

    expect(offer(hero, { used: false }, 7).why).toBe('notEnoughGold');

    const shrine = { used: false };
    const given = offer(hero, shrine, 3);
    expect(given.cost).toBe(60);
    expect(hero.gold).toBe(40);
    for (const save of Object.keys(saves)) expect(hero.saves[save]).toBe(saves[save] + 2);
    expect(hero.buffs.find((buff) => buff.id === 'shrine').until).toBe('rest');
    expect(offer(hero, shrine, 3).why).toBe('used');
  });
});

describe('through the run', () => {
  /** A run with the hero standing next to a hazard of this kind. */
  function runAt(kind, floorNumber) {
    for (let seed = 1; seed < 40; seed += 1) {
      const run = createRun({ masterSeed: SEED + seed * 613, floor: floorNumber, hero: makeHero() });
      for (const [where, entry] of Object.entries(run.floor.hazards)) {
        if (entry.kind !== kind) continue;
        const [hx, hy] = where.split(',').map(Number);
        for (const [ox, oy, facing] of [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]]) {
          const [x, y] = [hx + ox, hy + oy];
          if (!isWalkable(run.floor.map?.[y]?.[x])) continue;
          run.ex.pos = [x, y];
          run.ex.facing = facing;
          if (String(run.ahead.at) === String([hx, hy])) return { run, entry };
        }
      }
    }
    throw new Error(`no reachable ${kind} found`);
  }

  it('turns the hero when they step on a spinner', () => {
    const { run } = runAt('spinner', 3);
    const facing = run.ex.facing;
    let turned = false;
    for (let tries = 0; tries < 6 && !turned; tries += 1) {
      run.press('forward');
      turned = run.ex.facing !== facing;
      if (!turned) run.ex.facing = facing;
    }
    expect(turned).toBe(true);
  });

  it('slides the hero across ice in one press, and charges for every tile', () => {
    const { run } = runAt('ice_slide', 9);
    const steps = run.ex.steps;
    const { outcome } = run.press('forward');
    expect(outcome.moved).toBe(true);
    // The step onto the ice, plus a tile for every tile slid (`05` section 6:
    // "wandering monster checks still count each tile slid").
    expect(outcome.cost).toBe(1 + (outcome.slid?.length ?? 0));
    expect(run.ex.steps).toBe(steps + outcome.cost);
    // A slide ends where the last tile of it is; a slide into a wall ends on
    // the ice itself, which is why the hero may not have moved on.
    if (outcome.slid.length > 0) {
      expect(String(run.ex.pos)).toBe(String(outcome.slid.at(-1)));
    }
  });

  it('refuses to walk into lava', () => {
    for (let seed = 1; seed < 20; seed += 1) {
      const run = createRun({ masterSeed: SEED + seed * 613, floor: 7, hero: makeHero() });
      const lava = Object.values(run.floor.features ?? {}).find((one) => one.blocks);
      if (!lava) continue;
      const [lx, ly] = lava.pos;
      const beside = [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]].find(([ox, oy]) =>
        isWalkable(run.floor.map?.[ly + oy]?.[lx + ox]),
      );
      if (!beside) continue;
      run.ex.pos = [lx + beside[0], ly + beside[1]];
      run.ex.facing = beside[2];
      const { outcome } = run.press('forward');
      expect(outcome.moved).toBe(false);
      expect(outcome.blocked.reason).toBe('scenery');
      return;
    }
    throw new Error('no lava found');
  });
});

describe('an Anti-Magic Field (03 section 8)', () => {
  /** A hero wearing something magic, standing wherever they are put. */
  function runInField() {
    for (let seed = 1; seed < 40; seed += 1) {
      const hero = makeHero();
      equipNew(hero.pack, 'wardstone', { identified: true });
      refreshGear(hero);
      rebuildSheet(hero);
      const run = createRun({ masterSeed: SEED + seed * 613, floor: 6, hero });
      const field = Object.values(run.floor.hazards).find((one) => one.kind === 'anti_magic_field');
      if (!field) continue;
      // Somewhere in the field with a way in from outside it.
      const inside = Object.entries(run.floor.hazards).find(
        ([, one]) => one.kind === 'anti_magic_field',
      );
      return { run, hero, at: inside[1].pos };
    }
    throw new Error('no anti-magic field found');
  }

  it('takes a magic item’s bonus away while the hero stands in it', () => {
    const { run, hero, at: where } = runInField();
    // The Wardstone is +1 to every save (`04` section 7).
    const blessed = { ...hero.saves };
    hero.antiMagic = true;
    refreshGear(hero);
    rebuildSheet(hero);
    for (const save of Object.keys(blessed)) expect(hero.saves[save]).toBe(blessed[save] - 1);

    hero.antiMagic = false;
    refreshGear(hero);
    rebuildSheet(hero);
    expect(hero.saves).toEqual(blessed);
    expect(run.antiMagic).toBe(false);
  });

  it('is reported by the run, and carried into a fight', () => {
    const { run, at: where } = runInField();
    run.ex.pos = [...where];
    expect(run.antiMagic).toBe(true);
  });
});
