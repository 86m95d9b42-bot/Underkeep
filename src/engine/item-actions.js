/**
 * Using an item (`04` sections 8, 9 and 10, on `06` section 4's Item action).
 *
 * The action arrives carrying its own `use` block — the item database's words
 * for what it does — so nothing here knows what a Healing Potion is. It
 * resolves what the block asks for and hands back what happened, the way
 * `skill-actions.js` does for a skill.
 *
 * A buff that lasts "one combat" is a layer on the hero's sheet rather than a
 * condition: `01` section 7's conditions are a closed list, and a potion is
 * not on it. The layer is folded by the same code that folds the skills and
 * the gear, and dropped when the fight ends.
 */
import { applyCondition, endCondition, has } from './conditions.js';
import { applySkillSheet } from './skill-hooks.js';
import { HANDLERS } from './item-hooks.js';
import { resolveAttack } from './attack.js';
import { resolveDamage } from './damage.js';
import { rollSave } from './riders.js';
import { burn, isFallen } from './defeat.js';

/** How much more a potion or herb heals with the Periapt of Mending on. */
function healingScale(unit) {
  return 1 + (unit.itemHealing ?? 0);
}

/** Heals a unit and says how much actually landed. */
function heal(combat, unit, amount) {
  const room = (unit.maxHp ?? unit.hp) - unit.hp;
  const healed = Math.max(0, Math.min(room, Math.round(amount)));
  unit.hp += healed;
  return healed;
}

/**
 * The sheet effects a `use` block is worth while it lasts (`04` section 8).
 * Written in the same vocabulary as a skill's or an item's, so the sheet
 * folds them without knowing where they came from.
 */
export function buffEffects(use = {}) {
  const effects = [];
  if (use.attack) effects.push({ sheet: 'attack', value: use.attack });
  if (use.def) effects.push({ sheet: 'def', value: use.def });
  if (use.resist) effects.push({ sheet: 'resist', damageType: use.resist });
  if (use.immune) effects.push({ sheet: 'immune', conditions: use.immune });
  if (use.actFirst) effects.push({ sheet: 'actsFirst', value: true });
  for (const [attribute, value] of Object.entries(use.attributeMod ?? {})) {
    effects.push({ sheet: 'attributeMod', attribute, value });
  }
  return effects;
}

/** Everything a `use` block does that outlasts the sip. */
function applyBuff(combat, unit, action) {
  const use = action.use ?? {};
  const effects = buffEffects(use);
  const lasting = use.forCombat || use.steps || use.untilRest;
  if (effects.length === 0 && !use.regen) return null;

  const buff = {
    id: action.item ?? action.baseId,
    name: action.name,
    effects,
    until: use.forCombat ? 'combat' : use.untilRest ? 'rest' : 'steps',
    steps: use.steps ?? null,
  };
  if (effects.length > 0) {
    unit.buffs = [...(unit.buffs ?? []), buff];
    applySkillSheet(unit);
  }
  // Troll Blood regenerates for the rest of the fight, which is a hook rather
  // than a number: the same one the Ring of Regeneration uses.
  if (use.regen && combat?.hooks) {
    HANDLERS.regeneration(combat.hooks, unit, { hp: use.regen });
  }
  return lasting ? buff : null;
}

/**
 * Resolves one Item action.
 *
 * @param {object} combat
 * @param {object} unit the hero using it
 * @param {object} action `{ id: 'item', item, name, use, target }`
 * @param {object} [services]
 * @returns {object | null} what happened, or null if this is not an Item action
 */
export function resolveItemAction(combat, unit, action, services = {}) {
  if (action.id !== 'item') return null;
  const use = action.use ?? {};
  const out = { item: action.item, baseId: action.baseId, name: action.name, used: true };

  // Thrown: a bomb is an attack roll or a save, and sometimes both
  // (`04` section 10).
  if (use.thrown) {
    return { ...out, ...throwIt(combat, unit, action, services) };
  }
  if (use.sear) return { ...out, ...sear(combat) };

  if (use.heal) {
    out.healed = heal(combat, unit, combat.rng.roll(use.heal) * healingScale(unit));
  }
  if (use.fullHp) out.healed = heal(combat, unit, unit.maxHp ?? unit.hp);
  if (use.restoreFp) {
    const gained = Math.min((unit.maxFp ?? 0) - (unit.fp ?? 0), combat.rng.roll(use.restoreFp));
    unit.fp = (unit.fp ?? 0) + Math.max(0, gained);
    out.fp = Math.max(0, gained);
  }
  if (use.fullFp) {
    out.fp = (unit.maxFp ?? 0) - (unit.fp ?? 0);
    unit.fp = unit.maxFp ?? 0;
  }

  const cured = [];
  for (const id of use.cure ?? []) {
    if (has(unit, id)) {
      endCondition(unit, id);
      cured.push(id);
    }
  }
  if (use.cureAll) {
    for (const id of Object.keys(unit.conditions ?? {})) {
      if ((use.except ?? []).includes(id)) continue;
      endCondition(unit, id);
      cured.push(id);
    }
  }
  if (cured.length > 0) out.cured = cured;

  if (use.removeDrained && unit.conditions?.drained) {
    const stacks = unit.conditions.drained.stacks ?? 1;
    if (stacks > use.removeDrained) unit.conditions.drained.stacks = stacks - use.removeDrained;
    else endCondition(unit, 'drained');
    out.cured = [...(out.cured ?? []), 'drained'];
  }

  // A potion that puts something on the drinker: Invisibility's Hidden, and
  // the harmful ones (`04` section 8).
  if (use.condition) {
    const applied = applyCondition(unit, use.condition, { source: unit.id });
    out.condition = use.condition;
    out.applied = applied.applied;
  }

  // Coat your weapon: the next hit carries it (`04` section 10).
  if (use.coatWeapon && use.nextHit) {
    unit.nextHit = use.nextHit;
    out.coated = use.nextHit;
  }

  const buff = applyBuff(combat, unit, action);
  if (buff) out.buff = buff.id;
  if (use.regen) out.regen = use.regen;

  if (use.flee) out.flee = true;
  // A Scroll of Return takes the hero out of the dungeon altogether
  // (`04` section 9, `05` section 9). The engine cannot leave a floor, so it
  // says so and the caller does it — the same way a Smoke Bomb's flee works.
  if (use.returnToTown) {
    out.returnToTown = true;
    out.leavesMark = Boolean(use.leavesMark);
    out.flee = true;
  }
  return out;
}

/** A thrown bomb: an attack roll, a saving throw, or a row of them. */
function throwIt(combat, unit, action, services) {
  const use = action.use;
  const dc = action.dc ?? 10;
  const targets = targetsOf(combat, unit, action, use);
  const hits = [];

  for (const target of targets) {
    // "Only undead or fiends": Holy Water does nothing to anything else.
    if (use.only && !use.only.includes(target.family)) {
      hits.push({ target: target.id, targetName: target.name, immune: true });
      continue;
    }
    if (use.save) {
      const save = rollSave(target, use.save, dc, combat.rng);
      if (save.passed) {
        hits.push({ target: target.id, targetName: target.name, save, saved: true });
        continue;
      }
      const applied = applyCondition(target, use.condition, { source: unit.id, dc, onOwnTurn: false });
      hits.push({
        target: target.id,
        targetName: target.name,
        save,
        condition: use.condition,
        applied: applied.applied,
      });
      continue;
    }
    // An attack-roll throwable: d20 + BA + AGI mod (`04` section 10).
    const attack = {
      name: action.name,
      kind: 'ranged',
      damage: `${use.damage} ${use.damageType ?? ''}`.trim(),
      noAttributeDamage: true,
      target: target.id,
      ...(use.condition ? { onHit: { condition: use.condition } } : {}),
    };
    const result = use.damage
      ? resolveAttack(combat, unit, attack, services)
      : { hit: false };
    hits.push({ target: target.id, targetName: target.name, ...result });
  }
  return { thrown: true, hits, dc };
}

/** Who a thrown item lands on: one enemy, or a whole row (`04` section 10). */
function targetsOf(combat, unit, action, use) {
  const enemies = combat.units.filter((one) => one.side !== unit.side && one.alive);
  if (use.target === 'row') {
    const aimed = enemies.find((one) => one.id === action.target) ?? enemies[0];
    const row = aimed?.row ?? 'front';
    return enemies.filter((one) => (one.row ?? 'front') === row);
  }
  const aimed = enemies.find((one) => one.id === action.target);
  return aimed ? [aimed] : enemies.slice(0, 1);
}

/** Drops the buffs a fight was worth when the fight ends (`04` section 8). */
export function clearCombatBuffs(unit) {
  const kept = (unit.buffs ?? []).filter((buff) => buff.until !== 'combat');
  if (kept.length === (unit.buffs ?? []).length) return false;
  unit.buffs = kept;
  applySkillSheet(unit);
  return true;
}

/** Winds down the buffs that are measured in steps (`04` section 8). */
export function tickBuffs(unit, steps = 1) {
  if (!unit?.buffs?.length) return false;
  let changed = false;
  const kept = [];
  for (const buff of unit.buffs) {
    if (buff.until !== 'steps' || buff.steps === null) {
      kept.push(buff);
      continue;
    }
    const left = buff.steps - steps;
    if (left > 0) kept.push({ ...buff, steps: left });
    else changed = true;
  }
  unit.buffs = kept;
  if (changed) applySkillSheet(unit);
  return changed;
}

/**
 * A lit torch, held to what will not stay dead: a Fallen troll burns, and a
 * Hydra stump from this round is seared so nothing grows back. It counts as
 * fire for those two things only (`02` section 2, Torches as Tools).
 */
export function sear(combat) {
  const fallen = combat.units.find((one) => isFallen(one) && !one.untargetable);
  if (fallen && burn(fallen, ['fire'])) return { seared: fallen.id };
  const hydra = combat.units.find((one) => (one.stumps ?? 0) > 0);
  if (hydra) {
    const stump = combat.units.find(
      (one) => one.partOf === hydra.type && !one.alive && !one.cauterized,
    );
    hydra.stumps -= 1;
    if (stump) stump.cauterized = true;
    return { seared: stump?.id ?? hydra.id };
  }
  return { nothing: true };
}
