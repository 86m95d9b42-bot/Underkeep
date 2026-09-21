/**
 * The balance simulator (`00-build-outline.md`, Phase 7).
 *
 *   npm run sim                         every build x every boss, 20 seeds each
 *   npm run sim -- 50                   fifty seeds each
 *   npm run sim -- --build=assassin     one build
 *   npm run sim -- --floor=6            one boss
 *   npm run sim -- --earn               add the XP and gold of a trip per floor
 *   npm run sim -- --strict             exit 1 if any boss is under the target
 *
 * It flies the four example builds of `01` section 6 at the level `02`
 * section 3 expects for each floor, with the gear that floor's Shop tier
 * sells, through the same `createFight` the Combat screen drives.
 */
import { BOSSES, EXPECTED_LEVEL, TARGET_WIN_RATE, bossTable, earningTable } from './lib/simulator.js';
import { BUILDS, buildHero, buildIds } from './lib/builds.js';
import { xpNeeded } from '../src/systems/levelling.js';

const args = process.argv.slice(2);
const seeds = Number(args.find((a) => /^\d+$/.test(a)) ?? 20);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;
const oneBuild = flag('build');
const oneFloor = flag('floor');
const earn = args.includes('--earn');
const strict = args.includes('--strict');

if (oneBuild && !BUILDS[oneBuild]) {
  console.error(`  unknown build "${oneBuild}"; try one of: ${buildIds().join(', ')}`);
  process.exit(2);
}

const builds = oneBuild ? [oneBuild] : buildIds();
const floors = oneFloor ? [Number(oneFloor)] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const pad = (text, width) => String(text).padEnd(width);
const percent = (rate) => `${Math.round(rate * 100)}%`;

/* Win rate per boss ------------------------------------------------------- */

const started = Date.now();
const rows = bossTable({ builds, floors, seeds });

console.log(`\n  win rate per boss, ${seeds} seeds each (target ${percent(TARGET_WIN_RATE)})\n`);
console.log(`  ${pad('boss', 22)}${pad('fl', 4)}${pad('lv', 4)}${builds.map((b) => pad(BUILDS[b].name, 15)).join('')}`);
for (const floor of floors) {
  const boss = BOSSES[rows.find((row) => row.floor === floor).boss];
  const cells = builds.map((build) => {
    const row = rows.find((r) => r.build === build && r.floor === floor);
    const mark = row.rate < TARGET_WIN_RATE ? ' !' : '';
    return pad(`${percent(row.rate)} ${row.rounds.toFixed(0)}r${mark}`, 15);
  });
  console.log(`  ${pad(boss.name, 22)}${pad(floor, 4)}${pad(EXPECTED_LEVEL[floor], 4)}${cells.join('')}`);
}
console.log('\n  (r = average rounds; ! = under target)');

/* XP per level and gold per trip ------------------------------------------ */

if (earn) {
  // Every other floor is enough to see the curve; a trip costs more than a fight.
  const earnFloors = oneFloor ? floors : [1, 3, 5, 7, 9];
  const earned = earningTable({ builds, floors: earnFloors, seeds: Math.max(3, Math.round(seeds / 4)) });
  console.log('\n  a trip of six rolled encounters, per floor\n');
  console.log(`  ${pad('build', 15)}${pad('fl', 4)}${pad('xp', 8)}${pad('trips/lv', 10)}${pad('gold', 8)}survived`);
  for (const row of earned) {
    // How many such trips the next level costs: the XP gap at the level the
    // floor expects, over what one trip pays (`01` section 5).
    const hero = buildHero(row.build, { floor: row.floor });
    const need = xpNeeded(hero);
    const gap = need === null ? null : need - (hero.xp ?? 0);
    const trips = gap === null || row.xp <= 0 ? '-' : (gap / row.xp).toFixed(1);
    console.log(
      `  ${pad(BUILDS[row.build].name, 15)}${pad(row.floor, 4)}${pad(row.xp.toFixed(0), 8)}${pad(trips, 10)}${pad(row.gold.toFixed(0), 8)}${row.survived}/${row.of}`,
    );
  }
}

/* The verdict ------------------------------------------------------------- */

const under = rows.filter((row) => row.rate < TARGET_WIN_RATE);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (under.length === 0) {
  console.log(`\n  every build beats every boss at least ${percent(TARGET_WIN_RATE)} of the time (${seconds}s)\n`);
} else {
  console.log(`\n  ${under.length} of ${rows.length} pairings are under ${percent(TARGET_WIN_RATE)}:\n`);
  for (const row of under) {
    const did = Object.entries(row.did).filter(([, n]) => n > 0).map(([what, n]) => `${what} ${(n / row.of).toFixed(1)}`).join(', ');
    console.log(`    ${pad(BUILDS[row.build].name, 15)}${pad(BOSSES[row.boss].name, 22)}${pad(`${row.won}/${row.of}`, 7)}${did}`);
  }
  console.log(`\n  (${seconds}s)\n`);
  if (strict) process.exit(1);
}
