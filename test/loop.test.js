/**
 * The Phase 6 "done when": the full loop works — descend, fight, return,
 * shop, descend again.
 *
 * `npm run loop` plays whole games through the same `createSession` the
 * screens drive and audits every step against `04` and `05`. This runs a
 * handful on every test run, and pins the session's own rules.
 */
import { describe, it, expect } from 'vitest';
import { playLoop, loopHero } from '../tools/lib/looper.js';
import { createSession } from '../src/systems/session.js';
import { ORIGIN_ORDER } from '../src/data/origins.js';
import { isAttuned, markOf, placeMark } from '../src/systems/travel.js';
import { memoryFor } from '../src/systems/floor-memory.js';

describe('the loop itself', () => {
  it('runs four trips through the real session without breaking a rule', () => {
    const played = [];
    for (const [index, origin] of ORIGIN_ORDER.entries()) {
      const seed = (index + 1) * 7919 + 13;
      const result = playLoop(seed, { trips: 4, origin });
      expect([origin, result.problems]).toEqual([origin, []]);
      played.push(result);
    }
    // Heroes die; the loop still has to have been walked by someone.
    const finished = played.filter((result) => result.trips >= 2);
    expect(finished.length).toBeGreaterThan(0);
    const counts = played.reduce((total, result) => total + result.counts.byStone, 0);
    expect(counts).toBeGreaterThan(0);
  });

  it('does every part of the loop somewhere in a game', () => {
    const result = playLoop(20260918, { trips: 4 });
    expect(result.problems).toEqual([]);
    expect(result.counts.trips).toBeGreaterThan(1);
    expect(result.counts.fights).toBeGreaterThan(0);
    expect(result.counts.byStone).toBeGreaterThan(0);
    expect(result.counts.rests).toBeGreaterThan(0);
    expect(result.counts.bought + result.counts.sold).toBeGreaterThan(0);
  });
});

describe('the session the screens and the tools share', () => {
  const start = (seed = 4242) => createSession({ hero: loopHero(seed), seed });

  it('starts in town, on day one, with the first trip to take', () => {
    const game = start();
    expect(game.inDungeon).toBe(false);
    expect(game.town).toMatchObject({ day: 1, trips: 0 });
    expect(game.run).toBe(null);
    expect(game.fight).toBe(null);
  });

  it('counts a trip down and a day back, and lets the run go', () => {
    const game = start();
    const run = game.descend({ floor: 1 });
    expect(game.inDungeon).toBe(true);
    expect(game.town.trips).toBe(1);
    expect(game.town.day).toBe(1);
    expect(run.floor.floor).toBe(1);
    // Arriving attunes nothing until the hero stands on the stone.
    expect(isAttuned(game.town, 1)).toBe(false);

    game.leaveDungeon({});
    expect(game.inDungeon).toBe(false);
    expect(game.town.day).toBe(2);
    expect(game.town.trips).toBe(1);
    expect(markOf(game.town)).toBe(null);
  });

  it('leaves a mark when the scroll asks, and begins there next time', () => {
    const game = start();
    const run = game.descend({ floor: 1 });
    for (let i = 0; i < 6; i += 1) run.press('forward');
    const where = [...run.ex.pos];
    placeMark(game.town, run);
    game.leaveDungeon({});
    expect(markOf(game.town)).toBeTruthy();

    const back = game.descend({ mark: true });
    expect(back.ex.pos).toEqual(where);
    expect(markOf(game.town)).toBe(null);
  });

  it('keeps the shop for a stay and rebuilds it on the next day', () => {
    const game = start();
    const first = game.shop;
    expect(game.shop).toBe(first);
    game.descend({ floor: 1 });
    game.leaveDungeon({});
    expect(game.shop).not.toBe(first);
    expect(game.shop.day).toBe(game.town.day);
  });

  it('remembers the floor between trips', () => {
    const game = start();
    const run = game.descend({ floor: 1 });
    for (let i = 0; i < 12; i += 1) run.press('forward');
    const seen = memoryFor(game.town, 1).explored.size;
    expect(seen).toBeGreaterThan(1);

    game.leaveDungeon({});
    const again = game.descend({ floor: 1 });
    expect(again.ex.explored.size).toBeGreaterThanOrEqual(seen);
    expect(memoryFor(game.town, 1).visits).toBe(2);
  });

  it('starts and forgets a fight', () => {
    const game = start();
    game.descend({ floor: 1 });
    const fight = game.startFight({ seed: 3 });
    expect(game.fight).toBe(fight);
    game.endFight();
    expect(game.fight).toBe(null);
  });
});
