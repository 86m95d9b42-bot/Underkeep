/**
 * The Phase 4 "done when": a new level 1 hero can reach level 5 on floors
 * 1 and 2.
 *
 *   npm run climb                    10 heroes, one per origin in turn
 *   npm run climb -- 30              30 heroes
 *   npm run climb -- 10 --ironman    a death ends the climb
 *   npm run climb -- 5 --verbose     a line per hero
 *   npm run climb -- 10 --level=3    climb to another level
 *
 * The climbing itself is `tools/lib/climber.js`, which rolls the hero through
 * character creation, walks the floors through the same run the Exploration
 * screen drives, and fights through the same `createFight` the Combat screen
 * drives. Nothing here decides a rule.
 */
import { climb } from './lib/climber.js';
import { ORIGIN_ORDER } from '../src/data/origins.js';

const args = process.argv.slice(2);
const heroes = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);
const verbose = args.includes('--verbose');
const mode = args.includes('--ironman') ? 'ironman' : 'adventurer';
const target = Number(args.find((a) => a.startsWith('--level='))?.split('=')[1] ?? 5);
const rest = args.includes('--no-rest') ? 'never' : 'trip';

const started = Date.now();
const results = [];

for (let seed = 1; seed <= heroes; seed += 1) {
  const masterSeed = seed * 7919 + 13;
  const origin = ORIGIN_ORDER[(seed - 1) % ORIGIN_ORDER.length];
  const result = climb(masterSeed, { target, mode, rest, origin });
  results.push({ ...result, origin, masterSeed });
  if (verbose) {
    console.log(
      `  ${origin.padEnd(10)} seed ${masterSeed}: level ${result.level} after ` +
        `${result.trips} trip(s), ${result.fights} fight(s), ${result.deaths} death(s) — ${result.why}`,
    );
  }
}

const reached = results.filter((row) => row.ok);
const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const sum = (pick) => results.reduce((total, row) => total + pick(row), 0);

console.log('');
console.log(`  ${mode}, climbing to level ${target} on floors 1-2, resting between trips: ${rest}`);
console.log(`  reached level ${target}   ${reached.length} of ${results.length}`);
console.log(`  trips to get there  ${median(reached.map((row) => row.trips))} (median)`);
console.log(`  fights on the way   ${median(reached.map((row) => row.fights))} (median)`);
console.log(`  deaths              ${sum((row) => row.deaths)} over ${sum((row) => row.fights)} fight(s)`);
console.log(`  gold carried out    ${median(results.map((row) => row.gold))} (median)`);

const byLevel = new Map();
for (const row of results) byLevel.set(row.level, (byLevel.get(row.level) ?? 0) + 1);
console.log(
  `  levels reached      ${[...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => `${count} at ${level}`)
    .join(', ')}`,
);
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s`);

// The phase is met when every Adventurer gets there; an Ironman climb is a
// measurement, not a promise, so it never fails the run.
const ok = mode === 'ironman' || reached.length === results.length;
console.log(ok ? '\n  the phase 4 "done when" holds\n' : '\n  SOME HEROES DID NOT GET THERE\n');
process.exit(ok ? 0 : 1);
