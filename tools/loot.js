/**
 * The Phase 5 "done when": unknown potions, scrolls and cursed gear behave
 * exactly as `04` describes.
 *
 *   npm run loot                  20 games' worth of loot
 *   npm run loot -- 100           100 games
 *   npm run loot -- 5 --verbose   a line per game
 *   npm run loot -- 20 --rolls=80 more table rolls per floor
 *
 * The finding, carrying and using is `tools/lib/looter.js`, which drives the
 * same loot tables, pack and identification rules the screens drive and
 * audits every step against `04`. `test/loot-run.test.js` runs a handful of
 * these on every test run.
 */
import { playLoot } from './lib/looter.js';
import { ORIGIN_ORDER } from '../src/data/origins.js';

const args = process.argv.slice(2);
const games = Number(args.find((a) => /^\d+$/.test(a)) ?? 20);
const verbose = args.includes('--verbose');
const rolls = Number(args.find((a) => a.startsWith('--rolls='))?.split('=')[1] ?? 40);

const started = Date.now();
const failures = [];
const totals = {};

for (let seed = 1; seed <= games; seed += 1) {
  const masterSeed = seed * 7919 + 13;
  const origin = ORIGIN_ORDER[(seed - 1) % ORIGIN_ORDER.length];
  const result = playLoot(masterSeed, { rolls, origin });
  for (const [key, value] of Object.entries(result.counts)) {
    totals[key] = (totals[key] ?? 0) + value;
  }
  if (!result.ok) failures.push({ masterSeed, origin, problems: result.problems });
  if (verbose) {
    console.log(
      `  ${origin.padEnd(10)} seed ${masterSeed}: ${result.counts.drops} drops, ` +
        `${result.counts.cursed} cursed, ${result.counts.drunk} drunk, ${result.counts.read} read` +
        (result.ok ? '' : `  — ${result.problems.length} problem(s)`),
    );
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const rate = totals.curseChances ? (totals.cursed / totals.curseChances) * 100 : 0;

console.log(`\n  ${games} game(s) of loot, floors 1-10\n`);
console.log(`  drops rolled       ${totals.drops}`);
console.log(`  magic items        ${totals.magic}`);
console.log(`  cursed             ${totals.cursed}  (${rate.toFixed(1)}% of magic gear)`);
console.log(`  potions drunk      ${totals.drunk}`);
console.log(`  scrolls read       ${totals.read}`);
console.log(`  gear worn          ${totals.worn}`);
console.log(`  curses bound       ${totals.bound}`);
console.log(`  curses lifted      ${totals.freed} by scroll, ${totals.burned} at the Temple`);
console.log(`  ${seconds}s\n`);

if (failures.length > 0) {
  console.error(`  ${failures.length} game(s) did not follow 04:`);
  for (const failure of failures.slice(0, 10)) {
    console.error(`    - seed ${failure.masterSeed} (${failure.origin}):`);
    for (const problem of failure.problems.slice(0, 6)) console.error(`        ${problem}`);
  }
  process.exit(1);
}
console.log('  every potion, scroll and cursed item behaved as 04 describes\n');
