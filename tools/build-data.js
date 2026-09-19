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

  if (!(json.hazardCount?.base >= 0)) problems.push('floors.json has no hazardCount');
  if (!json.curiosities?.kinds?.length) problems.push('floors.json lists no kinds of curiosity');
  // A hazard that covers ground needs to know how much, or it takes the floor.
  for (const [kind, rule] of Object.entries(json.hazardRules ?? {})) {
    if (kind.startsWith('_')) continue;
    if (rule.maxFloorTileShare && !rule.blobTiles) {
      problems.push(`floors.json ${kind} has a share cap but no blobTiles size`);
    }
  }

  // The step clock: a check that never comes round, or a warning that fires
  // after the Stalker has already arrived, would only show up in play.
  const clock = json.stepClock;
  if (!(clock?.checkEvery >= 1) || !(clock?.die >= 2) || !(clock?.encounterUpTo >= 1)) {
    problems.push('floors.json stepClock is missing its d6-every-ten-steps rule');
  } else {
    if (clock.encounterUpTo >= clock.die) problems.push('floors.json stepClock makes every check an encounter');
    for (const [action, cost] of Object.entries(clock.actionSteps ?? {})) {
      if (!(Number.isInteger(cost) && cost >= 1)) problems.push(`floors.json stepClock action "${action}" costs ${cost}`);
    }
    if (!clock.safeRoles?.length) problems.push('floors.json stepClock names no safe room roles');
    const warnings = clock.hollowStalker?.warnAtSteps ?? [];
    for (const at of warnings) {
      if (!(at > 0 && at < json.pacing?.hollowStalkerSteps)) {
        problems.push(`floors.json stepClock warns at ${at}, which is not before the Stalker arrives`);
      }
    }
    if (warnings.some((at, i) => i > 0 && at <= warnings[i - 1])) {
      problems.push('floors.json stepClock warnings are out of order');
    }
  }

  for (const [kind, rule] of Object.entries(json.specialDoors ?? {})) {
    if (kind.startsWith('_') || typeof rule !== 'object') continue;
    if (!(rule.minFloor >= 1 && rule.minFloor <= 10)) problems.push(`floors.json ${kind} has an impossible minFloor`);
    if (!(rule.count?.[0] <= rule.count?.[1])) problems.push(`floors.json ${kind} has a backwards count range`);
  }
}

/**
 * locks.json: the tier table and door kinds of `03` section 6. A door kind the
 * floor builder can produce but that has no entry here would leave the game
 * with no way to describe it.
 */
function checkLocks(json) {
  const order = json.lockTierRoll?.order ?? [];
  for (const band of json.lockTierRoll?.bands ?? []) {
    if (!order.includes(band.lock)) problems.push(`locks.json band "${band.lock}" is not in the order list`);
    if (!json.tiers?.[band.tier]) problems.push(`locks.json band "${band.lock}" names tier "${band.tier}", which has no entry`);
  }
  const bands = json.lockTierRoll?.bands ?? [];
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i].upTo <= bands[i - 1].upTo) problems.push('locks.json lock bands are out of order');
  }
  for (const [name, kind] of Object.entries(json.doorKinds ?? {})) {
    if (name.startsWith('_')) continue;
    if (!kind.opensWith?.length) problems.push(`locks.json door kind "${name}" has no way to open it`);
  }
  const [min, max] = json.secretDoors?.perFloor ?? [];
  if (!(min >= 1 && min <= max)) problems.push('locks.json secretDoors.perFloor is not a sane range');
}

/**
 * conditions.json: `01` section 7's table and `06` section 10. A condition the
 * engine can apply but that the player has no words for, or an order naming a
 * condition that does not exist, would only show up mid-fight.
 */
function checkConditions(json, strings) {
  const ids = Object.keys(json.conditions ?? {});
  if (ids.length === 0) {
    problems.push('conditions.json has no conditions');
    return;
  }

  for (const id of ids) {
    const rules = json.conditions[id];
    const where = `conditions.json ${id}`;
    if (rules.save && !['body', 'reflex', 'mind'].includes(rules.save)) {
      problems.push(`${where} saves against "${rules.save}", which is not a save type`);
    }
    if (rules.rounds !== undefined && !(rules.rounds >= 1)) {
      problems.push(`${where} lasts ${rules.rounds} rounds`);
    }
    // Every condition has to end somehow, or it would last for ever.
    const ends =
      rules.rounds ||
      rules.save ||
      rules.endsOnHealing ||
      rules.endsOnDamage ||
      rules.endsOnHittingSource ||
      rules.endsAtRoundEnd ||
      rules.endsOnAction ||
      rules.endsAfterOwnAttack ||
      rules.persists ||
      rules.freedByFire ||
      rules.breakFree;
    if (!ends) problems.push(`${where} has no way to end`);
    // And a name to show for it (CLAUDE.md: player-facing text lives in strings).
    if (!strings?.conditions?.[id]?.name) problems.push(`${where} has no name in strings.json`);
  }

  for (const list of ['controlConditions', 'startOfTurnDamageOrder', 'endOfTurnSaveOrder']) {
    for (const id of json[list] ?? []) {
      if (!ids.includes(id)) problems.push(`conditions.json ${list} names "${id}", which has no entry`);
    }
  }
  for (const id of json.startOfTurnDamageOrder ?? []) {
    if (!json.conditions[id]?.damagePerTurn) {
      problems.push(`conditions.json ${id} is in the damage order but deals none`);
    }
  }
  for (const id of json.endOfTurnSaveOrder ?? []) {
    if (!json.conditions[id]?.save) {
      problems.push(`conditions.json ${id} is in the save order but has no save`);
    }
  }
  if (!(json.controlImmunityTurns >= 1)) problems.push('conditions.json has no control immunity window');
  if (!(json.gritLostTurns >= 1)) problems.push('conditions.json has no Grit threshold');
}

/**
 * combat.json: `06` sections 2 and 3. The two ordered hook lists are the round
 * itself, and `src/engine/hooks.js` reads them straight out of this file, so a
 * name that is not a hook anywhere would silently reorder a round.
 */
function checkCombat(json, strings) {
  const field = json.field ?? {};
  if (!(field.rows?.length === 2)) problems.push('combat.json does not have two rows');
  if (!(field.rowCapacity >= 1)) problems.push('combat.json has no row capacity');
  if (!(field.crowdCap >= field.rowCapacity)) {
    problems.push(`combat.json crowd cap (${field.crowdCap}) is below one row's capacity`);
  }

  const surprise = json.surprise ?? {};
  if (!(surprise.die >= 2)) problems.push('combat.json surprise has no die');
  for (const key of ['heroSurprisesUpTo', 'monstersSurpriseUpTo']) {
    if (!(surprise[key] >= 1 && surprise[key] < surprise.die)) {
      problems.push(`combat.json surprise.${key} is ${surprise[key]}, which is not a band on the die`);
    }
  }
  if (surprise.surpriseRound !== 0) problems.push('combat.json surprise round is not round 0');

  const initiative = json.initiative ?? {};
  if (!(initiative.die >= 2)) problems.push('combat.json initiative has no die');
  if (initiative.bands?.join() !== 'first,normal,last') {
    problems.push('combat.json initiative bands are not first, normal, last');
  }

  const attack = json.attack ?? {};
  if (!(attack.die >= 2)) problems.push('combat.json attack has no die');
  if (!(attack.critFrom >= 2 && attack.critFrom <= attack.die)) {
    problems.push(`combat.json crit range starts at ${attack.critFrom}, which is not on the die`);
  }
  if (attack.naturalMiss !== 1) problems.push('combat.json does not miss on a natural 1');
  for (const key of ['halfCover', 'requirementNotMet']) {
    if (!(attack[key] < 0)) problems.push(`combat.json attack.${key} is not a penalty`);
  }
  if (!(attack.maxRerolls >= 1)) problems.push('combat.json allows no reroll, so Lucky could not work');

  const turn = json.turn ?? {};
  if (!(turn.freeActionsPerTurn >= 1)) problems.push('combat.json allows no free action');
  if (!(turn.defend?.def >= 1)) problems.push('combat.json Defend gives no DEF');
  if (!(turn.hiddenTurns >= 1)) problems.push('combat.json Hidden lasts no turns');
  if (!(turn.recharge?.readyFrom >= 2 && turn.recharge.readyFrom <= turn.recharge.die)) {
    problems.push('combat.json recharge band is not on the die');
  }

  // Every action the engine offers needs tags, or nothing could block it; and
  // every reason a button is dimmed for needs a line to show (CLAUDE.md: a
  // disabled button always says why).
  for (const [id, action] of Object.entries(json.actions ?? {})) {
    if (id.startsWith('_')) continue;
    if (!action.tags?.length) problems.push(`combat.json action "${id}" has no tags`);
  }
  for (const reason of json.legality?.reasons ?? []) {
    if (!strings?.combat?.illegal?.[reason]) {
      problems.push(`combat.json dims a button for "${reason}", which has no line in strings.json`);
    }
  }

  for (const list of ['turnStartOrder', 'roundStartOrder', 'roundEndOrder']) {
    const hooks = json[list]?.hooks ?? [];
    if (hooks.length === 0) problems.push(`combat.json ${list} lists no hooks`);
    if (new Set(hooks).size !== hooks.length) problems.push(`combat.json ${list} repeats a hook`);
  }
  if (!json.reactionFlags?.flags?.length) problems.push('combat.json lists no reaction flags');
}

/**
 * file name -> checker. A file with no checker is only parsed, which still
 * catches the most common failure: a trailing comma in hand-edited JSON.
 * @type {Record<string, (json: any) => void>}
 */
const CHECKS = {
  'strings.json': checkStrings,
  // Checked against strings.json, so it is read first.
  'combat.json': (json) => checkCombat(json, loaded['strings.json']),
  'floors.json': checkFloors,
  'locks.json': checkLocks,
  // Checked against strings.json, so it is read first.
  'conditions.json': (json) => checkConditions(json, loaded['strings.json']),
};

/** Every file's parsed contents, for checks that compare two files. */
const loaded = {};

const files = (await readdir(DATA)).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) problems.push('src/data/ has no JSON files');

// Everything is parsed first, so a check can compare two files — conditions
// against the strings that name them, for instance.
for (const file of files) {
  try {
    loaded[file] = JSON.parse(await readFile(join(DATA, file), 'utf8'));
  } catch (err) {
    problems.push(`${file} is not valid JSON: ${err.message}`);
  }
}

for (const file of files) {
  if (!(file in loaded)) continue;
  CHECKS[file]?.(loaded[file]);
  console.log(`  ${file}  ok`);
}

if (problems.length > 0) {
  console.error('\ndata check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`  ${files.length} data file${files.length === 1 ? '' : 's'} checked`);
