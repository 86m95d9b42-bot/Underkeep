/**
 * Graves (`05` section 9, `01` section 12).
 *
 * An Adventurer who falls wakes in town without half their gold and without
 * what they could not name, and it waits where they died. The rules are
 * short, so these check all of them: what goes in, what comes back, what
 * happens to the old one, and that the map shows it.
 */
import { describe, it, expect } from 'vitest';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem } from '../src/systems/inventory.js';
import { createIdentification } from '../src/systems/identification.js';
import { createTown } from '../src/systems/town.js';
import { createSession } from '../src/systems/session.js';
import { createRun } from '../src/systems/run.js';
import { clearGrave, dig, goldLost, graveOn, heroFell, open, unknownItems } from '../src/systems/graves.js';
import { isWalkable } from '../src/dungeon/floor-builder.js';
import { mapMarks } from '../src/dungeon/automap.js';
import { t } from '../src/data/strings.js';

/** A hero with a purse and two things they cannot name. */
function makeHero({ gold = 141, seed = 5 } = {}) {
  const hero = finish(setName(chooseOrigin(createDraft({ seed }), 'sellsword'), 'Vex'));
  hero.identification = createIdentification(seed);
  hero.gold = gold;
  addItem(hero.pack, 'long_sword', { count: 1, bonus: 1, identified: false });
  addItem(hero.pack, 'scroll_of_knock', { count: 1, identified: false });
  addItem(hero.pack, 'ration', { count: 2, identified: true });
  return hero;
}

describe('what a fall costs (01 section 12)', () => {
  it('takes half the carried gold, rounded down', () => {
    expect(goldLost({ gold: 141 })).toBe(70);
    expect(goldLost({ gold: 1 })).toBe(0);
    expect(goldLost({})).toBe(0);
  });

  it('takes everything the hero could not name, and nothing they could', () => {
    const hero = makeHero();
    const unknown = unknownItems(hero).map((entry) => entry.baseId);
    expect(unknown).toEqual(expect.arrayContaining(['long_sword', 'scroll_of_knock']));
    expect(unknown).not.toContain('ration');

    const grave = dig(hero, { floor: 4, at: [8, 22] });
    expect(grave).toMatchObject({ floor: 4, pos: [8, 22], gold: 70 });
    expect(grave.items.map((item) => item.baseId).sort()).toEqual(['long_sword', 'scroll_of_knock']);
    // The gear itself keeps what it was carrying: a +1 sword is still +1.
    expect(grave.items.find((item) => item.baseId === 'long_sword').bonus).toBe(1);

    expect(hero.gold).toBe(71);
    expect(hero.pack.items.some((entry) => entry.baseId === 'scroll_of_knock')).toBe(false);
    expect(hero.pack.items.some((entry) => entry.baseId === 'ration')).toBe(true);
  });

  it('keeps the XP and the gear that was worn', () => {
    const hero = makeHero();
    const level = hero.level;
    const worn = hero.weapon?.baseId;
    dig(hero, { floor: 2, at: [1, 1] });
    expect(hero.level).toBe(level);
    expect(hero.weapon?.baseId).toBe(worn);
  });
});

describe('the one grave there is (05 section 9)', () => {
  it('belongs to the town, and knows which floor it is on', () => {
    const hero = makeHero();
    const town = createTown({});
    expect(town.grave).toBe(null);

    const grave = heroFell(town, hero, { floor: 4, at: [8, 22] });
    expect(town.grave).toBe(grave);
    expect(graveOn(town, 4)).toBe(grave);
    expect(graveOn(town, 3)).toBe(null);
  });

  it('loses the old one when the hero dies again', () => {
    const hero = makeHero({ gold: 400 });
    const town = createTown({});
    const first = heroFell(town, hero, { floor: 2, at: [3, 3] });
    expect(first.gold).toBe(200);

    const second = heroFell(town, hero, { floor: 5, at: [9, 9] });
    expect(town.grave).toBe(second);
    expect(second.floor).toBe(5);
    // The first one is simply gone, with everything in it.
    expect(graveOn(town, 2)).toBe(null);
  });

  it('makes none at all for an Ironman', () => {
    const hero = makeHero();
    const town = createTown({});
    expect(heroFell(town, hero, { floor: 3, at: [1, 1], mode: 'ironman' })).toBe(null);
    expect(town.grave).toBe(null);
    // And nothing was taken: an Ironman has nothing to come back for.
    expect(hero.gold).toBe(141);
  });

  it('gives everything back, and what will not fit stays', () => {
    const hero = makeHero();
    const town = createTown({});
    const grave = heroFell(town, hero, { floor: 4, at: [8, 22] });

    const back = open(hero, grave);
    expect(back.gold).toBe(70);
    expect(hero.gold).toBe(141);
    expect(back.taken).toHaveLength(2);
    expect(back.left).toHaveLength(0);
    expect(grave.emptied).toBe(true);
    expect(hero.pack.items.some((entry) => entry.bonus === 1)).toBe(true);

    clearGrave(town);
    expect(town.grave).toBe(null);
  });
});

describe('through the run', () => {
  /** A session with a hero who has just fallen on this floor. */
  function fallen(floor = 3, { seed = 77 } = {}) {
    const hero = makeHero({ gold: 200 });
    const game = createSession({ hero, seed });
    game.descend({ floor });
    const at = [...game.run.ex.pos];
    const fell = game.heroFell();
    return { game, hero, fell, at };
  }

  it('wakes the hero in town with a grave behind them', () => {
    const { game, hero, fell } = fallen();
    expect(fell.mode).toBe('adventurer');
    expect(game.inDungeon).toBe(false);
    expect(hero.alive).toBe(true);
    expect(hero.hp).toBeGreaterThan(0);
    // The day turns over, the way coming home does (`05` section 8).
    expect(game.town.day).toBe(2);
    expect(game.town.grave.floor).toBe(3);
  });

  it('puts it on the floor when the hero goes back down', () => {
    const { game, fell } = fallen();
    const run = game.descend({ floor: 3 });
    expect(run.floor.grave).toMatchObject({ pos: fell.grave.pos, gold: fell.grave.gold });
    // And not on any other floor.
    expect(game.descend({ floor: 4 }).floor.grave).toBe(null);
  });

  it('is marked on the map', () => {
    const { game } = fallen();
    const run = game.descend({ floor: 3 });
    const marks = mapMarks(run.floor, run.ex);
    expect(marks.some((mark) => mark.kind === 'grave')).toBe(true);
    expect(t('map.legendNames.grave')).toBe('GRAVE');
  });

  it('gives everything back when the hero walks onto it', () => {
    const { game, hero } = fallen();
    const run = game.descend({ floor: 3 });
    const [gx, gy] = run.floor.grave.pos;
    const beside = [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]].find(([ox, oy]) =>
      isWalkable(run.floor.map[gy + oy]?.[gx + ox]),
    );
    run.ex.pos = [gx + beside[0], gy + beside[1]];
    run.ex.facing = beside[2];

    const purse = hero.gold;
    const { events } = run.press('forward');
    const found = events.find((event) => event.type === 'grave');
    expect(found).toBeTruthy();
    expect(hero.gold).toBe(purse + found.gold);
    expect(hero.pack.items.some((entry) => entry.bonus === 1)).toBe(true);

    // And it is gone, from the floor and from the town.
    expect(run.floor.grave).toBe(null);
    expect(game.town.grave).toBe(null);
    expect(run.log.at(-1).text).toBe(t('explore.log.grave', { n: found.gold }));
  });

  it('lasts through a restock', () => {
    const { game, fell } = fallen();
    // Another day, another trip: the floor is restocked and the grave is not.
    game.town.day += 3;
    const run = game.descend({ floor: 3 });
    expect(run.floor.grave).toMatchObject({ pos: fell.grave.pos });
  });
});
