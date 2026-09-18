/**
 * Data check. Every number in the rule documents becomes JSON in src/data/, and
 * a broken reference must stop the build instead of failing mid-game
 * (00-build-outline.md, "Data pipeline").
 *
 * Phase 1 has only strings.json, so the checks here are the shape checks that
 * apply to every file. Each later phase adds its own table and the rules that
 * go with it, in the `CHECKS` list below.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

/** @type {string[]} */
const problems = [];

/** Every leaf of strings.json must be a non-empty string. */
function checkStrings(json, path = 'strings') {
  for (const [key, value] of Object.entries(json)) {
    const here = `${path}.${key}`;
    if (typeof value === 'string') {
      if (value.trim() === '') problems.push(`${here} is empty`);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      checkStrings(value, here);
    } else {
      problems.push(`${here} is neither a string nor a group of strings`);
    }
  }
}

/**
 * floors.json: the ten floors of `05` section 2, and the counts of section 3.
 * A missing hazard rule or an out-of-order room range would only show up as a
 * broken floor mid-game, so it is caught here instead.
 */
function checkFloors(json) {
  const rows = json.floors;
  if (!Array.isArray(rows) || rows.length !== 10) {
    problems.push(`floors.json has ${rows?.length ?? 0} floors, expected 10`);
    return;
  }

  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    const where = `floors.json floor ${row.floor ?? index + 1}`;
    if (row.floor !== index + 1) problems.push(`${where} is out of order`);
    if (!row.id || ids.has(row.id)) problems.push(`${where} has a missing or repeated id`);
    ids.add(row.id);
    if (!(row.grid % 2)) problems.push(`${where} has an even grid (${row.grid}); maze carving needs odd`);
    if (!(row.rooms?.[0] <= row.rooms?.[1])) problems.push(`${where} has a backwards room range`);

    // Every hazard a floor may use needs a placement rule, or the builder
    // would place it with no constraints at all.
    for (const hazard of row.hazards ?? []) {
      if (!json.hazardRules?.[hazard]) problems.push(`${where} allows "${hazard}" with no rule in hazardRules`);
    }
    if (!row.features?.length) problems.push(`${where} has no theme feature`);
  }

  for (const [kind, rule] of Object.entries(json.specialDoors ?? {})) {
    if (kind.startsWith('_') || typeof rule !== 'object') continue;
    if (!(rule.minFloor >= 1 && rule.minFloor <= 10)) problems.push(`floors.json ${kind} has an impossible minFloor`);
    if (!(rule.count?.[0] <= rule.count?.[1])) problems.push(`floors.json ${kind} has a backwards count range`);
  }
}

/**
 * file name -> checker. A file with no checker is only parsed, which still
 * catches the most common failure: a trailing comma in hand-edited JSON.
 * @type {Record<string, (json: any) => void>}
 */
const CHECKS = {
  'strings.json': checkStrings,
  'floors.json': checkFloors,
};

const files = (await readdir(DATA)).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) problems.push('src/data/ has no JSON files');

for (const file of files) {
  let json;
  try {
    json = JSON.parse(await readFile(join(DATA, file), 'utf8'));
  } catch (err) {
    problems.push(`${file} is not valid JSON: ${err.message}`);
    continue;
  }
  CHECKS[file]?.(json);
  console.log(`  ${file}  ok`);
}

if (problems.length > 0) {
  console.error('\ndata check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`  ${files.length} data file${files.length === 1 ? '' : 's'} checked`);
