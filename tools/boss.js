/**
 * Every boss, played to the end and checked (`02` sections 4 to 13).
 *
 *   npm run boss                  all ten, over three seeds each
 *   npm run boss -- 8             eight seeds each
 *   npm run boss -- --show=hydra  print one fight's transcript
 *
 * Each fight is audited twice: once against `06` by the same observer
 * `npm run fight` uses, and once against the boss's own document — did the
 * eggs hatch, did the head grow back, did she ascend, did he beg.
 */
import { MUST_SHOW, playBoss, playEveryBoss } from './lib/bosser.js';
import { BOSSES } from '../src/data/bosses.js';

const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 3);
const show = args.find((a) => a.startsWith('--show='))?.split('=')[1] ?? null;
const seeds = Array.from({ length: count }, (_, i) => 11 + i * 4231);

if (show) {
  const played = playBoss(show, { seed: seeds[0] });
  console.log(`\n  ${BOSSES[show].name}, floor ${BOSSES[show].floor}, seed ${seeds[0]}\n`);
  for (const line of played.transcript) console.log(line);
  console.log(`\n  ${played.outcome} · ${played.summary?.xp ?? 0} XP · ${(played.summary?.loot ?? []).map((drop) => drop.baseId).join(', ') || 'no loot'}\n`);
}

const rows = playEveryBoss({ seeds });
const pad = (text, width) => String(text).padEnd(width);

console.log(`\n  ten bosses x ${seeds.length} seeds\n`);
console.log(`  ${pad('boss', 22)}${pad('floor', 7)}${pad('won', 6)}what the fight showed`);
for (const row of rows) {
  console.log(
    `  ${pad(BOSSES[row.id].name, 22)}${pad(BOSSES[row.id].floor, 7)}${pad(`${row.wins}/${row.of}`, 6)}${row.saw.join(', ') || '-'}`,
  );
}

const broken = rows.filter((row) => row.problems.length > 0 || row.missing.length > 0);
if (broken.length > 0) {
  console.log('\n  what is wrong:\n');
  for (const row of broken) {
    console.log(`    ${BOSSES[row.id].name}`);
    for (const line of row.problems) console.log(`      - ${line}`);
    for (const what of row.missing) console.log(`      - never showed ${what}`);
  }
  console.log('');
  process.exit(1);
}

const mechanics = rows.reduce((total, row) => total + row.saw.length, 0);
console.log(
  `\n  every boss fought to the end, every log line followed the rules,` +
    `\n  and ${mechanics} boss mechanics fired across ${rows.length * seeds.length} fights\n`,
);
