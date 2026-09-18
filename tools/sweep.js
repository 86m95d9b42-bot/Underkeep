/**
 * Generator sweep: build every floor for thousands of seeds and check that all
 * of them hold up (docs/TASKS.md, Phase 2).
 *
 *   npm run sweep                 the full 10,000 seeds x 10 floors
 *   npm run sweep -- --seeds=500  a quicker look
 *   npm run sweep -- --json       machine-readable summary on stdout
 *
 * What it reports:
 *   - every floor builds, and every floor passes the solvability check
 *   - how many needed a rebuild, which 05 section 3 step 10 allows
 *   - the critical path length per floor against the pacing targets in
 *     05 section 2, which floors 1-3 cannot meet (see docs/DECISIONS.md)
 *
 * The work is split across worker threads, because one floor of the deepest
 * kind takes about 27 ms and the full sweep is 100,000 floors.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);

/** One worker's share of the seeds. */
async function runShare({ from, to, floors }) {
  const { buildFloor, distancesFrom } = await import('../src/dungeon/floor-builder.js');
  const { checkSolvable } = await import('../src/dungeon/solvability.js');
  const { layoutStream } = await import('../src/engine/rng.js');

  const result = {
    built: 0,
    buildFailures: [],
    unsolvable: [],
    attempts: {},
    /** @type {Record<number, number[]>} floor -> critical path lengths */
    paths: {},
    reachShare: [],
  };

  for (let seed = from; seed < to; seed += 1) {
    for (let floor = 1; floor <= floors; floor += 1) {
      let built;
      try {
        built = buildFloor(floor, seed, layoutStream);
      } catch (err) {
        result.buildFailures.push({ seed, floor, why: String(err.message).split('\n')[0] });
        continue;
      }
      result.built += 1;
      result.attempts[built.attempt] = (result.attempts[built.attempt] ?? 0) + 1;

      const verdict = checkSolvable(built);
      if (!verdict.ok) result.unsolvable.push({ seed, floor, why: verdict.problems.join('; ') });

      const dist = distancesFrom(built.map, built.start.pos);
      (result.paths[floor] ??= []).push(dist[built.arena.entrance[1]][built.arena.entrance[0]]);
    }
  }
  return result;
}

if (!isMainThread) {
  runShare(workerData).then(
    (result) => parentPort.postMessage({ ok: true, result }),
    (err) => parentPort.postMessage({ ok: false, error: String(err.stack ?? err) }),
  );
} else {
  const arg = (name, fallback) => {
    const found = process.argv.find((a) => a.startsWith(`--${name}=`));
    return found ? Number(found.split('=')[1]) : fallback;
  };
  const seeds = arg('seeds', 10000);
  const floors = arg('floors', 10);
  const workers = arg('workers', Math.max(1, Math.min(cpus().length - 1, 12)));
  const asJson = process.argv.includes('--json');

  const started = Date.now();
  if (!asJson) {
    console.log(`\n  sweeping ${seeds.toLocaleString()} seeds x ${floors} floors on ${workers} workers\n`);
  }

  const per = Math.ceil(seeds / workers);
  const shares = Array.from({ length: workers }, (_, i) => ({
    from: i * per + 1,
    to: Math.min(seeds + 1, (i + 1) * per + 1),
    floors,
  })).filter((share) => share.from < share.to);

  const results = await Promise.all(
    shares.map(
      (share) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(HERE, { workerData: share });
          worker.on('message', (message) =>
            message.ok ? resolve(message.result) : reject(new Error(message.error)),
          );
          worker.on('error', reject);
        }),
    ),
  );

  // Fold the workers' answers together.
  const total = {
    built: 0,
    buildFailures: [],
    unsolvable: [],
    attempts: {},
    paths: {},
  };
  for (const share of results) {
    total.built += share.built;
    total.buildFailures.push(...share.buildFailures);
    total.unsolvable.push(...share.unsolvable);
    for (const [attempt, count] of Object.entries(share.attempts)) {
      total.attempts[attempt] = (total.attempts[attempt] ?? 0) + count;
    }
    for (const [floor, lengths] of Object.entries(share.paths)) {
      (total.paths[floor] ??= []).push(...lengths);
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  /** @param {number[]} values */
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    return { min: sorted[0], p25: pick(0.25), median: pick(0.5), p75: pick(0.75), max: sorted.at(-1) };
  };

  const TARGET = [150, 300]; // 05 section 2, Pacing Targets
  const pacing = Object.entries(total.paths).map(([floor, lengths]) => {
    const inBand = lengths.filter((n) => n >= TARGET[0] && n <= TARGET[1]).length;
    return { floor: Number(floor), ...stats(lengths), inBand: inBand / lengths.length, samples: lengths.length };
  });

  const summary = {
    seeds,
    floors,
    seconds: Number(seconds),
    built: total.built,
    buildFailures: total.buildFailures.length,
    unsolvable: total.unsolvable.length,
    attempts: total.attempts,
    pacing,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`  built ${total.built.toLocaleString()} floors in ${seconds}s\n`);
    console.log(`  build failures : ${total.buildFailures.length}`);
    console.log(`  unsolvable     : ${total.unsolvable.length}`);
    const rebuilt = Object.entries(total.attempts)
      .filter(([attempt]) => Number(attempt) > 0)
      .reduce((sum, [, count]) => sum + count, 0);
    console.log(
      `  needed a rebuild: ${rebuilt.toLocaleString()} (${((rebuilt / total.built) * 100).toFixed(2)}%)  ${JSON.stringify(total.attempts)}\n`,
    );

    console.log('  critical path, arrival to the boss arena (target 150-300 steps)');
    console.log('  floor  grid    min   p25   med   p75   max    in target');
    for (const row of pacing) {
      const grid = row.floor <= 3 ? '33' : row.floor <= 7 ? '41' : '49';
      const flag = row.inBand < 0.5 ? '  <-- misses' : '';
      console.log(
        `   ${String(row.floor).padStart(2)}    ${grid}   ${String(row.min).padStart(4)}  ${String(row.p25).padStart(4)}  ${String(row.median).padStart(4)}  ${String(row.p75).padStart(4)}  ${String(row.max).padStart(4)}    ${(row.inBand * 100).toFixed(0).padStart(3)}%${flag}`,
      );
    }

    for (const failure of [...total.buildFailures, ...total.unsolvable].slice(0, 5)) {
      console.log(`\n  seed ${failure.seed}, floor ${failure.floor}: ${failure.why}`);
    }
    console.log('');
  }

  const clean = total.buildFailures.length === 0 && total.unsolvable.length === 0;
  process.exit(clean ? 0 : 1);
}
