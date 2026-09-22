/**
 * Saving (`05` section 11): the codec and its checksum, the migration chain,
 * the safe write and the backup, when the game writes, and the game written
 * down and read back without changing its luck.
 */
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { checksumOf, decode, encode, seal, stableStringify, verify } from '../src/save/codec.js';
import { MIGRATIONS, SAVE_VERSION, migrate } from '../src/save/migrations.js';
import { openStore } from '../src/save/store.js';
import { STEP_BATCH_MS, createSaver } from '../src/save/saver.js';
import { restoreSession, slotFor, takeSnapshot } from '../src/save/snapshot.js';
import { createSession } from '../src/systems/session.js';
import { memoryFor } from '../src/systems/floor-memory.js';
import { serializeStreams } from '../src/engine/rng.js';
import { loopHero } from '../tools/lib/looper.js';
import { buildHero } from '../tools/lib/builds.js';
import { flyOneTurn } from '../tools/lib/simulator.js';
import rules from '../src/data/saving.json' with { type: 'json' };

/** A fresh, private IndexedDB for each test. */
const freshStore = () => openStore({ indexedDB: new IDBFactory() });

/** A game a little way into its first trip. */
function gameUnderway(seed = 4242, steps = 60) {
  const session = createSession({ hero: loopHero(seed), seed });
  const run = session.descend({ floor: 1 });
  walk(run, steps);
  return session;
}

const MOVES = ['forward', 'turnLeft', 'forward', 'forward', 'turnRight', 'forward', 'strafeLeft', 'back'];
function walk(run, steps, offset = 0) {
  for (let i = 0; i < steps; i += 1) run.press(MOVES[(i + offset) % MOVES.length]);
}

describe('the codec', () => {
  it('writes Sets and Maps and reads them back as themselves', () => {
    const state = { seen: new Set(['1,2', '3,4']), looks: new Map([['red', 'healing']]), n: 3 };
    const back = decode(encode(state));
    expect(back.seen).toBeInstanceOf(Set);
    expect([...back.seen]).toEqual(['1,2', '3,4']);
    expect(back.looks.get('red')).toBe('healing');
  });

  it('stringifies the same state the same way whatever order its keys arrived in', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('seals a save with a sha1 checksum and notices any change to it', async () => {
    const save = await seal({ version: 1, hero: { name: 'Harrow', hp: 12 } });
    expect(save.checksum).toMatch(/^sha1-[0-9a-f]{40}$/);
    expect(await verify(save)).toBe(true);
    expect(await verify({ ...save, hero: { name: 'Harrow', hp: 13 } })).toBe(false);
    // The checksum is over everything but itself.
    expect(await checksumOf(save)).toBe(save.checksum);
  });
});

describe('the migration chain (05 section 11, Versioning)', () => {
  it('is at version 1 with an empty chain ready for version 2 (00, Launch checklist)', () => {
    expect(SAVE_VERSION).toBe(1);
    expect(Object.keys(MIGRATIONS)).toEqual([]);
    expect(migrate({ version: 1, a: 1 })).toMatchObject({ from: 1, to: 1, save: { a: 1 } });
  });

  it('upgrades one version at a time, in order', () => {
    const steps = {
      1: (save) => ({ ...save, trail: [...save.trail, 'v2'] }),
      2: (save) => ({ ...save, trail: [...save.trail, 'v3'] }),
    };
    const { save, from, to } = migrate({ version: 1, trail: [] }, { version: 3, steps });
    expect([from, to]).toEqual([1, 3]);
    expect(save.trail).toEqual(['v2', 'v3']);
    expect(save.version).toBe(3);
  });

  it('refuses a save from a newer game, or one with a gap in its chain', () => {
    expect(() => migrate({ version: 2 })).toThrow(/newer/);
    expect(() => migrate({ version: 1 }, { version: 3, steps: { 1: (s) => s } })).toThrow(/no migration from version 2/);
    expect(() => migrate({})).toThrow(/no version/);
  });
});

describe('safe writing (05 section 11)', () => {
  it('writes a slot and reads it back', async () => {
    const store = await freshStore();
    await store.write('1', { version: 1, hero: { name: 'Harrow' } });
    const { save, recovered } = await store.read('1');
    expect(save.hero.name).toBe('Harrow');
    expect(recovered).toBe(false);
    expect(await store.lastSlot()).toBe('1');
    // Nothing half-written is left behind.
    expect(await store.raw('1', 'temp')).toBeUndefined();
  });

  it('keeps the previous save as the backup', async () => {
    const store = await freshStore();
    await store.write('1', { version: 1, turn: 1 });
    await store.write('1', { version: 1, turn: 2 });
    expect(decode(await store.raw('1', 'main')).turn).toBe(2);
    expect(decode(await store.raw('1', 'backup')).turn).toBe(1);
  });

  it('loads the backup when the main save fails its checksum, and says so', async () => {
    const store = await freshStore();
    await store.write('1', { version: 1, turn: 1 });
    await store.write('1', { version: 1, turn: 2 });
    // One flipped number: the text still parses, the checksum no longer holds.
    const text = await store.raw('1', 'main');
    await store.poke('1', 'main', text.replace('"turn":2', '"turn":9'));
    const { save, recovered } = await store.read('1');
    expect(recovered).toBe(true);
    expect(save.turn).toBe(1);
  });

  it('loads the backup when the main save will not even parse', async () => {
    const store = await freshStore();
    await store.write('1', { version: 1, turn: 1 });
    await store.write('1', { version: 1, turn: 2 });
    await store.poke('1', 'main', '{"version":1,"tu');
    expect(await store.read('1')).toMatchObject({ recovered: true, save: { turn: 1 } });
  });

  it('reports a slot neither copy can vouch for as corrupt, not half-loaded', async () => {
    const store = await freshStore();
    await store.write('1', { version: 1, turn: 1 });
    await store.poke('1', 'main', 'nonsense');
    await store.poke('1', 'backup', 'nonsense');
    expect(await store.read('1')).toEqual({ save: null, recovered: false, corrupt: true });
  });

  it('shrugs off a write that died half way: the main save is untouched', async () => {
    const store = await freshStore();
    await store.write('1', { version: 1, turn: 1 });
    // What a force-close between step 1 and step 3 leaves: a temp record.
    await store.poke('1', 'temp', '{"version":1,"turn":2,"chec');
    expect(await store.read('1')).toMatchObject({ recovered: false, save: { turn: 1 } });
    // And the next write clears it away.
    await store.write('1', { version: 1, turn: 3 });
    expect(await store.raw('1', 'temp')).toBeUndefined();
  });

  it('says nothing is there for an empty slot, and forgets a removed one', async () => {
    const store = await freshStore();
    expect(await store.read('2')).toEqual({ save: null, recovered: false });
    await store.write('2', { version: 1 });
    await store.remove('2');
    expect(await store.read('2')).toEqual({ save: null, recovered: false });
    expect(await store.lastSlot()).toBe(null);
  });

  it('lists what the Title screen shows of each slot', async () => {
    const store = await freshStore();
    const session = gameUnderway();
    await store.write('1', takeSnapshot(session, { now: new Date('2026-09-21T10:00:00Z') }));
    const [row] = await store.list();
    expect(row.slot).toBe('1');
    expect(row.summary).toMatchObject({ name: session.hero.name, place: 'dungeon', floor: 1, mode: 'adventurer' });
  });
});

describe('when the game writes (05 section 11)', () => {
  /** A store that takes a while and records how many writes ran at once. */
  function slowStore() {
    const seen = { writes: [], most: 0, now: 0 };
    return {
      seen,
      async write(slot, save) {
        seen.now += 1;
        seen.most = Math.max(seen.most, seen.now);
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.writes.push({ slot, save });
        seen.now -= 1;
        return { ok: true };
      },
    };
  }

  it('commits now, and resolves only once the save is written', async () => {
    const store = slowStore();
    let turn = 1;
    const saver = createSaver({ store, slot: () => '1', snapshot: () => ({ turn }) });
    const written = saver.commit();
    expect(store.seen.writes).toHaveLength(0);
    await written;
    expect(store.seen.writes.map((w) => w.save.turn)).toEqual([1]);
    turn = 2;
    await saver.commit();
    expect(store.seen.writes.map((w) => w.save.turn)).toEqual([1, 2]);
  });

  it('never runs two writes at once, and shares a write that has not started', async () => {
    const store = slowStore();
    let turn = 0;
    const saver = createSaver({ store, slot: () => '1', snapshot: () => ({ turn }) });
    turn = 1;
    const first = saver.commit();
    // Let the first write start and take its snapshot.
    await new Promise((resolve) => setTimeout(resolve, 1));
    turn = 2;
    const second = saver.commit();
    turn = 3;
    const third = saver.commit();
    expect(third).toBe(second);
    await Promise.all([first, second, third]);
    expect(store.seen.most).toBe(1);
    // The shared write snapshots the game as it is when it starts: turn 3.
    expect(store.seen.writes.map((w) => w.save.turn)).toEqual([1, 3]);
  });

  it('batches a quiet step within the batch window', async () => {
    expect(STEP_BATCH_MS).toBe(rules.stepBatchMs);
    const store = slowStore();
    const timers = [];
    const saver = createSaver({
      store,
      slot: () => '1',
      snapshot: () => ({}),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    });
    saver.soon();
    saver.soon();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(250);
    expect(saver.pending).toBe(true);
    timers[0].fn();
    await saver.flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.seen.writes).toHaveLength(1);
  });

  it('writes anything pending when the app goes to the background', async () => {
    const store = slowStore();
    const saver = createSaver({ store, slot: () => '1', snapshot: () => ({}), setTimer: () => 1, clearTimer: () => {} });
    saver.soon();
    await saver.flush();
    expect(store.seen.writes).toHaveLength(1);
  });

  it('commits a random outcome before handing it back, and batches one that rolled nothing', async () => {
    const store = slowStore();
    let luck = 'a';
    const timers = [];
    const saver = createSaver({
      store,
      slot: () => '1',
      snapshot: () => ({ luck }),
      luck: () => luck,
      setTimer: (fn, ms) => timers.push(fn),
      clearTimer: () => {},
    });

    // A roll: the stream moves, and the result is not handed back until the
    // save that holds it is written (05 section 11: commit before show).
    const rolled = await saver.after(() => {
      luck = 'b';
      return 'a trap goes off';
    });
    expect(rolled).toBe('a trap goes off');
    expect(store.seen.writes.map((w) => w.save.luck)).toEqual(['b']);

    // A quiet step: handed back at once, written within the batch.
    const quiet = await saver.after(() => 'a step');
    expect(quiet).toBe('a step');
    expect(store.seen.writes).toHaveLength(1);
    expect(timers).toHaveLength(1);
  });

  it('writes nothing while there is no slot to write to', async () => {
    const store = slowStore();
    const saver = createSaver({ store, slot: () => null, snapshot: () => ({}) });
    expect(await saver.commit()).toBe(null);
    expect(store.seen.writes).toHaveLength(0);
  });
});

describe('the game written down and read back', () => {
  it('carries the save file fields 05 section 14 names', () => {
    const save = takeSnapshot(gameUnderway(), { now: new Date('2026-09-21T10:00:00Z'), screen: 'explore' });
    expect(save).toMatchObject({
      version: SAVE_VERSION,
      savedAt: '2026-09-21T10:00:00.000Z',
      mode: 'adventurer',
      masterSeed: 4242,
      location: { place: 'dungeon', floor: 1, screen: 'explore' },
      combat: null,
    });
    expect(Object.keys(save.rng).sort()).toEqual(['combat', 'encounter', 'loot']);
    // The map is never saved, only the floor's seed and what changed on it.
    expect(save.run).not.toHaveProperty('map');
  });

  it('picks the game up where it was left, and its luck with it (05 section 11, principle 2)', () => {
    const session = gameUnderway();
    const back = restoreSession(decode(encode(takeSnapshot(session))));
    expect(back.run.ex.pos).toEqual(session.run.ex.pos);
    expect(back.run.ex.facing).toBe(session.run.ex.facing);
    expect(back.run.ex.steps).toBe(session.run.ex.steps);
    expect(serializeStreams(back.rng)).toEqual(serializeStreams(session.rng));
    expect(stableStringify(back.hero)).toBe(stableStringify(session.hero));
    expect(stableStringify(back.town)).toBe(stableStringify(session.town));

    // The same moves from here go the same way, wandering checks and all.
    walk(session.run, 60, 3);
    walk(back.run, 60, 3);
    expect(back.run.ex.pos).toEqual(session.run.ex.pos);
    expect(back.run.log).toEqual(session.run.log);
    expect(serializeStreams(back.rng)).toEqual(serializeStreams(session.rng));
  });

  it('stores what changed on the floor, and puts it back on a floor rebuilt from the seed', () => {
    const session = gameUnderway();
    const floor = session.run.floor;
    const [chestAt] = Object.keys(floor.chests);
    const [trapAt] = Object.keys(floor.traps ?? {});
    floor.chests[chestAt].opened = true;
    if (trapAt) floor.traps[trapAt].sprung = true;

    const save = takeSnapshot(session);
    expect(Object.keys(save.run.changes.chests.entries)).toEqual([chestAt]);

    const back = restoreSession(decode(encode(save)));
    expect(back.run.floor.chests[chestAt].opened).toBe(true);
    if (trapAt) expect(back.run.floor.traps[trapAt].sprung).toBe(true);
  });

  it('does not count a visit, or restock a floor, a second time on loading', () => {
    const session = gameUnderway();
    const before = memoryFor(session.town, 1);
    const back = restoreSession(decode(encode(takeSnapshot(session))));
    const after = memoryFor(back.town, 1);
    expect(after.visits).toBe(before.visits);
    expect(after.restockedOnDay).toBe(before.restockedOnDay);
    expect(after.addedChests).toEqual(before.addedChests);
  });

  it('saves a game in town between trips, and goes back down from it', () => {
    const session = gameUnderway();
    session.leaveDungeon();
    const save = takeSnapshot(session);
    expect(save.location).toMatchObject({ place: 'town', floor: null });
    expect(save.run).toBe(null);
    const back = restoreSession(decode(encode(save)));
    expect(back.inDungeon).toBe(false);
    expect(back.town.day).toBe(session.town.day);
    expect(back.descend({ floor: 1 }).floor.floor).toBe(1);
  });

  it('stays well under the 200 KB 05 section 11 expects', () => {
    const session = gameUnderway(4242, 400);
    expect(encode(takeSnapshot(session)).length).toBeLessThan(rules.expectedBytes);
  });

  it('goes through the store and back', async () => {
    const store = await freshStore();
    const session = gameUnderway();
    await store.write('1', takeSnapshot(session));
    const { save } = await store.read('1');
    expect(restoreSession(save).run.ex.pos).toEqual(session.run.ex.pos);
  });
});

describe('what saving needed from the rest of the game', () => {
  it('keeps an opened chest opened on the next trip (05 section 8)', () => {
    const session = gameUnderway();
    const [at] = Object.keys(session.run.floor.chests);
    session.run.floor.chests[at].opened = true;
    session.leaveDungeon();
    const next = session.descend({ floor: 1 });
    expect(next.floor.chests[at].opened).toBe(true);
  });

  it('carries the random streams from trip to trip and fight to fight (05 section 11)', () => {
    const session = createSession({ hero: loopHero(4242), seed: 4242 });
    session.descend({ floor: 1 });
    const first = session.startFight();
    const before = serializeStreams(session.rng).combat;
    first.act('attack');
    // The fight drew on the game's own combat stream.
    expect(serializeStreams(session.rng).combat).not.toEqual(before);
    // And the next fight starts from where that one stopped, not over again.
    session.endFight();
    const second = session.startFight();
    expect(second.combat.rng).toBe(session.rng.combat);
  });

  it('puts a new Adventurer in the first free slot, and an Ironman in one of their own', () => {
    const slots = rules.slots.adventurer;
    expect(slotFor({ mode: 'adventurer' }, [], slots)).toBe('1');
    expect(slotFor({ mode: 'adventurer' }, [{ slot: '1', summary: {} }], slots)).toBe('2');
    const full = [
      { slot: '1', summary: { savedAt: '2026-09-20T00:00:00Z' } },
      { slot: '2', summary: { savedAt: '2026-09-18T00:00:00Z' } },
      { slot: '3', summary: { savedAt: '2026-09-19T00:00:00Z' } },
    ];
    expect(slotFor({ mode: 'adventurer' }, full, slots)).toBe('2');
    expect(slotFor({ mode: 'ironman', seed: 99 }, full, slots)).toBe('ironman-99');
  });
});

describe('a fight picked up where it was left (05 sections 13 and 14)', () => {
  /** A boss fight a few turns in, on a session that can be saved. */
  function midFight({ build = 'pure_warrior', floor = 1, seed = 4242, turns = 3 } = {}) {
    const hero = buildHero(build, { floor, seed });
    hero.seed = seed;
    hero.maxHp *= 3;
    hero.hp = hero.maxHp;
    const session = createSession({ hero, seed });
    session.descend({ floor: 1 });
    const fight = session.startBoss({ floor });
    for (let i = 0; i < turns && !fight.over; i += 1) flyOneTurn(fight);
    return session;
  }
  const reload = (session) => restoreSession(decode(encode(takeSnapshot(session))));

  it('writes the whole fight, and the last three log lines', () => {
    const session = midFight();
    const save = takeSnapshot(session);
    expect(save.location.place).toBe('combat');
    expect(save.combat).toMatchObject({ origin: { boss: 'rat_king' }, phase: 'hero' });
    expect(save.combat.log).toHaveLength(rules.resumeLogLines);
    expect(save.combat.log).toEqual(session.fight.log.slice(-3));
    // Each enemy's hit points, conditions and cooldowns; the round and order.
    const king = save.combat.units.find((unit) => unit.type === 'rat_king');
    expect(king).toMatchObject({ hp: expect.any(Number), conditions: expect.any(Object), abilities: expect.any(Array) });
    expect(save.combat.combat.round).toBe(session.fight.round);
    expect(save.combat.combat.order.every((entry) => entry.unit?.$unit)).toBe(true);
  });

  it('opens at the same turn, with the same field and the same three lines', () => {
    const session = midFight();
    const back = reload(session);
    expect(back.fight.round).toBe(session.fight.round);
    expect(back.fight.log).toEqual(session.fight.log.slice(-3));
    const field = (fight) => fight.combat.units.map((unit) => [unit.id, unit.hp, unit.alive, unit.row]);
    expect(field(back.fight)).toEqual(field(session.fight));
    expect(back.fight.hero).toBe(back.hero);
  });

  it('rolls nothing to load, so every stream is where it was', () => {
    const session = midFight();
    const back = reload(session);
    expect(serializeStreams(back.rng)).toEqual(serializeStreams(session.rng));
    expect(back.fight.combat.rng).toBe(back.rng.combat);
  });

  it('plays out exactly as it would have, summons and all (05 section 11, principle 2)', () => {
    for (const [build, floor] of [['wanderer', 1], ['battle_mage', 4], ['pure_warrior', 5], ['assassin', 9]]) {
      const session = midFight({ build, floor, seed: 900 + floor, turns: 4 });
      const back = reload(session);
      for (let i = 0; i < 300 && !session.fight.over; i += 1) {
        flyOneTurn(session.fight);
        flyOneTurn(back.fight);
      }
      const end = (fight) => stableStringify({ ...fight.toSave(), log: null, limits: null });
      expect([build, back.fight.outcome]).toEqual([build, session.fight.outcome]);
      expect(end(back.fight)).toBe(end(session.fight));
    }
  });

  it('hands out the Rat King\'s bonus once, even across a reload', () => {
    // A long fight against the swarm, so rounds keep starting after the reload.
    const session = midFight({ build: 'wanderer', seed: 901, turns: 6 });
    const back = reload(session);
    for (let i = 0; i < 12; i += 1) {
      flyOneTurn(session.fight);
      flyOneTurn(back.fight);
    }
    const atk = (fight) =>
      fight.combat.units.filter((unit) => unit.type === 'giant_rat').map((rat) => [rat.id, rat.atk]);
    expect(atk(back.fight)).toEqual(atk(session.fight));
    for (const rat of back.fight.combat.units.filter((unit) => unit.type === 'giant_rat')) {
      expect(rat.ledBy ?? []).toEqual([...new Set(rat.ledBy ?? [])]);
    }
  });

  it('keeps the uses a limited hook has spent', () => {
    const session = midFight();
    const limited = session.fight.combat.hooks.limits();
    const back = reload(session);
    expect(back.fight.combat.hooks.limits()).toEqual(limited);
  });

  it('keeps a finished fight\'s result for the Victory screen', () => {
    const session = midFight({ turns: 400 });
    expect(session.fight.over).toBe(true);
    const back = reload(session);
    expect(back.fight.over).toBe(true);
    expect(back.fight.outcome).toBe(session.fight.outcome);
    expect(back.fight.summary).toEqual(session.fight.summary);
  });
});

