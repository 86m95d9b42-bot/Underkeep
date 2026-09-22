/**
 * Falling (`01` section 12, `05` sections 9, 11 and 12): the score, the
 * record, the cause, an Ironman buried with their save, and the Death screen
 * in both modes.
 */
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  bestItemOf,
  causeText,
  deepestFloor,
  recordOf,
  scoreOf,
  totalSteps,
} from '../src/systems/death.js';
import { hurtBy } from '../src/systems/run.js';
import { createSession } from '../src/systems/session.js';
import { openStore } from '../src/save/store.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { createIdentification } from '../src/systems/identification.js';
import { addItem } from '../src/systems/inventory.js';
import { makeMonster } from '../src/data/monsters.js';
import { createFight } from '../src/systems/fight.js';
import { deathFrom } from '../src/ui/screens/death.js';

function makeHero({ gold = 200, seed = 5, mode = 'adventurer' } = {}) {
  const hero = finish(setName(chooseOrigin(createDraft({ seed, mode }), 'cutpurse'), 'Harrow'));
  hero.identification = createIdentification(seed);
  hero.gold = gold;
  return hero;
}

describe('the score (05 section 12)', () => {
  it('adds XP, gold, the deepest floor and the bosses — the mockup\'s own 15,213', () => {
    // Level 8, floor 5, four bosses, Ironman: (2,800 + 342 + 5,000 + 2,000) x 1.5.
    expect(scoreOf({ xp: 2800, gold: 342, deepest: 5, bosses: 4, mode: 'ironman' })).toBe(15213);
  });

  it('doubles for a victory, and adds half again for Ironman', () => {
    const base = { xp: 1000, gold: 0, deepest: 1, bosses: 0 };
    expect(scoreOf(base)).toBe(2000);
    expect(scoreOf({ ...base, victory: true })).toBe(4000);
    expect(scoreOf({ ...base, victory: true, mode: 'ironman' })).toBe(6000);
  });

  it('counts the deepest floor stood on, and every step of every trip', () => {
    const town = { floors: { 1: { floor: 1, visits: 2 }, 3: { floor: 3, visits: 1 }, 4: { floor: 4, visits: 0 } }, bosses: [1, 2], steps: 400 };
    expect(deepestFloor(town)).toBe(3);
    expect(deepestFloor(town, 5)).toBe(5);
    expect(totalSteps(town, { ex: { steps: 25 } })).toBe(425);
  });
});

describe('the best item owned', () => {
  it('is the rarest, then the dearest', () => {
    const hero = makeHero();
    hero.pack.items = [];
    addItem(hero.pack, 'long_sword', { count: 1, identified: true });
    addItem(hero.pack, 'long_sword', { count: 1, bonus: 2, identified: true });
    addItem(hero.pack, 'healing_potion', { count: 3, identified: true });
    // The +2 wins on price; it is named the way the hero knows it, identified or not.
    expect(bestItemOf(hero)).toMatchObject({ baseId: 'long_sword', bonus: 2 });
    expect(bestItemOf({ pack: { items: [] } })).toBe(null);
  });
});

describe('what killed them', () => {
  it('names a monster by its kind, a boss by its name, a trap by what it was', () => {
    expect(causeText({ kind: 'monster', name: 'Ghast' })).toBe('Slain by a Ghast');
    expect(causeText({ kind: 'monster', name: 'Orc' })).toBe('Slain by an Orc');
    expect(causeText({ kind: 'monster', name: 'Vyrmathrax the Ashen', boss: true })).toBe('Slain by Vyrmathrax the Ashen');
    expect(causeText({ kind: 'trap', id: 'dart_plate' })).toBe('Killed by a Dart Plate');
    expect(causeText({ kind: 'hazard', id: 'deep_water' })).toBe('Drowned in deep water');
    expect(causeText(null)).toBe('Lost in the dark');
    expect(causeText({ kind: 'trap', id: 'no_such_trap' })).toBe('Lost in the dark');
  });

  it('is what the run saw last hurt the hero', () => {
    expect(hurtBy({ type: 'trapSprung', trap: { kind: 'dart_plate', damage: 4 } })).toEqual({ kind: 'trap', id: 'dart_plate' });
    expect(hurtBy({ type: 'trapSprung', trap: { kind: 'alarm_tile', damage: 0 } })).toBe(null);
    expect(hurtBy({ type: 'drowning', damage: 3 })).toEqual({ kind: 'hazard', id: 'deep_water' });
    expect(hurtBy({ type: 'stairs' })).toBe(null);
  });

  it('is what the fight saw last hurt the hero', () => {
    const hero = makeHero();
    hero.hp = 1;
    const fight = createFight({ hero, monsters: [makeMonster('giant_rat'), makeMonster('giant_rat')], masterSeed: 3, surprise: false });
    for (let i = 0; i < 50 && !fight.over; i += 1) fight.act('defend');
    expect(fight.outcome).toBe('defeat');
    expect(fight.causeOfDeath).toMatchObject({ kind: 'monster', name: 'Giant Rat' });
  });
});

describe('falling (01 section 12, 05 section 9)', () => {
  it('writes the record as the hero stood, before the grave takes its half', () => {
    const hero = makeHero({ gold: 200 });
    const game = createSession({ hero, seed: 11 });
    game.descend({ floor: 2 });
    for (let i = 0; i < 6; i += 1) game.run.press('turnLeft');
    const fell = game.heroFell({ cause: { kind: 'monster', name: 'Ghoul' } });
    expect(fell.mode).toBe('adventurer');
    expect(fell.record).toMatchObject({ name: 'Harrow', gold: 200, floor: 2, steps: 6, cause: { name: 'Ghoul' } });
    expect(hero.gold).toBe(100);
    expect(fell.grave.gold).toBe(100);
    // The day turns over, the steps are kept, and the screen change is the caller's.
    expect(game.town.day).toBe(2);
    expect(game.town.steps).toBe(6);
    expect(game.inDungeon).toBe(false);
  });

  it('ends an Ironman run with no grave', () => {
    const hero = makeHero({ mode: 'ironman' });
    const game = createSession({ hero, seed: 11 });
    game.descend({ floor: 1 });
    const fell = game.heroFell();
    expect(fell.mode).toBe('ironman');
    expect(fell.grave).toBe(null);
    expect(fell.record.mode).toBe('ironman');
    expect(hero.alive).toBe(false);
  });

  it('counts the steps of a trip that came home, too', () => {
    const game = createSession({ hero: makeHero(), seed: 11 });
    game.descend({ floor: 1 });
    for (let i = 0; i < 4; i += 1) game.run.press('turnRight');
    game.leaveDungeon();
    expect(game.town.steps).toBe(4);
  });
});

describe('an Ironman buried with their save (05 section 11)', () => {
  it('deletes the save and sends the tombstone to the Hall in one go', async () => {
    const store = await openStore({ indexedDB: new IDBFactory() });
    await store.write('ironman-7', { version: 1, hero: { name: 'Harrow' } });
    const record = recordOf({ hero: makeHero({ mode: 'ironman' }), town: { day: 3, bosses: [1] }, cause: { kind: 'monster', name: 'Ghast' } });
    await store.bury('ironman-7', record);
    expect(await store.read('ironman-7')).toEqual({ save: null, recovered: false });
    expect(await store.raw('ironman-7', 'backup')).toBeUndefined();
    expect(await store.lastSlot()).toBe(null);
    const [stone] = await store.hall();
    expect(stone).toMatchObject({ name: 'Harrow', mode: 'ironman', cause: { name: 'Ghast' } });
  });

  it('keeps the Hall best score first', async () => {
    const store = await openStore({ indexedDB: new IDBFactory() });
    for (const score of [300, 9000, 1200]) await store.addToHall({ name: 'x', score });
    expect((await store.hall()).map((row) => row.score)).toEqual([9000, 1200, 300]);
    expect(await store.hall(2)).toHaveLength(2);
  });
});

describe('the Death screen', () => {
  it('shows the fall it was handed, in either mode', () => {
    const record = { mode: 'ironman', name: 'Harrow' };
    expect(deathFrom({ record }, {})).toMatchObject({ mode: 'ironman', record, grave: null });
    const grave = { floor: 3, gold: 40, items: [] };
    expect(deathFrom({ record: { ...record, mode: 'adventurer' }, grave }, {})).toMatchObject({ mode: 'adventurer', grave });
  });

  it('draws the game in progress when opened without one, as the tools do', () => {
    const game = createSession({ hero: makeHero(), seed: 11 });
    const run = game.descend({ floor: 1 });
    const shown = deathFrom({}, { run, town: game.town });
    expect(shown.record).toMatchObject({ name: 'Harrow', floor: 1, mode: 'adventurer' });
  });
});
