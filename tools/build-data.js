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
import { BOSS_TRAITS } from '../src/engine/boss-traits.js';
import { HANDLERS, PENDING as SKILLS_PENDING } from '../src/engine/skill-hooks.js';
import { HANDLERS as ITEM_HANDLERS, PENDING as ITEMS_PENDING } from '../src/engine/item-hooks.js';
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

  // 05 section 8: what comes back when the hero returns from town.
  const restock = json.restock;
  if (!restock) problems.push('floors.json has no restock table (05 section 8)');
  else {
    const [low, high] = restock.lairs?.refill ?? [];
    if (!(low >= 1 && low <= high)) problems.push('floors.json restock lairs is not a sane range');
    if (!(restock.chests?.perReturn >= 1)) problems.push('floors.json restocks no chests');
    if (!(restock.chests?.maxRestocked >= restock.chests?.perReturn)) {
      problems.push('floors.json restocks more chests a return than it allows at once');
    }
    if (!/^\d+d\d+$/.test(restock.traps?.rearm ?? '')) {
      problems.push('floors.json restock traps does not name a die');
    }
    for (const name of ['bosses', 'uniques', 'secretDoors', 'keys']) {
      if (!restock.never?.includes(name)) problems.push(`floors.json restock should never refill ${name}`);
    }
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

  // `03` section 7: the chest chances are shares, and the Mimic bands must
  // cover every floor down to the tenth.
  const chests = json.chests ?? {};
  for (const name of ['trapped', 'locked']) {
    const rule = chests[name] ?? {};
    const deepest = rule.base + rule.perFloor * 10;
    if (!(rule.base >= 0 && rule.base <= 1 && rule.max <= 1 && rule.max >= rule.base)) {
      problems.push(`locks.json chests.${name} is not a share between 0 and 1`);
    }
    if (!(deepest >= rule.max)) {
      problems.push(`locks.json chests.${name} never reaches its own maximum`);
    }
  }
  const bandEnds = (chests.mimic?.bands ?? []).map((band) => band.upToFloor);
  if (bandEnds.at(-1) !== 10) problems.push('locks.json chests.mimic.bands stop before floor 10');
  if (!chests.gold?.dice) problems.push('locks.json chests.gold has no dice');
  for (const [name, tier] of Object.entries(json.tiers ?? {})) {
    if (name.startsWith('_')) continue;
    if (typeof tier.chestLootBonus !== 'number') {
      problems.push(`locks.json tier "${name}" has no chestLootBonus`);
    }
  }
}

/**
 * hazards.json: `03` section 8 and `05` section 6. Every hazard a floor is
 * allowed and every theme feature it lists has to exist here, and everything
 * a hazard or a feature names — a condition, an item, a trap, a loot pool, a
 * monster — has to exist where it lives.
 */
function checkHazards(json, floors, items, conditions, traps, loot, monsters) {
  const hazards = Object.keys(json.hazards ?? {}).filter((id) => !id.startsWith('_'));
  const features = Object.entries(json.features ?? {}).filter(([id]) => !id.startsWith('_'));
  const featureIds = features.map(([id]) => id);
  if (hazards.length !== 7) problems.push(`hazards.json has ${hazards.length} hazards; 03 section 8 lists 7`);

  // Every floor's own lists resolve.
  for (const row of floors?.floors ?? []) {
    for (const id of row.hazards ?? []) {
      if (!hazards.includes(id)) problems.push(`floor ${row.floor} allows hazard "${id}", which hazards.json has no entry for`);
      else if (row.floor < json.hazards[id].minFloor) {
        problems.push(`floor ${row.floor} allows "${id}", which 03 section 8 starts on floor ${json.hazards[id].minFloor}`);
      }
    }
    for (const id of row.features ?? []) {
      if (!featureIds.includes(id)) problems.push(`floor ${row.floor} names feature "${id}", which hazards.json has no entry for`);
      else if (json.features[id].floor !== row.floor) {
        problems.push(`feature "${id}" is listed on floor ${row.floor} but 05 section 6 puts it on floor ${json.features[id].floor}`);
      }
    }
  }

  // A hazard the hero can never meet is a table nobody reads.
  const allowed = new Set((floors?.floors ?? []).flatMap((row) => [...(row.hazards ?? []), ...(row.features ?? [])]));
  for (const id of hazards) {
    const named = allowed.has(id) || features.some(([, one]) => one.hazard === id);
    if (!named) problems.push(`hazards.json "${id}" is never allowed on any floor`);
  }
  for (const id of featureIds) {
    if (!allowed.has(id)) problems.push(`hazards.json feature "${id}" is on no floor's list`);
  }

  const itemIds = Object.keys(items?.items ?? {});
  const poolNames = Object.keys(loot?.pools ?? {});
  /** Everything a feature may point at, checked where it lives. */
  for (const [id, one] of features) {
    for (const baseId of one.search?.oneOf ?? []) {
      if (!itemIds.includes(baseId)) problems.push(`feature "${id}" gives "${baseId}", which items.json has no entry for`);
    }
    if (one.search?.pool && !poolNames.includes(one.search.pool)) {
      problems.push(`feature "${id}" draws from pool "${one.search.pool}", which loot.json has no entry for`);
    }
    if (one.trap && !traps?.traps?.[one.trap]) {
      problems.push(`feature "${id}" is trap "${one.trap}", which traps.json has no entry for`);
    }
    if (one.hazard && !hazards.includes(one.hazard)) {
      problems.push(`feature "${id}" lays hazard "${one.hazard}", which hazards.json has no entry for`);
    }
    if (one.curiosity && !json.curiosities?.[one.curiosity]) {
      problems.push(`feature "${id}" works as "${one.curiosity}", which hazards.json has no curiosity for`);
    }
    for (const band of one.open?.bands ?? []) {
      for (const monster of band.fight ?? []) {
        if (!monsters?.monsters?.[monster]) problems.push(`feature "${id}" wakes "${monster}", which monsters.json has no entry for`);
      }
    }
  }

  // The fountain is a d6 with one row per face (`03` section 8).
  const rolls = (json.curiosities?.fountain?.results ?? []).map((row) => row.roll);
  if (rolls.join(',') !== '1,2,3,4,5,6') problems.push('hazards.json fountain is not a d6 with one row per face');
  for (const row of json.curiosities?.fountain?.results ?? []) {
    if (row.condition && !conditions?.conditions?.[row.condition]) {
      problems.push(`fountain roll ${row.roll} applies "${row.condition}", which conditions.json has no entry for`);
    }
  }
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
      else if (!TRAITS[trait] && !BOSS_TRAITS[trait] && !PENDING[trait]) {
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
 * file name -> checker. A file with no checker is only parsed, which still
 * catches the most common failure: a trailing comma in hand-edited JSON.
 * @type {Record<string, (json: any) => void>}
 */
/**
 * items.json: `04` sections 1 to 13. Every base item in the game, plus the
 * tables that turn one into a found item. The checks here are the ones a
 * broken item would otherwise show as a crash mid-run: an effect written in a
 * vocabulary nothing reads, a recipe that makes an item that does not exist,
 * a property table with a hole in it.
 */
function checkItems(json, strings, combat, conditions, skills, attributes) {
  const ids = Object.keys(json.items ?? {}).filter((id) => !id.startsWith('_'));
  if (ids.length === 0) {
    problems.push('items.json has no items');
    return;
  }

  const rarities = json.rules?.rarities ?? [];
  const categories = ['weapon', 'armor', 'shield', 'charm', 'potion', 'scroll', 'bomb', 'gear', 'valuable', 'part'];
  const damageTypes = combat?.damage?.types ?? [];
  const conditionIds = Object.keys(conditions?.conditions ?? {});
  const skillIds = Object.keys(skills?.skills ?? {}).filter((id) => !id.startsWith('_'));
  const weaponProperties = Object.keys(json.rules?.weaponProperties ?? {}).filter((id) => !id.startsWith('_'));
  const saves = ['body', 'reflex', 'mind'];

  /** An effect is one of the five shapes items and skills share. */
  const checkEffect = (effect, where) => {
    const kinds = ['sheet', 'hook', 'explore', 'action', 'shop', 'grants'].filter((kind) => effect[kind]);
    if (kinds.length !== 1) {
      problems.push(`${where} has an effect that is none of sheet, hook, explore, action, shop or grants`);
      return;
    }
    if (effect.hook) {
      if (!EVENTS.includes(effect.hook)) {
        problems.push(`${where} hangs on "${effect.hook}", which is not an event 06 section 16 fires`);
      }
      if (!effect.handler) problems.push(`${where} hangs on an event with no handler`);
      else if (!ITEM_HANDLERS[effect.handler] && !ITEMS_PENDING[effect.handler]) {
        problems.push(`${where} names handler "${effect.handler}", which nothing implements`);
      }
    }
    if (effect.grants && !skillIds.includes(effect.grants)) {
      problems.push(`${where} grants "${effect.grants}", which is not a skill`);
    }
    if (effect.damageType && !damageTypes.includes(effect.damageType)) {
      problems.push(`${where} names damage type "${effect.damageType}", which does not exist`);
    }
    if (effect.save && !saves.includes(effect.save)) {
      problems.push(`${where} names save "${effect.save}", which does not exist`);
    }
    if (effect.attribute && !attributes?.order?.includes(effect.attribute)) {
      problems.push(`${where} names attribute "${effect.attribute}", which does not exist`);
    }
    for (const id of effect.conditions ?? []) {
      if (!conditionIds.includes(id)) problems.push(`${where} names condition "${id}", which does not exist`);
    }
  };

  for (const id of ids) {
    const entry = json.items[id];
    const where = `items.json ${id}`;

    if (!entry.name) problems.push(`${where} has no name`);
    if (!categories.includes(entry.category)) problems.push(`${where} is a "${entry.category}", which is not a category`);
    if (!rarities.includes(entry.rarity)) problems.push(`${where} is "${entry.rarity}", which is not a rarity`);
    if (entry.cost !== null && !(entry.cost >= 0)) problems.push(`${where} costs ${entry.cost}`);
    if (entry.base && !json.items[entry.base]) problems.push(`${where} is based on "${entry.base}", which has no entry`);

    // Slots: everything carried takes at least one, and equipment sizes are
    // the ones 04 section 1 lists. The Floor Key is the documented 0.
    const resolved = { ...(entry.base ? json.items[entry.base] : {}), ...entry };
    if (resolved.slots === undefined) problems.push(`${where} has no slot size`);
    if (entry.stack !== undefined && ![json.rules?.stacks?.consumable, json.rules?.stacks?.valuable].includes(entry.stack)) {
      problems.push(`${where} stacks ${entry.stack} to a slot, which is neither stack size in 04 section 1`);
    }

    if (resolved.category === 'weapon') {
      if (!resolved.damage) problems.push(`${where} is a weapon with no damage`);
      if (!damageTypes.includes(resolved.damageType)) {
        problems.push(`${where} deals "${resolved.damageType}", which is not a damage type`);
      }
      for (const property of resolved.properties ?? []) {
        if (!weaponProperties.includes(property)) problems.push(`${where} is "${property}", which 04 section 2 does not list`);
      }
    }
    if (['armor', 'shield'].includes(resolved.category) && !(resolved.def >= 0)) {
      problems.push(`${where} is armour with no DEF`);
    }
    for (const attribute of Object.keys(entry.requires ?? {})) {
      if (!attributes?.order?.includes(attribute)) {
        problems.push(`${where} requires "${attribute}", which is not an attribute`);
      }
    }
    for (const effect of entry.effects ?? []) checkEffect(effect, where);
    if (entry.use?.condition && !conditionIds.includes(entry.use.condition)) {
      problems.push(`${where} applies "${entry.use.condition}", which is not a condition`);
    }
    for (const id2 of entry.use?.cure ?? []) {
      if (!conditionIds.includes(id2)) problems.push(`${where} cures "${id2}", which is not a condition`);
    }
    if (entry.casts && !skillIds.includes(entry.casts)) {
      problems.push(`${where} casts "${entry.casts}", which is not a skill`);
    }
    if (entry.category === 'scroll' && !['arcane', 'spirit'].includes(entry.school)) {
      problems.push(`${where} is a scroll of no school (04 section 9)`);
    }
    // 04 section 5: an unknown charm shows as "Plain Ring", so every charm
    // needs the plain word it hides behind.
    if (entry.category === 'charm' && !entry.plain) {
      problems.push(`${where} is a charm with no plain name to be found under (04 section 5)`);
    }
  }

  // Section 13: ten boss rewards and six legendary finds, each once per game.
  const uniques = ids.filter((id) => json.items[id].rarity === 'unique');
  const bossRewards = uniques.filter((id) => json.items[id].boss);
  const legendaries = uniques.filter((id) => json.items[id].legendary);
  if (bossRewards.length !== 10) problems.push(`items.json has ${bossRewards.length} boss rewards, and 04 section 13 lists 10`);
  if (legendaries.length !== 6) problems.push(`items.json has ${legendaries.length} legendary finds, and 04 section 13 lists 6`);

  // Section 4: both property tables have to be whole, and every roll has to
  // name a property with an entry.
  for (const [name, block] of [
    ['weaponProperties', json.magic?.weaponProperties],
    ['armorProperties', json.magic?.armorProperties],
  ]) {
    const rolls = (block?.table ?? []).map((row) => row.roll);
    for (let roll = 1; roll <= (block?.die ?? 0); roll += 1) {
      if (!rolls.includes(roll)) problems.push(`items.json ${name} has no entry for a roll of ${roll}`);
    }
    for (const row of block?.table ?? []) {
      const property = block.properties?.[row.id];
      if (!property) problems.push(`items.json ${name} rolls "${row.id}", which has no entry`);
      else for (const effect of property.effects ?? []) checkEffect(effect, `items.json ${name} ${row.id}`);
    }
  }

  // Section 6: eight curses, a chance per floor band, and a way off the item.
  const curseRolls = (json.curses?.table ?? []).map((row) => row.roll);
  for (let roll = 1; roll <= (json.curses?.die ?? 0); roll += 1) {
    if (!curseRolls.includes(roll)) problems.push(`items.json curses have no entry for a roll of ${roll}`);
  }
  for (const row of json.curses?.table ?? []) {
    for (const effect of row.effects ?? []) checkEffect(effect, `items.json curse ${row.id}`);
  }
  if (!json.items?.[json.curses?.removal?.scroll]) problems.push('items.json curses name no scroll that removes them');

  // Section 12: the gem bands rise, and each names a real item.
  let last = 0;
  for (const band of json.gems?.bands ?? []) {
    if (band.upTo <= last) problems.push('items.json gem bands are out of order');
    last = band.upTo;
    if (!json.items[band.item]) problems.push(`items.json gem band names "${band.item}", which has no entry`);
  }
  for (const id of json.artObjects ?? []) {
    if (!json.items[id]) problems.push(`items.json art object "${id}" has no entry`);
  }

  // Section 12: every recipe takes real parts and makes a real item.
  for (const recipe of json.alchemy?.recipes ?? []) {
    for (const line of recipe.ingredients ?? []) {
      if (!json.items[line.item]) problems.push(`items.json recipe takes "${line.item}", which has no entry`);
      if (!(line.count >= 1)) problems.push(`items.json recipe takes ${line.count} of "${line.item}"`);
    }
    if (!json.items[recipe.result?.item]) problems.push(`items.json recipe makes "${recipe.result?.item}", which has no entry`);
    if (!(recipe.fee >= 0)) problems.push('items.json recipe has no fee');
  }

  // Section 5: every potion and scroll that is found unknown needs an
  // appearance of its own, and no two share one.
  const unknownPotions = ids.filter(
    (id) => json.items[id].category === 'potion' && !json.items[id].alwaysKnown,
  );
  const looks = json.identification?.potionLooks ?? [];
  if (looks.length < unknownPotions.length) {
    problems.push(`items.json has ${looks.length} potion appearances for ${unknownPotions.length} unknown potions`);
  }
  if (new Set(looks).size !== looks.length) problems.push('items.json repeats a potion appearance');
  const words = json.identification?.scrollWords ?? [];
  const titles = words.length * (words.length - 1);
  const scrolls = ids.filter((id) => json.items[id].category === 'scroll').length;
  if (titles < scrolls) problems.push(`items.json cannot make ${scrolls} different scroll titles from ${words.length} words`);
  for (const id of json.identification?.alwaysKnown ?? []) {
    if (!json.items[id]) problems.push(`items.json knows "${id}" from the start, and it has no entry`);
  }

  // The rules block 04 section 1 gives.
  if (!(json.rules?.inventory?.base >= 1)) problems.push('items.json has no inventory size');
  // The same rule is in two documents (`01` section 4 and `04` section 1), and
  // the hero's sheet reads the other one: they have to agree.
  const slots = attributes?.derived?.inventorySlots;
  if (slots && (slots.base !== json.rules?.inventory?.base || slots.perMod !== json.rules?.inventory?.perMightMod)) {
    problems.push(
      `items.json carries ${json.rules?.inventory?.base} + MIG x ${json.rules?.inventory?.perMightMod} slots, and attributes.json says ${slots.base} + MIG x ${slots.perMod}`,
    );
  }
  if (!json.rules?.unarmed?.damage) problems.push('items.json has no unarmed attack');
  if (!(json.rules?.stashSlots >= 1)) problems.push('items.json has no stash size');
  if (!(json.rules?.quickSlots >= 1)) problems.push('items.json has no quick slots');
  for (const slot of json.rules?.equipSlots ?? []) {
    if (!['weapon', 'offHand', 'armor', 'charm'].includes(slot)) {
      problems.push(`items.json has an equipment slot "${slot}" that 04 section 1 does not`);
    }
  }
}

/**
 * loot.json: `04` section 14's three d12 tables and `02` section 17's category
 * roll. Every row has to be reachable and has to name something real, or a
 * kill would hand back nothing.
 */
function checkLoot(json, items) {
  const die = json.die;
  if (!(die >= 2)) problems.push('loot.json has no die');

  for (const [category, table] of Object.entries(json.tables ?? {})) {
    let last = 0;
    for (const row of table) {
      const where = `loot.json ${category} ${row.upTo}`;
      if (!(row.upTo > last)) problems.push(`loot.json ${category} rows are out of order`);
      last = row.upTo;
      if (row.item && !items?.items?.[row.item]) problems.push(`${where} drops "${row.item}", which has no item entry`);
      for (const id of row.oneOf ?? []) {
        if (!items?.items?.[id]) problems.push(`${where} drops "${id}", which has no item entry`);
      }
      if (row.pick && !json.pools?.[row.pick]) problems.push(`${where} picks from "${row.pick}", which is not a pool`);
      if (row.else?.pick && !json.pools?.[row.else.pick]) {
        problems.push(`${where} falls back to "${row.else.pick}", which is not a pool`);
      }
      if (row.gem?.capTo && !items?.items?.[row.gem.capTo]) {
        problems.push(`${where} caps the gem at "${row.gem.capTo}", which has no item entry`);
      }
      if (!row.item && !row.pick && !row.gem && !row.oneOf) problems.push(`${where} drops nothing`);
    }
    if (last !== die) problems.push(`loot.json ${category} ends at ${last}, and the die is a d${die}`);
  }

  // Every pool has to hold something, or a roll on it would find nothing.
  for (const [name, filter] of Object.entries(json.pools ?? {})) {
    if (name.startsWith('_')) continue;
    const matches = Object.entries(items?.items ?? {}).filter(([id, entry]) => {
      if (id.startsWith('_') || entry.loot === false || entry.harmful) return false;
      if (filter.legendary) return Boolean(entry.legendary);
      if (entry.legendary || entry.rarity === 'unique') return false;
      if (filter.category && !filter.category.includes(entry.category)) return false;
      if (filter.rarity && !filter.rarity.includes(entry.rarity)) return false;
      if (filter.magic !== undefined && Boolean(entry.magic) !== filter.magic) return false;
      return true;
    });
    if (matches.length === 0) problems.push(`loot.json pool "${name}" matches no item`);
  }

  let last = 0;
  for (const band of json.categoryRoll?.bands ?? []) {
    if (band.upTo <= last) problems.push('loot.json category bands are out of order');
    last = band.upTo;
    if (band.category && !['common', 'uncommon', 'rare'].includes(band.category)) {
      problems.push(`loot.json category band "${band.category}" is not a loot table`);
    }
  }
  for (const row of json.gear?.bonus?.rareOnFloors ?? []) {
    if (!(row.bonus >= 1)) problems.push('loot.json rare gear has no bonus on some floors');
  }
  if (!(json.gear?.propertyChance > 0)) problems.push('loot.json rare gear never rolls a property');
}

/**
 * shops.json: `04` section 15's tier table. The stock arrives with the Shop
 * screen; what is here is what unlocks each tier, and the town reads it.
 */
function checkShops(json, items, loot) {
  const tiers = json.tiers ?? [];
  if (tiers.length !== 5) problems.push(`shops.json has ${tiers.length} tiers, and 04 section 15 lists 5`);
  let lastBoss = 0;
  for (const [index, row] of tiers.entries()) {
    const where = `shops.json tier ${row.tier}`;
    if (row.tier !== index + 1) problems.push(`${where} is out of order`);
    if (index === 0) {
      if (row.unlockedBy !== null) problems.push('shops.json tier 1 is not open from the start');
      continue;
    }
    const boss = row.unlockedBy?.boss;
    if (!(boss >= 1 && boss <= 10)) problems.push(`${where} opens on floor ${boss}`);
    else if (boss <= lastBoss) problems.push(`${where} opens no deeper than the tier before it`);
    lastBoss = boss ?? lastBoss;
  }
  // Everything a tier lists has to be a real item the shop could price, and
  // 04 section 15 forbids three things outright.
  for (const row of tiers) {
    const where = `shops.json tier ${row.tier}`;
    for (const id of row.items ?? []) {
      const entry = items?.items?.[id];
      if (!entry) problems.push(`${where} stocks "${id}", which has no item entry`);
      else if (entry.cost === null) problems.push(`${where} stocks "${id}", which has no price`);
      else if (entry.rarity === 'unique') problems.push(`${where} stocks a unique item`);
    }
    for (const line of row.rotating ?? []) {
      if (line.item && !items?.items?.[line.item]) {
        problems.push(`${where} rotates "${line.item}", which has no item entry`);
      }
      if (line.pick && !loot?.pools?.[line.pick]) {
        problems.push(`${where} rotates from "${line.pick}", which is not a loot pool`);
      }
      if (!line.item && !line.pick) problems.push(`${where} has a rotating line that rolls nothing`);
      if ((line.bonus ?? 0) > (json.rules?.maxBonus ?? 2)) {
        problems.push(`${where} rotates a +${line.bonus}, and 04 section 15 says shops never sell those`);
      }
      if (!(line.count >= 1) && !line.item) problems.push(`${where} rotates ${line.count} of something`);
    }
  }
  if (!(json.rules?.sellRate > 0)) problems.push('shops.json has no sell rate (04 section 1)');
  if (!(json.rules?.repair?.cost > 0)) problems.push('shops.json has no repair fee (04 section 1)');

  for (const [name, spec] of Object.entries(json.services ?? {})) {
    if (name.startsWith('_')) continue;
    for (const [key, value] of Object.entries(spec)) {
      if (!(value >= 0)) problems.push(`shops.json ${name}.${key} is ${value}`);
    }
  }
  // The Alchemist's own unlock is 04 section 12's, and lives with the recipes.
  if (!(items?.alchemy?.unlockedBy?.boss >= 1)) {
    problems.push('items.json does not say which boss opens the Alchemist');
  }
}

/**
 * traps.json: `03` sections 2 to 5's three tables. A trap with no effect, an
 * impossible tier or a salvage that is not an item would only show up the
 * first time one went off.
 */
function checkTraps(json, items, conditions, locks, combat) {
  const ids = Object.keys(json.traps ?? {}).filter((id) => !id.startsWith('_'));
  if (ids.length !== 30) problems.push(`traps.json has ${ids.length} traps, and 03 section 5 lists 30`);

  const tiers = Object.keys(locks?.tiers ?? {}).filter((id) => !id.startsWith('_'));
  const conditionIds = Object.keys(conditions?.conditions ?? {});
  const damageTypes = combat?.damage?.types ?? [];
  const saves = ['body', 'reflex', 'mind'];

  for (const id of ids) {
    const spec = json.traps[id];
    const where = `traps.json ${id}`;
    if (!spec.name) problems.push(`${where} has no name`);
    if (!spec.placement?.length) problems.push(`${where} goes nowhere`);
    for (const place of spec.placement ?? []) {
      if (!['floor', 'door', 'chest'].includes(place)) problems.push(`${where} is placed on a "${place}"`);
    }
    if (!(spec.minFloor >= 1 && spec.minFloor <= 10)) problems.push(`${where} starts on floor ${spec.minFloor}`);
    if (!spec.tiers?.length) problems.push(`${where} has no tier`);
    for (const tier of spec.tiers ?? []) {
      if (!tiers.includes(tier)) problems.push(`${where} is "${tier}", which is not a tier`);
    }
    if (![true, false, 'advantage'].includes(spec.poleable)) {
      problems.push(`${where} does not say whether a pole reaches it`);
    }

    const effect = spec.effect ?? {};
    const does =
      effect.save || effect.attack || effect.damage || effect.encounter || effect.condition || effect.escapeSteps;
    if (!does) problems.push(`${where} does nothing`);
    for (const save of [effect.save, effect.then?.save]) {
      if (save && !saves.includes(save)) problems.push(`${where} saves against "${save}"`);
    }
    for (const id2 of [effect.condition, effect.onFail?.condition, effect.then?.condition]) {
      if (id2 && !conditionIds.includes(id2)) problems.push(`${where} applies "${id2}", which is not a condition`);
    }
    for (const type of [effect.damageType].flat().filter(Boolean)) {
      if (!damageTypes.includes(type)) problems.push(`${where} deals "${type}", which is not a damage type`);
    }
    if (spec.salvage && !items?.items?.[spec.salvage]) {
      problems.push(`${where} salvages "${spec.salvage}", which has no item entry`);
    }
  }

  // The chest table is a whole d12, and every roll names a chest trap.
  for (let roll = 1; roll <= 12; roll += 1) {
    const row = json.chestTrapRoll?.table?.find((entry) => entry.roll === roll);
    if (!row) problems.push(`traps.json chest table has no entry for a roll of ${roll}`);
    else if (!json.traps[row.id]) problems.push(`traps.json chest table rolls "${row.id}", which has no entry`);
    else if (!json.traps[row.id].placement.includes('chest')) {
      problems.push(`traps.json chest table rolls "${row.id}", which does not go on a chest`);
    }
  }
  for (const [id, item] of Object.entries(json.salvage?.by ?? {})) {
    if (!json.traps[id]) problems.push(`traps.json salvages from "${id}", which has no entry`);
    if (!items?.items?.[item]) problems.push(`traps.json salvages "${item}", which has no item entry`);
  }
  if (!items?.items?.[json.salvage?.default]) problems.push('traps.json has no default salvage');
  if (!(json.floorDice?.perFloors >= 1)) problems.push('traps.json has no floor dice rule (03 section 2)');
  if (json.detection?.passivePenalty >= 0) problems.push('traps.json passive notice has no penalty');
}

const CHECKS = {
  'strings.json': checkStrings,
  // Checked against strings.json, so it is read first.
  'combat.json': (json) => checkCombat(json, loaded['strings.json']),
  'ai.json': checkAi,
  'attributes.json': (json) => checkAttributes(json, loaded['strings.json']),
  'skills.json': (json) => checkSkills(json, loaded['strings.json'], loaded['attributes.json']),
  'items.json': (json) =>
    checkItems(
      json,
      loaded['strings.json'],
      loaded['combat.json'],
      loaded['conditions.json'],
      loaded['skills.json'],
      loaded['attributes.json'],
    ),
  'loot.json': (json) => checkLoot(json, loaded['items.json']),
  'shops.json': (json) => checkShops(json, loaded['items.json'], loaded['loot.json']),
  'traps.json': (json) =>
    checkTraps(
      json,
      loaded['items.json'],
      loaded['conditions.json'],
      loaded['locks.json'],
      loaded['combat.json'],
    ),
  'origins.json': (json) =>
    checkOrigins(
      json,
      loaded['attributes.json'],
      loaded['strings.json'],
      loaded['items.json'],
      loaded['skills.json'],
    ),
  'monsters.json': (json) => checkMonsters(json, loaded['ai.json'], loaded['combat.json']),
  'encounters.json': (json) => checkEncounters(json, loaded['monsters.json']),
  'floors.json': checkFloors,
  // Checked against half the database: floors, items, traps, loot, monsters.
  'hazards.json': (json) =>
    checkHazards(
      json,
      loaded['floors.json'],
      loaded['items.json'],
      loaded['conditions.json'],
      loaded['traps.json'],
      loaded['loot.json'],
      loaded['monsters.json'],
    ),
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
