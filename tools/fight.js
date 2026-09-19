/**
 * The Phase 3 "done when": a fight against rats and kobolds runs start to
 * finish with the log matching the rules.
 *
 *   npm run fight                 the named fight, printed, then 200 seeds
 *   npm run fight -- 1000         1000 seeds
 *   npm run fight -- 20 --quiet   no transcript
 *   npm run fight -- 50 --floor=2 the Old Crypt's tables instead
 *   npm run fight -- 200 --hp=22  the hit points a level 1 hero will have
 *
 * The fight itself is `tools/lib/fighter.js`, which drives the same
 * `createFight` the Combat screen drives and audits the log against `06`.
 * `test/fight.test.js` runs a handful of these on every test run.
 */
import { playFight, RATS_AND_KOBOLDS } from './lib/fighter.js';

const args = process.argv.slice(2);
const seeds = Number(args.find((a) => /^\d+$/.test(a)) ?? 200);
const quiet = args.includes('--quiet');
const floor = Number(args.find((a) => a.startsWith('--floor='))?.split('=')[1] ?? 1);
// The run's stand-in has 12 HP; `01` section 4 gives a level 1 hero 10 + VIG.
const hp = Number(args.find((a) => a.startsWith('--hp='))?.split('=')[1] ?? 12);

/* -- the fight the phase names ---------------------------------------- */

const named = playFight({ seed: 20260918, monsters: RATS_AND_KOBOLDS, floor: 1, hp });

if (!quiet) {
  console.log('\n  2 Giant Rats and 2 Kobolds, seed 20260918\n');
  for (const line of named.transcript) console.log(line);
  console.log(
    `\n  ${named.outcome} in ${named.rounds} rounds, ` +
      `${named.attacks} attacks, ${named.summary?.xp ?? 0} XP\n`,
  );
}

/* -- and a sweep, so one lucky seed proves nothing --------------------- */

const started = Date.now();
const failures = [];
const outcomes = new Map();
let rounds = 0;
let attacks = 0;

for (let seed = 1; seed <= seeds; seed += 1) {
  const masterSeed = seed * 7919 + 13;
  // Half the seeds fight the named cast, half roll the floor's own table, so
  // the archer's Volley and the slime's Divide are exercised too.
  const result = playFight({
    seed: masterSeed,
    monsters: seed % 2 === 0 ? RATS_AND_KOBOLDS : undefined,
    floor,
    hp,
  });
  rounds += result.rounds;
  attacks += result.attacks;
  outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);
  if (!result.ok) failures.push({ seed: masterSeed, problems: result.problems });
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`  fought ${seeds} fights on floor ${floor} in ${seconds}s, hero at ${hp} HP`);
console.log(`  average ${(rounds / seeds).toFixed(1)} rounds, ${(attacks / seeds).toFixed(1)} attacks`);
console.log(
  `  outcomes: ${[...outcomes.entries()].map(([name, n]) => `${name} ${n}`).join(', ')}`,
);

if (failures.length) {
  console.log(`\n  ${failures.length} fight(s) did not match the rules:`);
  for (const failure of failures.slice(0, 10)) {
    console.log(`    seed ${failure.seed}:`);
    for (const problem of failure.problems) console.log(`      - ${problem}`);
  }
  process.exitCode = 1;
} else {
  console.log('\n  every fight ran start to finish, and every log line followed the rules\n');
}
