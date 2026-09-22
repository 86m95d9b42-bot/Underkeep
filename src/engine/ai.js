/**
 * Monster AI (`06` section 11).
 *
 * A monster has an **ordered list of rules**. On its turn the engine reads
 * them from the top and runs the first one whose condition is true and whose
 * action is legal; the last rule is always a fallback, usually a basic attack.
 * A monster with no script of its own follows its **archetype**, and the eight
 * archetypes are `ai.json`, one for one with the section's table.
 *
 * Conditions are written the way the document writes them — `every(3) and
 * count(Giant Rat) < 4` — so a script transcribed out of section 12 reads the
 * same in `monsters.json` as it does on the page. The vocabulary is section
 * 11's table, and nothing else parses.
 *
 * **Monsters don't waste abilities**: anything that would apply a control
 * condition is passed over unless the hero can actually take it, and what the
 * monster learns about the hero's immunities it remembers for the fight. Easy
 * is the exception — there, monsters try anyway.
 *
 * No DOM. Every roll comes from the combat stream.
 */
import data from '../data/ai.json' with { type: 'json' };
import { blockedFrom, has } from './conditions.js';
import { legalityOf } from './actions.js';
import { countedEnemies, sideOf } from './field.js';

export const ARCHETYPES = data.archetypes;
export const DIFFICULTY = data.difficulty.settings;
export const DEFAULT_DIFFICULTY = data.difficulty.default;
export const HURT_BELOW = data.hurtBelow;

/** The built-in actions a rule may name outright. */
const BUILT_IN = ['attack', 'wait', 'defend', 'flee', 'telegraph'];

/* -------------------------------------------------------------------------- */
/* The condition vocabulary                                                   */
/* -------------------------------------------------------------------------- */

/** Loose comparison, so a script may be written `<`, `<=`, `>`, `>=` or `=`. */
function compare(left, operator, right) {
  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '=':
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    default:
      throw new Error(`unknown comparison "${operator}"`);
  }
}

/** For matching a monster type however the document spells it. */
const key = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Splits on a keyword, ignoring anything inside brackets. */
function splitTop(text, keyword) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0 && text.startsWith(keyword, i)) {
      parts.push(text.slice(start, i));
      i += keyword.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Is this condition true right now?
 *
 * @param {string} expression the section 11 vocabulary; empty means always
 * @param {object} context `{ combat, unit, hero }`
 */
export function evaluate(expression, context) {
  const text = String(expression ?? '').trim();
  if (!text) return true;

  const ors = splitTop(text, ' or ');
  if (ors.length > 1) return ors.some((part) => evaluate(part, context));
  const ands = splitTop(text, ' and ');
  if (ands.length > 1) return ands.every((part) => evaluate(part, context));
  return atom(text, context);
}

/** One term of the vocabulary. */
function atom(text, context) {
  const { combat, unit } = context;
  const hero = context.hero ?? combat?.hero;
  const term = text.replace(/\s+/g, ' ').trim();

  if (/^not /i.test(term)) return !evaluate(term.slice(4), context);
  if (/^(always|true)$/i.test(term)) return true;
  if (/^(never|false)$/i.test(term)) return false;

  let match;

  if ((match = /^ready\(\s*(.+?)\s*\)$/i.exec(term))) {
    return isReady(abilityOf(unit, match[1]), combat?.round);
  }
  if ((match = /^unused\(\s*(.+?)\s*\)$/i.exec(term))) {
    const ability = abilityOf(unit, match[1]);
    return Boolean(ability) && !ability.used;
  }
  if ((match = /^round\s*(<=|>=|<|>|==|=)\s*(\d+)$/i.exec(term))) {
    return compare(combat?.round ?? 0, match[1], Number(match[2]));
  }
  if ((match = /^hero\s+hp\s*(<=|>=|<|>|==|=)\s*(\d+)\s*%$/i.exec(term))) {
    return compare(hpShare(hero), match[1], Number(match[2]) / 100);
  }
  if ((match = /^every\(\s*(\d+)\s*\)$/i.exec(term))) {
    const round = combat?.round ?? 0;
    return round > 0 && round % Number(match[1]) === 0;
  }
  if ((match = /^chance\(\s*([\d.]+)\s*(%?)\s*\)$/i.exec(term))) {
    const probability = match[2] === '%' ? Number(match[1]) / 100 : Number(match[1]);
    return combat.rng.chance(probability);
  }
  if ((match = /^holding\(\s*(.+?)\s*\)$/i.exec(term))) {
    const what = key(match[1]);
    if (what === 'gold') return (unit.stolenGold ?? 0) > 0;
    return Boolean(unit.holding?.some((item) => key(item) === what));
  }
  if ((match = /^count\(\s*(.+?)\s*\)\s*(<=|>=|<|>|==|=|!=)\s*(\d+)$/i.exec(term))) {
    return compare(countOf(combat, match[1]), match[2], Number(match[3]));
  }
  if ((match = /^(ally\s+)?hp\s*(<=|>=|<|>|==|=)\s*(\d+)\s*%$/i.exec(term))) {
    const share = Number(match[3]) / 100;
    if (match[1]) return allies(combat, unit).some((ally) => hpShare(ally) < share);
    return compare(hpShare(unit), match[2], share);
  }
  if ((match = /^hero\s+(has|lacks)\s+(.+)$/i.exec(term))) {
    const held = has(hero, condKey(match[2]));
    return match[1].toLowerCase() === 'has' ? held : !held;
  }
  if ((match = /^hero\s+can\s+be\s+(.+)$/i.exec(term))) {
    return heroCanBe(unit, hero, condKey(match[1]));
  }
  if ((match = /^in\s+(back|front)\s+row$/i.exec(term))) {
    return unit.row === match[1].toLowerCase();
  }
  if ((match = /^phase\s*(<=|>=|<|>|==|=)\s*(\d+)$/i.exec(term))) {
    return compare(unit.phase ?? 1, match[1], Number(match[2]));
  }

  throw new Error(`unknown AI condition: "${text}"`);
}

/** A condition id as the scripts write it: "Asleep", "asleep", "knocked down". */
function condKey(text) {
  const cleaned = String(text).trim().replace(/[^a-z0-9 ]/gi, '');
  const parts = cleaned.split(/\s+/);
  return parts
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');
}

/** Whatever share of its hit points a unit has left. */
function hpShare(unit) {
  const max = unit.maxHp ?? 0;
  return max > 0 ? unit.hp / max : 0;
}

/** The living monsters beside this one. */
function allies(combat, unit) {
  return sideOf(combat, unit.side).filter((other) => other !== unit && other.alive);
}

/** How many of that type are standing, however the script spells it. */
export function countOf(combat, type) {
  const wanted = key(type);
  return countedEnemies(combat).filter((unit) => unit.alive && key(unit.type) === wanted).length;
}

/** An ability by id or by name, however the script spells it. */
export function abilityOf(unit, name) {
  const wanted = key(name);
  return (unit.abilities ?? []).find(
    (ability) => key(ability.id) === wanted || key(ability.name) === wanted,
  );
}

/**
 * Ready means it exists, is not spent, is not waiting on a recharge, and has
 * rested as long as its `restRounds` asks (the Lich's Gaze, `06` section 12:
 * "not used in the last 2 rounds").
 */
function isReady(ability, round) {
  if (!ability) return false;
  if (ability.ready === false) return false;
  if (ability.oncePerCombat && ability.used) return false;
  if (ability.restRounds && ability.usedRound != null && round != null && round - ability.usedRound <= ability.restRounds) return false;
  return true;
}

/**
 * "Hero can be C": not immune, and not inside a control-immunity window — and
 * not something this monster has already learned the hero shrugs off.
 */
export function heroCanBe(unit, hero, condition) {
  if (!hero) return false;
  if (unit.knownImmune?.includes(condition)) return false;
  return blockedFrom(hero, condition) === null;
}

/**
 * What a monster learns when something fails to land: it remembers for the
 * rest of the fight (`06` section 11).
 */
export function remember(unit, condition) {
  unit.knownImmune ??= [];
  if (!unit.knownImmune.includes(condition)) unit.knownImmune.push(condition);
  return unit.knownImmune;
}

/* -------------------------------------------------------------------------- */
/* Choosing what to do                                                        */
/* -------------------------------------------------------------------------- */

/** The rules this monster follows: its own, or its archetype's. */
export function scriptFor(unit) {
  if (unit.script?.length) return unit.script;
  return ARCHETYPES[unit.archetype]?.rules ?? ARCHETYPES.brute.rules;
}

/** The difficulty settings in force. */
export function difficultyOf(combat) {
  return DIFFICULTY[combat?.difficulty ?? DEFAULT_DIFFICULTY] ?? DIFFICULTY[DEFAULT_DIFFICULTY];
}

/** The plain attack every script falls back to. */
export function basicAttack(unit) {
  const attack = unit.attack ?? {};
  return { id: 'attack', kind: attack.kind ?? 'melee', ...attack };
}

/**
 * Turns one ability into the action the turn engine resolves.
 * A telegraphed ability spends the turn announcing itself (`06` section 5).
 */
export function actionFor(unit, ability) {
  if (!ability) return null;
  if (ability.telegraph) return { id: 'telegraph', ability: ability.id, name: ability.name };
  return resolvedActionFor(unit, ability);
}

/**
 * The same action, without the wind-up: what a telegraphed ability becomes on
 * the turn it lands (`06` section 5 step 8).
 */
export function resolvedActionFor(unit, ability) {
  if (!ability) return null;
  return {
    id: ability.action ?? 'attack',
    kind: ability.kind ?? 'melee',
    ability: ability.id,
    name: ability.name,
    ...(ability.tags ? { tags: ability.tags } : {}),
    ...(ability.damage ? { damage: ability.damage } : {}),
    ...(ability.parts ? { parts: ability.parts } : {}),
    ...(ability.bonus !== undefined ? { bonus: ability.bonus } : {}),
    ...(ability.fp !== undefined ? { fp: ability.fp } : {}),
    ...(ability.applies ? { applies: ability.applies } : {}),
    ...(ability.target ? { target: ability.target } : {}),
    // A breath weapon, a burst, a wail: the ability's own shape travels with
    // the action, so `06` section 6 resolves it like any other blow.
    ...(ability.attacks ? { attacks: ability.attacks } : {}),
    ...(ability.autoHit ? { autoHit: true } : {}),
    ...(ability.area ? { area: true } : {}),
    ...(ability.magic ? { magic: true } : {}),
    ...(ability.save ? { save: ability.save } : {}),
    ...(ability.onHit ? { onHit: ability.onHit } : {}),
    ...(ability.heal ? { heal: ability.heal } : {}),
    ...(ability.buff ? { buff: ability.buff } : {}),
    // What a boss spends its turn on (`02` sections 4 to 13).
    ...(ability.summon ? { summon: ability.summon } : {}),
    ...(ability.guard ? { guard: ability.guard } : {}),
    ...(ability.sacrifice ? { sacrifice: ability.sacrifice } : {}),
    ...(ability.erase ? { erase: ability.erase } : {}),
    ...(ability.drains ? { drains: true } : {}),
    ...(ability.page ? { page: ability.page } : {}),
    ...(ability.allyBelow ? { allyBelow: ability.allyBelow } : {}),
    ...(ability.uses ? { uses: ability.uses } : {}),
  };
}

/**
 * Which ability a rule's `do` names: an id, or a selector — `role:<role>` for
 * the strongest ready ability of that role, `scheduled` for one whose own
 * `when` has come round, `phase` for one belonging to this phase.
 */
function pick(combat, unit, what, context) {
  const abilities = (unit.abilities ?? []).filter(isReady).filter((ability) => usable(combat, unit, ability));

  if (what.startsWith('role:')) {
    const role = what.slice(5);
    return strongest(abilities.filter((ability) => ability.role === role));
  }
  if (what === 'scheduled') {
    return abilities.find((ability) => ability.when && evaluate(ability.when, context)) ?? null;
  }
  if (what === 'phase') {
    return strongest(abilities.filter((ability) => (ability.phase ?? 1) === (unit.phase ?? 1) && ability.role !== 'passive'));
  }
  // The Bound Grimoire casts whatever page the round turned up
  // (`02` section 11).
  if (what === 'page') {
    return abilities.find((ability) => ability.id === unit.page) ?? strongest(abilities);
  }
  if (what === 'any') return strongest(abilities);
  return abilities.find((ability) => key(ability.id) === key(what)) ?? null;
}

/** The biggest thing on the list: scripts reach for the strongest first. */
function strongest(abilities) {
  if (!abilities.length) return null;
  return [...abilities].sort((a, b) => (b.power ?? 0) - (a.power ?? 0))[0] ?? null;
}

/**
 * "Monsters don't waste abilities": a control ability is only chosen if the
 * hero can actually take the condition. On Easy they try anyway.
 */
export function usable(combat, unit, ability) {
  if (!ability?.control) return true;
  if (difficultyOf(combat).triesImmuneControl) return true;
  return heroCanBe(unit, combat.hero, condKey(ability.control));
}

/**
 * What this monster does on its turn: the `script` service the turn engine
 * asks at `06` section 5 step 9.
 *
 * @param {object} combat
 * @param {object} unit
 * @returns {object | null} the action, or null when it can only wait
 */
export function chooseAction(combat, unit) {
  const context = { combat, unit, hero: combat.hero };

  // Difficulty: on some turns a monster forgets its script and just swings.
  const { slip } = difficultyOf(combat);
  if (slip > 0 && combat.rng.chance(slip)) {
    const swing = basicAttack(unit);
    if (legalityOf(combat, unit, swing).legal) return { ...swing, slipped: true };
  }

  for (const rule of scriptFor(unit)) {
    if (!evaluate(rule.when, context)) continue;

    const action = buildAction(combat, unit, rule, context);
    if (!action) continue;
    // The first rule whose condition is true *and whose action is legal*.
    if (action.id !== 'telegraph' && !legalityOf(combat, unit, action).legal) continue;
    return { ...action, rule: rule.when ?? 'always' };
  }

  // Every script ends in a fallback, but a monster hemmed in by legality can
  // still find nothing to do.
  const swing = basicAttack(unit);
  return legalityOf(combat, unit, swing).legal ? swing : { id: 'wait' };
}

/** One rule's `do`, turned into an action. */
function buildAction(combat, unit, rule, context) {
  const what = String(rule.do ?? 'attack');

  if (what === 'attack') return basicAttack(unit);
  if (BUILT_IN.includes(what)) return { id: what };

  const ability = pick(combat, unit, what, context);
  if (!ability) return null;
  return actionFor(unit, ability);
}

/**
 * Marks an ability spent: a recharge ability goes back on its cooldown and a
 * once-per-combat one is used up (`06` section 5 step 6).
 */
export function spend(unit, id, round) {
  const ability = abilityOf(unit, id);
  if (!ability) return null;
  ability.used = true;
  if (round != null) ability.usedRound = round;
  if (ability.recharges) ability.ready = false;
  return ability;
}

/* -------------------------------------------------------------------------- */
/* Checking a script                                                          */
/* -------------------------------------------------------------------------- */

/** A context that answers everything, for checking that a condition parses. */
const DRY = {
  combat: {
    round: 1,
    units: [],
    hero: { id: 'hero', conditions: {}, immunities: [], controlImmunity: {}, hp: 1, maxHp: 1 },
    rng: { chance: () => false },
  },
  unit: { id: 'dry', side: 'monsters', row: 'front', hp: 1, maxHp: 1, abilities: [] },
};

/**
 * Why this condition would never run, or null when it reads. `npm run data`
 * uses it on every script, so a typo in a transcribed table fails the build
 * instead of making a monster stand still.
 * @param {string} expression
 * @returns {string | null}
 */
export function checkCondition(expression) {
  try {
    evaluate(expression, { ...DRY, hero: DRY.combat.hero });
    return null;
  } catch (error) {
    return error.message;
  }
}
