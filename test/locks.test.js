/**
 * Opening what is shut (`03` section 6, "Ways to Open a Lock").
 *
 * Phase 2 gives the hero the two ways `05` section 4's minimum hero has —
 * bashing and the matching key — so these check the numbers those use and that
 * every other way says plainly what is missing.
 */
import { describe, it, expect } from 'vitest';
import {
  bashTn,
  stepsFor,
  waysToOpen,
  bestWay,
  rollBash,
  useKey,
  tryOpen,
  tn,
  lockData,
} from '../src/systems/locks.js';
import { createRun } from '../src/systems/run.js';
import { tileAhead } from '../src/dungeon/movement.js';
import { t } from '../src/data/strings.js';

/** A stream that rolls what it is told. */
function fakeRng(...rolls) {
  const queue = [...rolls];
  const rng = () => 0;
  rng.die = () => (queue.length > 1 ? queue.shift() : queue[0]);
  rng.d20 = () => rng.die(20);
  return rng;
}

describe('the numbers', () => {
  it('bashes a stuck door at TN 8 + F (03 section 6)', () => {
    expect(bashTn({ kind: 'stuck' }, 1)).toBe(9);
    expect(bashTn({ kind: 'stuck' }, 7)).toBe(15);
    // The builder stores the TN on the door; it wins if it is there.
    expect(bashTn({ kind: 'stuck', bashTn: 12 }, 1)).toBe(12);
  });

  it('bashes a lock at its tier TN plus 2', () => {
    // Crude 8 + F, Standard 10 + F, Masterwork 13 + F (03 section 2).
    expect(bashTn({ kind: 'locked', tier: 'crude' }, 1)).toBe(11);
    expect(bashTn({ kind: 'locked', tier: 'standard' }, 4)).toBe(16);
    expect(bashTn({ kind: 'locked', tier: 'masterwork' }, 10)).toBe(25);
    expect(tn(lockData.tiers.standard.pickTn, 10)).toBe(20);
  });

  it('spends the steps the rules give each way', () => {
    // 03 section 1: bash 2, key 1, pick 5, Dispel Ward 5.
    expect(stepsFor('bash')).toBe(2);
    expect(stepsFor('key')).toBe(1);
    expect(stepsFor('pick')).toBe(5);
    expect(stepsFor('dispelWard')).toBe(5);
    expect(() => stepsFor('shout')).toThrow(/shout/);
  });
});

describe('what a hero can try', () => {
  it('can only bash a stuck door', () => {
    const ways = waysToOpen({ kind: 'stuck' });
    expect(ways.find((w) => w.method === 'bash').usable).toBe(true);
    expect(ways.find((w) => w.method === 'pick').usable).toBe(false);
    expect(bestWay({ kind: 'stuck' }).method).toBe('bash');
  });

  it('prefers the key to breaking the door down', () => {
    const door = { kind: 'keyed', keyId: 'floorkey_4' };
    expect(bestWay(door, { keysHeld: new Set() })).toBe(null);
    expect(bestWay(door, { keysHeld: new Set(['floorkey_4']) }).method).toBe('key');
  });

  it('says what is missing, rather than saying nothing', () => {
    const locked = waysToOpen({ kind: 'locked', tier: 'standard' });
    expect(locked.find((w) => w.method === 'pick').why).toBe('noLockpicks');
    expect(locked.find((w) => w.method === 'knock').why).toBe('noKnock');

    const sealed = waysToOpen({ kind: 'sealed' });
    expect(sealed.every((w) => !w.usable)).toBe(true);
    expect(sealed[0].why).toBe('noDispel');

    expect(bestWay({ kind: 'barred', passFrom: [1, 1] })).toBe(null);
  });

  it('opens up as the hero gains the means', () => {
    const door = { kind: 'locked', tier: 'standard' };
    expect(bestWay(door, { has: {} }).method).toBe('bash');
    expect(bestWay(door, { has: { lockpicks: true } }).method).toBe('pick');
    expect(bestWay(door, { has: { knock: true } }).method).toBe('knock');
  });
});

describe('the roll', () => {
  it('opens on the target number and not below it', () => {
    const door = { kind: 'locked', tier: 'crude' }; // TN 8 + 1 + 2 = 11 on floor 1
    expect(rollBash(fakeRng(11), door, 1).opened).toBe(true);
    expect(rollBash(fakeRng(10), door, 1).opened).toBe(false);
    // The hero's Might and crowbar count towards it.
    expect(rollBash(fakeRng(10), door, 1, 1).opened).toBe(true);
  });

  it('reports the roll it made, so it can be saved before it is shown', () => {
    const outcome = rollBash(fakeRng(14), { kind: 'stuck' }, 3, 2);
    expect(outcome).toMatchObject({ method: 'bash', roll: 14, bonus: 2, total: 16, tn: 11, opened: true });
    expect(outcome.steps).toBe(2);
    expect(outcome.noisy).toBe(true);
  });

  it('turns a key with no roll at all', () => {
    const outcome = useKey({ kind: 'keyed', keyId: 'k' });
    expect(outcome).toMatchObject({ method: 'key', opened: true, steps: 1, noisy: false });
  });

  it('does nothing when the hero has no way in', () => {
    expect(tryOpen({ door: { kind: 'sealed' }, floor: 4, rng: fakeRng(20) })).toBe(null);
    expect(tryOpen({ door: { kind: 'keyed', keyId: 'k' }, floor: 4, rng: fakeRng(20) })).toBe(null);
  });
});

describe('opening a door in a run', () => {
  /** Finds a shut door on a real floor and stands the hero in front of it. */
  function faceADoor(kind, floors = [2]) {
    for (let seed = 1; seed < 30; seed += 1) {
      const floorNumber = floors[seed % floors.length];
      const run = createRun({ masterSeed: seed * 131 + 7, floor: floorNumber });
      const found = Object.entries(run.floor.doors).find(([, door]) => door.kind === kind);
      if (!found) continue;
      const [at, door] = found;
      const [dx, dy] = at.split(',').map(Number);
      // Stand on a tile next to it, facing it.
      for (const [ox, oy, facing] of [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]]) {
        const from = [dx + ox, dy + oy];
        if (run.floor.map[from[1]]?.[from[0]] === 1) continue;
        run.ex.pos = from;
        run.ex.facing = facing;
        if (String(tileAhead(run.ex.pos, run.ex.facing)) === String([dx, dy])) return { run, door, at };
      }
    }
    throw new Error(`no ${kind} door found`);
  }

  it('bashes a stuck door open, in time and with noise', () => {
    const { run, at } = faceADoor('stuck');
    run.hero.bashBonus = 20; // always succeeds, so the test is about the rest
    const steps = run.ex.steps;

    expect(run.context).toBe('open');
    expect(run.actReason).toBe(undefined);
    expect(run.actHint).toContain(t('explore.way.bash'));

    const { events } = run.act();
    expect(events[0]).toMatchObject({ type: 'opened', method: 'bash' });
    expect(run.ex.doorsOpened.has(at)).toBe(true);
    expect(run.ex.steps).toBe(steps + 2);
    // Bashing is loud: a noise check follows every attempt (03 section 6).
    expect(events.some((e) => e.type === 'noiseCheck')).toBe(true);
    // A door trap may speak after the door does (`03` section 5), so the
    // line is in the log rather than last in it.
    expect(run.log.some((line) => line.text === t('explore.log.bashOpen'))).toBe(true);

    // And the way is now open.
    expect(run.press('forward').outcome.moved).toBe(true);
  });

  it('leaves a door shut when the roll fails, and says so', () => {
    const { run, at } = faceADoor('locked');
    run.hero.bashBonus = -20; // never succeeds
    const { events } = run.act();
    expect(events[0].type).toBe('heldShut');
    expect(run.ex.doorsOpened.has(at)).toBe(false);
    expect(run.log.at(-1).text).toBe(t('explore.log.bashFail'));
    expect(run.press('forward').outcome.moved).toBe(false);
  });

  it('names what a keyed door is waiting for', () => {
    // Keyed doors start deeper down (05 section 3 step 7).
    const { run, door } = faceADoor('keyed', [5, 6, 7, 8]);
    expect(run.context).toBe('open');
    expect(run.actReason).toBe(t('explore.reason.noKey'));
    expect(run.act().events).toEqual([]);

    // With the key in hand it simply opens.
    run.ex.keysTaken.add(door.keyId);
    expect(run.actReason).toBe(undefined);
    const { events } = run.act();
    expect(events[0]).toMatchObject({ type: 'opened', method: 'key' });
    expect(run.log.at(-1).text).toBe(t('explore.log.keyOpen'));
  });

  it('picks a key up by walking over it', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const run = createRun({ masterSeed: seed * 197 + 3, floor: 6 });
      const found = Object.entries(run.floor.keys)[0];
      if (!found) continue;
      const [at, entry] = found;
      const [kx, ky] = at.split(',').map(Number);

      // Stand next to the key and step onto it.
      const beside = [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]].find(
        ([ox, oy]) => run.floor.map[ky + oy]?.[kx + ox] !== undefined && run.floor.map[ky + oy][kx + ox] !== 1,
      );
      expect(beside, 'the key is walled in').toBeTruthy();
      run.ex.pos = [kx + beside[0], ky + beside[1]];
      run.ex.facing = beside[2];

      const { outcome, events } = run.press('forward');
      expect(outcome.moved).toBe(true);
      expect(events.some((e) => e.type === 'key')).toBe(true);
      // 05 section 14 keeps keys as floor state, not as a pack item.
      expect(run.ex.keysTaken.has(entry.id)).toBe(true);
      expect(run.log.at(-1).text).toBe(t('explore.log.keyTaken'));
      return;
    }
    throw new Error('no floor with a key found');
  });
});
