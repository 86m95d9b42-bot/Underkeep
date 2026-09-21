/**
 * The Phase 6 "done when": the full loop works — descend, fight, return,
 * shop, descend again.
 *
 *   npm run loop                 20 games of 4 trips each
 *   npm run loop -- 100          100 games
 *   npm run loop -- 10 --trips=8 longer games
 *   npm run loop -- 5 --verbose  a line per game
 *
 * The loop itself is `tools/lib/looper.js`, which drives the same
 * `createSession` the screens drive: the same gate, the same floors, the same
 * fights, the same shop. It audits every step against `04` and `05`.
 * `test/loop.test.js` runs a handful on every test run.
 */
import { playLoop } from './lib/looper.js';
import { ORIGIN_ORDER } from '../src/data/origins.js';

const args = process.argv.slice(2);
const games = Number(args.find((a) => /^\d+$/.test(a)) ?? 20);
const verbose = args.includes('--verbose');
const trips = Number(args.find((a) => a.startsWith('--trips='))?.split('=')[1] ?? 4);

const started = Date.now();
const failures = [];
const totals = {};
let finished = 0;
let deaths = 0;

for (let seed = 1; seed <= games; seed += 1) {
  const masterSeed = seed * 7919 + 13;
  const origin = ORIGIN_ORDER[(seed - 1) % ORIGIN_ORDER.length];
  const result = playLoop(masterSeed, { trips, origin });

  for (const [key, value] of Object.entries(result.counts)) {
    totals[key] = (totals[key] ?? 0) + value;
  }
  if (result.died) deaths += 1;
  if (result.trips >= trips) finished += 1;
  if (!result.ok) failures.push({ masterSeed, origin, problems: result.problems });

  if (verbose) {
    console.log(
      `  ${origin.padEnd(10)} seed ${masterSeed}: ${result.trips} trip(s), ` +
        `${result.counts.fights} fight(s), ${result.counts.bought} bought` +
        (result.died ? ' — died' : '') +
        (result.ok ? '' : `  — ${result.problems.length} problem(s)`),
    );
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n  ${games} game(s), up to ${trips} trips each\n`);
console.log(`  full loops run      ${finished} of ${games}`);
console.log(`  trips taken         ${totals.trips}`);
console.log(`  fights              ${totals.fights}  (${totals.won} won, ${totals.fled} fled)`);
console.log(`  drops carried out   ${totals.drops}`);
console.log(`  nights at the Inn   ${totals.rests}`);
console.log(`  bought / sold       ${totals.bought} / ${totals.sold}`);
console.log(`  waystones home      ${totals.byStone}`);
console.log(`  heroes lost         ${deaths}`);
console.log(`  graves left         ${totals.graves}`);
console.log(`  ${seconds}s\n`);

if (failures.length > 0) {
  console.error(`  ${failures.length} game(s) broke the loop:`);
  for (const failure of failures.slice(0, 8)) {
    console.error(`    - seed ${failure.masterSeed} (${failure.origin}):`);
    for (const problem of failure.problems.slice(0, 5)) console.error(`        ${problem}`);
  }
  process.exit(1);
}
if (finished === 0) {
  console.error('  no game finished its trips: the loop was never closed\n');
  process.exit(1);
}
console.log('  descend, fight, return, shop, descend again: the loop holds\n');
