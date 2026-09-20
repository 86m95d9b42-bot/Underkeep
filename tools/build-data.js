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
import { checkCondition } from '../src/engine/ai.js';
import { parsePart } from '../src/engine/damage.js';
import { PENDING, TRAITS } from '../src/engine/monster-traits.js';
import { HANDLERS, PENDING as SKILLS_PENDING } from '../src/engine/skill-hooks.js';
import { EVENTS } from '../src/engine/hooks.js';
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
function checkConditions(json, strings, damageTypes = []) {
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
    // A typed condition has to use a type the damage rules know (`06` §7).
    if (rules.damageType && !damageTypes.includes(rules.damageType)) {
      problems.push(`${where} deals "${rules.damageType}", which is not a damage type`);
    }
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

  const zero = json.zeroHp ?? {};
  if (!(zero.heroRecoveryShare > 0 && zero.heroRecoveryShare < 1)) {
    problems.push('combat.json does not bring the hero back at a share of their HP');
  }
  if (!(zero.fallen?.rounds >= 1 && zero.fallen?.hp >= 1)) {
    problems.push('combat.json has no Fallen countdown');
  }
  if (!zero.fallen?.burnedBy?.length) problems.push('combat.json gives no way to burn a Fallen troll');

  const morale = json.morale ?? {};
  if (!/^\d*d\d+/.test(String(morale.dice))) problems.push('combat.json morale has no dice');
  if (!(morale.fearless >= 2)) problems.push('combat.json has no fearless morale');
  if (!(morale.groupShare > 0 && morale.groupShare < 1)) problems.push('combat.json group share is not a share');
  if (!(morale.hurtBelow > 0 && morale.hurtBelow < 1)) problems.push('combat.json hurt threshold is not a share');
  if (!morale.triggers?.length) problems.push('combat.json lists no morale triggers');

  const fleeing = json.fleeing ?? {};
  if (!(fleeing.tn >= 1)) problems.push('combat.json fleeing has no TN');
  if (!(fleeing.freeAttackers >= 0)) problems.push('combat.json fleeing has no free attackers');
  if (!(fleeing.goldDroppedShare > 0 && fleeing.goldDroppedShare <= 1)) {
    problems.push('combat.json dropped gold is not a share');
  }
  if (!(json.victory?.summonsWorthXp >= 0)) problems.push('combat.json does not cap the XP from summons');

  const damage = json.damage ?? {};
  if (!(damage.types?.length >= 3)) problems.push('combat.json lists no damage types');
  for (const type of damage.physical ?? []) {
    if (!damage.types?.includes(type)) problems.push(`combat.json calls "${type}" physical, but it is not a damage type`);
  }
  if (damage.immune !== 0) problems.push('combat.json lets an immune target take damage');
  if (!(damage.resistant > 0 && damage.resistant < 1)) problems.push('combat.json resistance is not a reduction');
  if (!(damage.weak > 1)) problems.push('combat.json weakness is not an increase');
  if (!(damage.critDice >= 2 && damage.critDiceWithMastery > damage.critDice)) {
    problems.push('combat.json crit dice do not rise with Weapon Mastery');
  }
  if (!(damage.minimum >= 1)) problems.push('combat.json lets a hit deal nothing');

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
 * ai.json: `06` section 11. Every condition in a shipped script is run through
 * the engine's own reader, so a typo in a table transcribed out of section 12
 * fails the build instead of leaving a monster standing still.
 */
function checkAi(json) {
  const settings = json.difficulty?.settings ?? {};
  for (const name of ['easy', 'normal', 'hard']) {
    const setting = settings[name];
    if (!setting) {
      problems.push(`ai.json has no "${name}" difficulty`);
      continue;
    }
    if (!(setting.slip >= 0 && setting.slip <= 1)) problems.push(`ai.json ${name}.slip is not a share`);
  }
  if (!settings[json.difficulty?.default]) problems.push('ai.json default difficulty is not one of its settings');
  if (!(settings.easy?.slip > settings.normal?.slip && settings.normal.slip > settings.hard?.slip)) {
    problems.push('ai.json difficulties do not follow the script in the order 06 section 11 gives');
  }

  for (const [name, archetype] of Object.entries(json.archetypes ?? {})) {
    if (name.startsWith('_')) continue;
    if (!archetype.rules?.length) {
      problems.push(`ai.json archetype "${name}" has no rules`);
      continue;
    }
    for (const rule of archetype.rules) {
      const why = checkCondition(rule.when);
      if (why) problems.push(`ai.json archetype "${name}": ${why}`);
      if (!rule.do) problems.push(`ai.json archetype "${name}" has a rule that does nothing`);
    }
    // 06 section 11: "The last rule is always a fallback."
    const last = archetype.rules.at(-1);
    if (checkCondition(last.when) === null && last.when && !/^(always|true)$/i.test(last.when)) {
      problems.push(`ai.json archetype "${name}" has no fallback rule`);
    }
  }
}

/**
 * monsters.json: `02` sections 4, 5 and 19. A stat block is only useful if the
 * engine can read every part of it, so the damage notation is parsed, the
 * scripts go through the AI reader, and every trait has to be implemented or
 * listed as waiting on another phase.
 */
function checkMonsters(json, ai, combat) {
  const ids = Object.keys(json.monsters ?? {}).filter((id) => !id.startsWith('_'));
  if (ids.length === 0) {
    problems.push('monsters.json has no monsters');
    return;
  }

  const damageTypes = combat?.damage?.types ?? [];
  for (const id of ids) {
    const block = json.monsters[id];
    const where = `monsters.json ${id}`;
    if (!block.name) problems.push(`${where} has no name`);
    for (const stat of ['hd', 'hp', 'atk', 'def', 'init', 'xp']) {
      if (block[stat] === undefined) problems.push(`${where} has no ${stat}`);
    }
    if (!['front', 'back'].includes(block.row)) problems.push(`${where} stands in no row`);
    if (!(block.group?.[0] <= block.group?.[1])) problems.push(`${where} has a backwards group range`);
    if (block.morale !== null && !(block.morale >= 2 && block.morale <= 12)) {
      problems.push(`${where} has a morale of ${block.morale}`);
    }
    if (!ai?.archetypes?.[block.archetype]) problems.push(`${where} follows no archetype`);

    for (const attack of block.attacks ?? []) {
      try {
        const part = parsePart(`${attack.dmg}${attack.dmgType ? ` ${attack.dmgType}` : ''}`);
        if (part.type && !damageTypes.includes(part.type)) {
          problems.push(`${where} deals "${part.type}", which is not a damage type`);
        }
      } catch (error) {
        problems.push(`${where} attack "${attack.name}": ${error.message}`);
      }
      const rider = attack.onHit;
      if (rider && !rider.condition) problems.push(`${where} has a rider with no condition`);
      if (rider?.save && !['body', 'reflex', 'mind'].includes(rider.save)) {
        problems.push(`${where} rider saves against "${rider.save}"`);
      }
    }

    for (const rule of block.script ?? []) {
      const why = checkCondition(rule.when);
      if (why) problems.push(`${where}: ${why}`);
      if (!rule.do) problems.push(`${where} has a script rule that does nothing`);
    }

    for (const entry of block.traits ?? []) {
      const trait = typeof entry === 'string' ? entry : entry.id;
      if (!trait) problems.push(`${where} has a trait with no id`);
      else if (!TRAITS[trait] && !PENDING[trait]) {
        problems.push(`${where} has trait "${trait}", which nothing implements`);
      }
    }

    for (const list of ['resist', 'weak']) {
      for (const type of block[list] ?? []) {
        if (!damageTypes.includes(type)) problems.push(`${where} is ${list} to "${type}", which is not a damage type`);
      }
    }
  }
}

/**
 * encounters.json: `02` section 16. A table with a gap in it would roll an
 * encounter that does not exist, which only shows up in play.
 */
function checkEncounters(json, monsters) {
  const die = json.die ?? 12;
  const special = json.special ?? {};
  if (special.on !== die) problems.push('encounters.json special row is not the top of the die');
  if (!monsters?.monsters?.[special.wanderer]) {
    problems.push(`encounters.json sends a 12 to "${special.wanderer}", which has no stat block`);
  }

  for (const [floor, table] of Object.entries(json.floors ?? {})) {
    const rows = table.table ?? [];
    let previous = 0;
    for (const row of rows) {
      if (!(row.upTo > previous)) problems.push(`encounters.json floor ${floor} is out of order at ${row.upTo}`);
      previous = row.upTo;
      for (const entry of row.monsters ?? []) {
        const block = monsters?.monsters?.[entry.id];
        if (!block) {
          problems.push(`encounters.json floor ${floor} rolls "${entry.id}", which has no stat block`);
          continue;
        }
        if (!(block.floors ?? []).includes(Number(floor))) {
          problems.push(`encounters.json floor ${floor} rolls "${entry.id}", which does not live there`);
        }
        if (!(entry.count?.[0] <= entry.count?.[1])) {
          problems.push(`encounters.json floor ${floor} has a backwards count for "${entry.id}"`);
        }
      }
    }
    // Every roll under the special row has to land somewhere.
    if (previous !== die - 1) {
      problems.push(`encounters.json floor ${floor} covers up to ${previous}, not ${die - 1}`);
    }
  }
}

/**
 * attributes.json: `01` sections 3, 4 and 5. The modifier table is the one
 * table every other rule reads, so a gap or an overlap in it would quietly
 * change every attack in the game.
 */
function checkAttributes(json, strings) {
  const order = json.order ?? [];
  if (order.length !== 6) problems.push(`attributes.json lists ${order.length} attributes, expected 6`);
  const abbrs = new Set();
  for (const id of order) {
    const entry = json.attributes?.[id];
    if (!entry) {
      problems.push(`attributes.json lists "${id}" with no entry`);
      continue;
    }
    if (!entry.abbr) problems.push(`attributes.json ${id} has no abbreviation`);
    if (abbrs.has(entry.abbr)) problems.push(`attributes.json repeats the abbreviation ${entry.abbr}`);
    abbrs.add(entry.abbr);
    // The words a player reads live in strings.json, as a condition's do.
    if (!strings?.attributes?.[id]?.name) problems.push(`attributes.json ${id} has no name in strings.json`);
    if (!strings?.attributes?.[id]?.governs) {
      problems.push(`attributes.json ${id} says nothing about what it governs in strings.json`);
    }
  }
  for (const id of Object.keys(json.attributes ?? {})) {
    if (!id.startsWith('_') && !order.includes(id)) problems.push(`attributes.json has "${id}" outside its order`);
  }

  // The bands have to rise, and cover every score from the minimum to the max.
  const bands = json.modifiers ?? [];
  let previous = (json.min ?? 3) - 1;
  for (const band of bands) {
    if (!(band.upTo > previous)) problems.push(`attributes.json modifier bands are out of order at ${band.upTo}`);
    previous = band.upTo;
  }
  if (previous !== json.max) problems.push(`attributes.json modifiers stop at ${previous}, not ${json.max}`);
  if (!(json.min >= 1 && json.maxAtCreation < json.max)) {
    problems.push('attributes.json has an impossible score range');
  }
  for (let i = 1; i < bands.length; i += 1) {
    if (!(bands[i].mod > bands[i - 1].mod)) problems.push('attributes.json modifiers do not rise with the score');
  }

  for (const mode of Object.values(json.creation?.modes ?? {})) {
    if (!/^\d*d\d+$/.test(String(mode.roll))) problems.push(`attributes.json creation rolls "${mode.roll}"`);
  }
  if (!json.creation?.modes?.[json.creation?.default]) {
    problems.push('attributes.json default creation mode is not one of its modes');
  }

  // Every formula that names an attribute has to name a real one.
  const named = [];
  const walk = (node) => {
    if (typeof node === 'string') named.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('_')) continue;
        if (['mod', 'mods', 'baseScore', 'melee', 'ranged', 'spell'].includes(key)) walk(value);
        else if (key === 'types') walk(Object.values(value));
        else if (typeof value === 'object') walk(value);
      }
    }
  };
  walk(json.derived ?? {});
  for (const name of named) {
    if (!order.includes(name)) problems.push(`attributes.json derived stats name "${name}", which is not an attribute`);
  }

  const leveling = json.leveling ?? {};
  if (!(leveling.cap >= 2)) problems.push('attributes.json has no level cap');
  // The points a hero ends with have to be the points they were promised
  // (`01` section 6, and the example builds it prints).
  const earned =
    (leveling.skillPointsAtLevel1 ?? 0) + (leveling.cap - 1) * (leveling.skillPointsPerLevel ?? 0);
  if (leveling.skillPointsAtCap !== earned) {
    problems.push(
      `attributes.json promises ${leveling.skillPointsAtCap} skill points by the cap and hands out ${earned}`,
    );
  }
  if (!(leveling.xpFactor > 0)) problems.push('attributes.json has no XP factor');
  for (const level of leveling.attributePointLevels ?? []) {
    if (!(level >= 2 && level <= leveling.cap)) problems.push(`attributes.json gives a point at level ${level}`);
  }
  for (const [deed, rate] of Object.entries(leveling.xpSources ?? {})) {
    if (!(rate > 0)) problems.push(`attributes.json pays ${rate} XP for "${deed}"`);
  }
}

/**
 * origins.json: `01` section 3, Origins. Four of them, each naming a real
 * attribute; the kit's items and the free skills are checked against
 * items.json and skills.json once those exist.
 */
function checkOrigins(json, attributes, strings, items, skills) {
  const order = json.order ?? [];
  if (order.length !== 4) problems.push(`origins.json lists ${order.length} origins, expected 4`);

  const bonuses = new Set();
  for (const id of order) {
    const entry = json.origins?.[id];
    const where = `origins.json ${id}`;
    if (!entry) {
      problems.push(`${where} is listed with no entry`);
      continue;
    }
    if (!strings?.origins?.[id]?.name) problems.push(`${where} has no name in strings.json`);
    if (!attributes?.order?.includes(entry.attribute)) {
      problems.push(`${where} raises "${entry.attribute}", which is not an attribute`);
    }
    if (!(entry.bonus >= 1)) problems.push(`${where} grants no attribute bonus`);
    // Each origin points at a different attribute, which is what makes the
    // four a choice rather than a flavour.
    if (bonuses.has(entry.attribute)) problems.push(`${where} raises the same attribute as another origin`);
    bonuses.add(entry.attribute);

    if (!entry.freeSkill?.id) problems.push(`${where} has no free skill`);
    else if (skills && !skills.skills?.[entry.freeSkill.id]) {
      problems.push(`${where} grants "${entry.freeSkill.id}", which has no skill entry`);
    }
    if (!(entry.gold >= 0)) problems.push(`${where} has no starting gold`);
    if (!entry.kit?.length) problems.push(`${where} has no kit`);
    for (const line of entry.kit ?? []) {
      if (!line.item) problems.push(`${where} has a kit line with no item`);
      if (!(line.count >= 1)) problems.push(`${where} carries ${line.count} of "${line.item}"`);
      if (items && !items.items?.[line.item]) {
        problems.push(`${where} carries "${line.item}", which has no item entry`);
      }
    }
  }
  for (const id of Object.keys(json.origins ?? {})) {
    if (!id.startsWith('_') && !order.includes(id)) problems.push(`origins.json has "${id}" outside its order`);
  }
}

/**
 * skills.json: `01` section 6. The tree is 51 skills and 68 points; a skill
 * that names an event the engine does not fire, or a handler nothing
 * implements, would be a passive that quietly does nothing.
 */
function checkSkills(json, strings, attributes) {
  const ids = Object.keys(json.skills ?? {}).filter((id) => !id.startsWith('_'));
  if (ids.length === 0) {
    problems.push('skills.json has no skills');
    return;
  }

  const paths = Object.keys(json.paths ?? {});
  const tiers = (json.tiers ?? []).map((row) => row.tier);
  let points = 0;

  for (const id of ids) {
    const entry = json.skills[id];
    const where = `skills.json ${id}`;
    points += entry.ranks ?? 0;

    if (!paths.includes(entry.path) && entry.path !== 'crossroads') {
      problems.push(`${where} is on the "${entry.path}" path, which does not exist`);
    }
    if (entry.path === 'crossroads') {
      if (entry.paths?.length !== 2) problems.push(`${where} is a Crossroads skill without two paths`);
      for (const path of entry.paths ?? []) {
        if (!paths.includes(path)) problems.push(`${where} joins "${path}", which is not a path`);
      }
    } else if (!tiers.includes(entry.tier)) {
      problems.push(`${where} is tier ${entry.tier}, which is not a tier`);
    }
    if (!json.types?.includes(entry.type)) problems.push(`${where} is a "${entry.type}"`);
    if (!(entry.ranks >= 1)) problems.push(`${where} has ${entry.ranks} ranks`);
    if (entry.type === 'active' && entry.fp === undefined) problems.push(`${where} is active but costs nothing`);
    if (entry.type === 'active' && !entry.action) problems.push(`${where} is active but does nothing`);

    // A capstone asks for an attribute, and it has to be a real one.
    if (entry.requires?.attribute && !attributes?.order?.includes(entry.requires.attribute)) {
      problems.push(`${where} requires "${entry.requires.attribute}", which is not an attribute`);
    }
    if (entry.tier === 4 && !entry.requires?.attribute) {
      problems.push(`${where} is a capstone with no attribute requirement (01 section 6)`);
    }

    for (const effect of entry.effects ?? []) {
      const kinds = ['sheet', 'hook', 'explore'].filter((kind) => effect[kind]);
      if (kinds.length !== 1) problems.push(`${where} has an effect that is neither a sheet, a hook nor an explore bonus`);
      if (effect.hook) {
        if (!EVENTS.includes(effect.hook)) {
          problems.push(`${where} hangs on "${effect.hook}", which is not an event 06 section 16 fires`);
        }
        if (!effect.handler) problems.push(`${where} hangs on an event with no handler`);
        else if (!HANDLERS[effect.handler] && !SKILLS_PENDING[effect.handler]) {
          problems.push(`${where} names handler "${effect.handler}", which nothing implements`);
        }
      }
      if (effect.fromRank && !(effect.fromRank <= entry.ranks)) {
        problems.push(`${where} has an effect from rank ${effect.fromRank}, past its ${entry.ranks}`);
      }
    }

    // And the words a player reads (CLAUDE.md, and the conditions ruling).
    if (!strings?.skills?.[id]?.name) problems.push(`${where} has no name in strings.json`);
    if (!strings?.skills?.[id]?.effect) problems.push(`${where} has no effect line in strings.json`);
  }

  // 01 section 6: "about 68 available" against a hero's 21 by level 20.
  if (points !== 68) problems.push(`skills.json holds ${points} skill points, and 01 section 6 counts 68`);

  const gates = json.tiers ?? [];
  for (let i = 1; i < gates.length; i += 1) {
    if (!(gates[i].spent > gates[i - 1].spent)) problems.push('skills.json tier gates do not rise');
  }
  if (!(json.crossroads?.pointsInEachPath >= 1)) problems.push('skills.json Crossroads asks for no points');
}

/**
 * starting-kit.json: the fighting numbers of the items `01` section 3 hands
 * out, from `04` sections 2 and 3. Every equipped kit item needs a line, and
 * an armour needs a DEF — the moment `items.json` arrives this file goes, and
 * this check is what makes that a clean swap.
 */
function checkStartingKit(json, origins, damageTypes) {
  const wanted = { weapon: new Set(), armor: new Set() };
  for (const entry of Object.values(origins?.origins ?? {})) {
    for (const line of entry.kit ?? []) {
      if (line.equip === 'weapon') wanted.weapon.add(line.item);
      if (line.equip === 'armor') wanted.armor.add(line.item);
    }
  }

  for (const item of wanted.weapon) {
    const weapon = json.weapons?.[item];
    if (!weapon) {
      problems.push(`starting-kit.json has no weapon line for "${item}", which a kit equips`);
      continue;
    }
    if (!/^\d+d\d+/.test(weapon.damage ?? '')) {
      problems.push(`starting-kit.json ${item} has no damage dice`);
    }
    const type = String(weapon.damage ?? '').split(/\s+/)[1];
    if (damageTypes.length && !damageTypes.includes(type)) {
      problems.push(`starting-kit.json ${item} deals "${type}", which is not a damage type`);
    }
  }
  for (const item of wanted.armor) {
    const armor = json.armor?.[item];
    if (!armor) problems.push(`starting-kit.json has no armour line for "${item}", which a kit equips`);
    else if (!(armor.def >= 0)) problems.push(`starting-kit.json ${item} has no DEF`);
  }
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
  'ai.json': checkAi,
  'attributes.json': (json) => checkAttributes(json, loaded['strings.json']),
  'skills.json': (json) => checkSkills(json, loaded['strings.json'], loaded['attributes.json']),
  // items.json and skills.json arrive in Phases 5 and 4; until then the kit
  // and the free skills are checked for shape alone.
  'origins.json': (json) =>
    checkOrigins(
      json,
      loaded['attributes.json'],
      loaded['strings.json'],
      loaded['items.json'],
      loaded['skills.json'],
    ),
  'starting-kit.json': (json) =>
    checkStartingKit(json, loaded['origins.json'], loaded['combat.json']?.damage?.types ?? []),
  'monsters.json': (json) => checkMonsters(json, loaded['ai.json'], loaded['combat.json']),
  'encounters.json': (json) => checkEncounters(json, loaded['monsters.json']),
  'floors.json': checkFloors,
  'locks.json': checkLocks,
  // Checked against strings.json, so it is read first.
  'conditions.json': (json) =>
    checkConditions(json, loaded['strings.json'], loaded['combat.json']?.damage?.types ?? []),
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
