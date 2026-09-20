/**
 * The Scroll of Return and the Return Mark (`05` section 9, `04` section 9).
 *
 * The scroll takes the hero to town and leaves a mark where it was read; the
 * next trip down can begin there, once. What is tested here is the mark's own
 * rules and the path the scroll takes out of the dungeon.
 */
import { describe, it, expect } from 'vitest';
import {
  clearMark,
  markOf,
  markStart,
  placeMark,
  returnToTown,
  useMark,
  whyNotMark,
} from '../src/systems/travel.js';
import { createTown, nextTrip } from '../src/systems/town.js';
import { createRun } from '../src/systems/run.js';
import { createFight } from '../src/systems/fight.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem } from '../src/systems/inventory.js';
import { actionForItem } from '../src/systems/use-item.js';
import { resolveItemAction } from '../src/engine/item-actions.js';
import { makeMonster } from '../src/data/monsters.js';
import { item } from '../src/data/items.js';

const SEED = 20260918;
const SCORES = { might: 15, agility: 12, vigor: 14, intellect: 13, wits: 13, luck: 10 };

function makeHero() {
  return finish(
    setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores: SCORES }, 'sellsword'), 'Harrow'),
  );
}

/** A run standing somewhere that is not the arrival tile. */
function runOnFloor(floor = 2, steps = 6) {
  const run = createRun({ masterSeed: SEED, floor, hero: makeHero() });
  for (let i = 0; i < steps; i += 1) run.press('forward');
  return run;
}

describe('the Return Mark (05 section 9)', () => {
  it('is left where the scroll was read', () => {
    const town = createTown();
    const run = runOnFloor();
    expect(markOf(town)).toBe(null);

    const placed = placeMark(town, run);
    expect(placed.ok).toBe(true);
    expect(town.mark).toMatchObject({ floor: run.floor.floor, pos: run.ex.pos });
    // The mark is a copy: walking on does not drag it along.
    const where = [...run.ex.pos];
    run.press('forward');
    expect(town.mark.pos).toEqual(where);
  });

  it('is one at a time, and a second scroll replaces it', () => {
    const town = createTown();
    const first = runOnFloor(2, 4);
    placeMark(town, first);
    const was = [...town.mark.pos];

    const second = runOnFloor(3, 8);
    placeMark(town, second);
    expect(markOf(town).floor).toBe(3);
    expect(markOf(town).pos).not.toEqual(was);
  });

  it('cannot be placed in the boss arena', () => {
    const run = createRun({ masterSeed: SEED, floor: 1, hero: makeHero() });
    const [ax, ay, aw, ah] = run.floor.arena.rect;
    const inside = [ax + Math.floor(aw / 2), ay + Math.floor(ah / 2)];
    expect(whyNotMark(run.floor, inside)).toBe('inArena');
    expect(whyNotMark(run.floor, run.floor.arena.stairsDown)).toBe('inArena');
    expect(whyNotMark(null, null)).toBe('nowhere');

    const town = createTown();
    const standing = { floor: run.floor, ex: { pos: inside, facing: 0 } };
    expect(placeMark(town, standing)).toMatchObject({ ok: false, why: 'inArena' });
    expect(markOf(town)).toBe(null);
  });

  it('is offered once, and using it takes it away', () => {
    const town = createTown();
    const run = runOnFloor(2, 5);
    placeMark(town, run);
    expect(markStart(town)).toMatchObject({ floor: 2, at: run.ex.pos });

    const used = useMark(town);
    expect(used).toMatchObject({ floor: 2 });
    expect(markOf(town)).toBe(null);
    expect(useMark(town)).toBe(null);
    expect(markStart(town)).toBe(null);
  });

  it('can be thrown away without being used', () => {
    const town = createTown();
    placeMark(town, runOnFloor());
    expect(clearMark(town)).toMatchObject({ floor: 2 });
    expect(markOf(town)).toBe(null);
  });
});

describe('coming back up', () => {
  it('turns the day over, and leaves a mark only when asked', () => {
    const town = createTown();
    const run = runOnFloor();
    expect(town.day).toBe(1);

    const plain = returnToTown(town, { run });
    expect(plain).toMatchObject({ day: 2, mark: null });

    const scrolled = returnToTown(town, { run, leaveMark: true });
    expect(scrolled.day).toBe(3);
    expect(scrolled.mark).toMatchObject({ floor: 2 });
    // The trip count is untouched: coming back is not going down.
    expect(nextTrip(town)).toBe(1);
  });

  it('says when the mark could not be left, and still comes home', () => {
    const town = createTown();
    const run = createRun({ masterSeed: SEED, floor: 1, hero: makeHero() });
    const [ax, ay] = run.floor.arena.rect;
    const standing = { floor: run.floor, ex: { pos: [ax + 1, ay + 1], facing: 0 } };
    const left = returnToTown(town, { run: standing, leaveMark: true });
    expect(left).toMatchObject({ day: 2, why: 'inArena' });
    expect(markOf(town)).toBe(null);
  });
});

describe('a trip that begins at the mark', () => {
  it('starts where the scroll was read, not in the arrival room', () => {
    const town = createTown();
    const first = runOnFloor(2, 7);
    const where = [...first.ex.pos];
    const facing = first.ex.facing;
    returnToTown(town, { run: first, leaveMark: true });

    const back = createRun({
      masterSeed: SEED,
      floor: 2,
      hero: makeHero(),
      startAt: useMark(town),
    });
    expect(back.ex.pos).toEqual(where);
    expect(back.ex.facing).toBe(facing);
    expect(back.floor.floor).toBe(2);
    // And the floor is the same floor: the seed rebuilt it (`05` section 11).
    expect(back.floor.start.pos).toEqual(first.floor.start.pos);
  });

  it('begins in the arrival room when there is no mark', () => {
    const run = createRun({ masterSeed: SEED, floor: 2, hero: makeHero(), startAt: null });
    expect(run.ex.pos).toEqual(run.floor.start.pos);
  });
});

describe('the scroll itself (04 section 9)', () => {
  it('is a scroll that says what it does', () => {
    expect(item('scroll_of_return').use).toMatchObject({ returnToTown: true, leavesMark: true });
    expect(item('scroll_of_return').cost).toBe(100);
  });

  it('can be read now that there is a town to go to', () => {
    const hero = makeHero();
    const scroll = addItem(hero.pack, 'scroll_of_return').entry;
    const built = actionForItem(hero, scroll.instanceId, { inCombat: false });
    expect(built.action).toBeTruthy();
    expect(built.action.fp).toBe(0);

    const done = resolveItemAction(
      { rng: { roll: () => 1 }, hooks: null, units: [], floor: 2 },
      hero,
      built.action,
    );
    expect(done).toMatchObject({ returnToTown: true, leavesMark: true, flee: true });
  });

  it('ends a fight by ending the trip', () => {
    const hero = makeHero();
    const scroll = addItem(hero.pack, 'scroll_of_return').entry;
    const fight = createFight({
      hero,
      monsters: [makeMonster('kobold', { floor: 1 })],
      masterSeed: 5,
      surprise: false,
    });
    expect(fight.leftDungeon).toBe(null);
    fight.act('item', { item: scroll.instanceId });
    expect(fight.leftDungeon).toMatchObject({ leaveMark: true });
    expect(fight.outcome).toBe('fled');
  });
});
