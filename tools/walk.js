/**
 * The Phase 2 "done when": every floor from a seed can be walked from arrival
 * to the boss arena.
 *
 *   npm run walk                  5 seeds x 10 floors
 *   npm run walk -- 25            25 seeds
 *   npm run walk -- 5 --verbose   a line per floor
 *   npm run walk -- 20 --bonus=8  with a hero who can swing a crowbar
 *
 * The walking itself is `tools/lib/walker.js`, which drives the same run the
 * Exploration screen drives. `--bonus` is what the hero adds to a bash: Might
 * modifier plus Brute Force plus a crowbar (`03` section 6). The default of 0
 * is the stand-in hero the game has until Phase 4.
 */
import { walkFloor } from './lib/walker.js';
import { FLOOR_COUNT } from '../src/data/floors.js';

const args = process.argv.slice(2);
const seeds = Number(args.find((a) => /^\d+$/.test(a)) ?? 5);
const verbose = args.includes('--verbose');
const bashBonus = Number(args.find((a) => a.startsWith('--bonus='))?.split('=')[1] ?? 0);

const started = Date.now();
const failures = [];
let walked = 0;
let steps = 0;
const perFloor = new Map();

for (let seed = 1; seed <= seeds; seed += 1) {
  const masterSeed = seed * 7919 + 13;
  for (let floorNumber = 1; floorNumber <= FLOOR_COUNT; floorNumber += 1) {
    const result = walkFloor(masterSeed, floorNumber, { bashBonus });
    walked += 1;
    if (result.ok) {
      steps += result.steps;
      const row = perFloor.get(floorNumber) ?? { steps: [], opened: 0, keys: 0 };
      row.steps.push(result.steps);
      row.opened += result.opened;
      row.keys += result.keys;
      perFloor.set(floorNumber, row);
      if (verbose) {
        console.log(
          `  seed ${masterSeed} floor ${floorNumber}: ${result.steps} steps, ` +
            `${result.opened} opened, ${result.checks} wandering checks`,
        );
      }
    } else {
      failures.push(`seed ${masterSeed} floor ${floorNumber}: ${result.why}`);
      if (verbose) console.log(`  seed ${masterSeed} floor ${floorNumber}: FAILED — ${result.why}`);
    }
  }
}

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

console.log(`\n  walked ${walked} floors (${seeds} seeds x ${FLOOR_COUNT}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  arrived at the arena door: ${walked - failures.length} / ${walked}`);
console.log(`  bash bonus: +${bashBonus}\n`);

console.log('  floor   median steps   doors opened   keys fetched');
for (const floorNumber of [...perFloor.keys()].sort((a, b) => a - b)) {
  const row = perFloor.get(floorNumber);
  console.log(
    `   ${String(floorNumber).padStart(2)}     ${String(median(row.steps)).padStart(9)}` +
      `   ${String(row.opened).padStart(12)}   ${String(row.keys).padStart(12)}`,
  );
}

if (failures.length) {
  console.log(`\n  ${failures.length} could not be walked:`);
  for (const line of failures.slice(0, 20)) console.log(`    - ${line}`);
  process.exitCode = 1;
} else {
  console.log('\n  every floor walked from arrival to the boss arena\n');
}
