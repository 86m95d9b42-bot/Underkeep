/**
 * A scaled-down generator sweep (docs/TASKS.md, Phase 2).
 *
 * The full run is 10,000 seeds x 10 floors and takes minutes, so it lives in
 * `npm run sweep`. This is the share of it small enough to run on every change:
 * enough floors to catch a generator that has started producing broken ones,
 * and a guard on the pacing numbers so they cannot quietly get worse.
 */
import { describe, it, expect } from 'vitest';
import { buildFloor, distancesFrom } from '../src/dungeon/floor-builder.js';
import { checkSolvable } from '../src/dungeon/solvability.js';
import { layoutStream } from '../src/engine/rng.js';
import { pacing } from '../src/data/floors.js';

/**
 * Seeds per floor. The full sweep does 10,000 and takes minutes; this is the
 * share that can run on every change without making the suite a chore.
 */
const SEEDS = 40;

/**
 * Every floor, for every seed, built once and kept — the tests below all read
 * the same set rather than rebuilding it each time.
 */
const swept = (() => {
  const byFloor = new Map();
  for (let floor = 1; floor <= 10; floor += 1) {
    const rows = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const built = buildFloor(floor, seed, layoutStream);
      const dist = distancesFrom(built.map, built.start.pos);
      rows.push({
        seed,
        floor: built,
        attempt: built.attempt,
        path: dist[built.arena.entrance[1]][built.arena.entrance[0]],
      });
    }
    byFloor.set(floor, rows);
  }
  return byFloor;
})();

const everyRow = [...swept.values()].flat();

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe(`building ${SEEDS} seeds x 10 floors`, () => {
  it('builds every one of them', () => {
    expect(everyRow).toHaveLength(SEEDS * 10);
  });

  it('leaves every one finishable by a hero with no skills and no items', () => {
    // 05 section 4. This is the check the whole sweep exists for.
    const broken = everyRow
      .map((row) => ({ row, verdict: checkSolvable(row.floor) }))
      .filter(({ verdict }) => !verdict.ok)
      .map(({ row, verdict }) => `floor ${row.floor.floor} seed ${row.seed}: ${verdict.problems.join('; ')}`);
    expect(broken).toEqual([]);
  });

  it('rarely needs a rebuild', () => {
    // 05 section 3 step 10 allows a rebuild; it should stay the exception.
    const rebuilt = everyRow.filter((row) => row.attempt > 0).length;
    expect(rebuilt / everyRow.length, `${rebuilt} of ${everyRow.length} rebuilt`).toBeLessThan(0.1);
  });

  it('never gives up on a floor', () => {
    for (const row of everyRow) expect(row.attempt).toBeLessThan(8);
  });
});

describe('pacing', () => {
  // 05 section 2 asks for 150-300 steps from arrival to the boss on every
  // floor. The deep floors manage it; the 33 x 33 floors cannot, and that is
  // an open question in docs/DECISIONS.md, not something the generator can fix.
  // The numbers below lock in what is measured today, so the pacing cannot get
  // quietly worse while the question is open.
  // Measured over three separate 40-seed ranges, then given room to wobble:
  // the medians moved by about ten steps between ranges, so each floor in
  // range is set comfortably below the lowest median seen.
  const OBSERVED_MEDIAN_AT_LEAST = { 1: 90, 2: 90, 3: 90, 4: 135, 5: 135, 6: 125, 7: 125, 8: 190, 9: 190, 10: 180 };

  it.each([...swept.keys()].map((floor) => [floor]))(
    'floor %i keeps at least the critical path length it has today',
    (floor) => {
      const lengths = swept.get(floor).map((row) => row.path);
      expect(median(lengths), `median ${median(lengths)}`).toBeGreaterThanOrEqual(
        OBSERVED_MEDIAN_AT_LEAST[floor],
      );
    },
  );

  it('meets the documented 150 to 300 steps on the deepest floors', () => {
    for (const floor of [8, 9, 10]) {
      const lengths = swept.get(floor).map((row) => row.path);
      const inBand = lengths.filter((n) => n >= pacing.criticalPathSteps[0] && n <= pacing.criticalPathSteps[1]);
      expect(inBand.length / lengths.length, `floor ${floor}`).toBeGreaterThan(0.6);
    }
  });

  it('still falls short on the 33 x 33 floors, which is the open question', () => {
    // Written as a fact rather than a wish: if a change ever makes floors 1-3
    // reach the documented band, this test is what should be deleted.
    for (const floor of [1, 2, 3]) {
      const lengths = swept.get(floor).map((row) => row.path);
      const inBand = lengths.filter((n) => n >= pacing.criticalPathSteps[0]);
      expect(inBand.length / lengths.length, `floor ${floor} now reaches the band`).toBeLessThan(0.5);
    }
  });

  it('never builds a floor the hero can cross in a handful of steps', () => {
    for (const row of everyRow) {
      expect(row.path, `floor ${row.floor.floor} seed ${row.seed}`).toBeGreaterThan(30);
    }
  });
});

describe('what every swept floor still holds true', () => {
  it('puts the hero on the up stairs beside a waystone, with a way to the boss', () => {
    for (const { floor } of everyRow) {
      expect(floor.start.pos).toEqual(floor.stairs.up);
      const gap =
        Math.abs(floor.waystone[0] - floor.stairs.up[0]) + Math.abs(floor.waystone[1] - floor.stairs.up[1]);
      expect(gap).toBe(1);
    }
  });

  it('gives every floor its documented counts', () => {
    for (const { floor } of everyRow) {
      // The floor's own, without what a theme feature adds: a Heat Vent is a
      // trap and the dragon's hoard is a chest (`05` section 6).
      expect(
        Object.values(floor.traps).filter((t) => t.on === 'floor' && !t.feature),
      ).toHaveLength(floor.spec.counts.floorTraps);
      expect(Object.values(floor.chests).filter((chest) => !chest.boss)).toHaveLength(
        floor.spec.counts.chests,
      );
      expect(Object.keys(floor.lairs)).toHaveLength(floor.spec.counts.lairs);
      const secrets = Object.keys(floor.secrets).length;
      expect(secrets).toBeGreaterThanOrEqual(2);
      expect(secrets).toBeLessThanOrEqual(4);
    }
  });
});
