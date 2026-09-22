/**
 * A hero's skills, applied (`01` section 6, `06` section 16).
 *
 * Two halves, and they arrive at different times:
 *
 *   - **The sheet.** A passive that is a number — +5 max HP a rank, +1 DEF a
 *     rank, a wider critical range — is folded into the hero's own sheet when
 *     the skill is learned. Nothing in combat has to know it exists, because
 *     the engine already reads `def`, `maxHp`, `critFrom` and the rest.
 *   - **The hooks.** Everything else names an event and a handler, and this
 *     registers those on a fight the way `monster-traits.js` registers a
 *     monster's. A handler that has not been written yet is listed in
 *     `PENDING` with the reason, and `npm run data` fails on a handler that is
 *     neither implemented nor listed.
 *
 * No special-case code paths: the combat loop never asks whether the hero has
 * a skill. It fires its events, and whatever was registered answers.
 */
import {
  SKILLS,
  amountOf,
  exploreEffects,
  hookEffects,
  sheetEffects,
  skill,
  skillIds,
} from '../data/skills.js';
import { DERIVED, modFor } from '../data/attributes.js';
import combatData from '../data/combat.json' with { type: 'json' };
import { SKIP } from './hooks.js';
import { resolveAttack } from './attack.js';
import { dealDamage, gatherParts } from './damage.js';
import { applyCondition, has, isHelpless } from './conditions.js';
import { isTargetable, targetableEnemies } from './field.js';
import { zeroHp } from './defeat.js';
import { buffOf, whyNotPlayable } from './skill-actions.js';

/** `06` section 17's Auto setting for the reactions a prompt would ask about. */
export const REACTIONS = combatData.reactions;

/**
 * The Reaction prompt setting (`06` section 17): **ask** pauses the fight and
 * asks, **auto** uses a reaction on a hit worth more than a quarter of the
 * hero, **never** lets every hit land. A fight with no setting plays Auto,
 * which is what the tools and the simulator fly.
 */
export const REACTION_POLICIES = ['ask', 'auto', 'never'];

/**
 * The prompt-worthy reactions this hit could be met with, each only if it
 * could be used right now: Lucky once a combat, Arcane Shield once a round,
 * for 2 FP, and only when +4 DEF would turn the hit into a miss.
 * @returns {string[]}
 */
export function reactionsFor(payload, unit) {
  const combat = payload.combat;
  const state = combat.skillState?.[unit.id];
  const knows = (id) => skillsOf(unit).some((row) => row.id === id);
  const out = [];
  const shieldCost = skill('arcane_shield').fp ?? 0;
  const shieldDef = hookEffects('arcane_shield', 1)[0]?.def ?? 4;
  if (
    knows('arcane_shield') &&
    state?.shieldRound !== combat.round &&
    (unit.fp ?? 0) >= shieldCost &&
    payload.roll !== 20 &&
    payload.total < payload.def + shieldDef &&
    !isHelpless(unit)
  ) {
    out.push('arcaneShield');
  }
  if (knows('lucky') && !state?.uses?.lucky) out.push('lucky');
  return out;
}

/**
 * What the player chose for this hit, when the setting is Ask: the recorded
 * answer, or — the first time the hit is met — nothing, with a draft of the
 * prompt left on the combat for the fight to finish and show. One key per
 * judged hit, shared by both reactions' hooks, counted on the combat so a
 * replayed turn asks about the same hit under the same key.
 * @returns {string | null}
 */
function answerFor(payload, unit) {
  const combat = payload.combat;
  if (payload.reactionKey === undefined) {
    const options = reactionsFor(payload, unit);
    if (options.length === 0) {
      payload.reactionKey = null;
      return null;
    }
    combat.reactionSeq = (combat.reactionSeq ?? 0) + 1;
    payload.reactionKey = `r${combat.reactionSeq}`;
    payload.reactionOptions = options;
  }
  if (payload.reactionKey === null) return null;
  const answer = combat.reactionAnswers?.[payload.reactionKey];
  if (answer !== undefined) return answer;
  combat.reactionDraft ??= {
    key: payload.reactionKey,
    attacker: payload.attacker?.id ?? null,
    attackerName: payload.attacker?.name ?? payload.attacker?.type ?? '',
    boss: Boolean(payload.attacker?.boss),
    ability: payload.attack?.name ?? null,
    roll: payload.roll,
    total: payload.total,
    def: payload.def,
    options: payload.reactionOptions,
  };
  return null;
}

/**
 * The policy for this moment. Ask only holds while the fight can pause —
 * during a monster's turn, which it has saved a copy of — and anything that
 * lands at another moment (a boss's phase ability set off by the hero's own
 * blow) is played Auto rather than lost.
 */
function policyNow(combat) {
  const policy = combat.reactionPolicy ?? 'auto';
  return policy === 'ask' && !combat.reactionAsking ? 'auto' : policy;
}

/** Marks a reaction spent in the fight's own record, whatever decided it. */
function spend(combat, unit, id) {
  combat.skillState ??= {};
  combat.skillState[unit.id] ??= { uses: {}, buffs: {} };
  const state = combat.skillState[unit.id];
  if (id === 'lucky') state.uses.lucky = (state.uses.lucky ?? 0) + 1;
  if (id === 'arcaneShield') state.shieldRound = combat.round;
}

/**
 * Handlers whose systems have not been built yet. Each says what it is waiting
 * for, the way the monster traits and the lock methods do.
 */
export const PENDING = {
  archmage: 'The free cast is a second action in one turn, which the Combat screen does not offer yet (Phase 8, Auto-Fight).',
  mystic: 'Temporary HP from overhealing: no example build takes Mystic, so it waits for the balance pass that wants it.',
  mysticDrain: 'The same: a damage spell to drain from.',
  forager: 'The herb comes after the fight, which the Victory flow will roll (Phase 8).',
};

/* -------------------------------------------------------------------------- */
/* The sheet                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Folds every `sheet` effect of the skills a hero has learned into their own
 * numbers. Called when a skill is learned, when a level moves the base, and
 * when a hero is loaded, so the sheet the engine reads is always the whole
 * truth — and so that running it twice changes nothing.
 *
 * `baseSheet` is the hero without any skill at all: the maxima a rebuild
 * starts from. Hit points are the one number carried rather than recomputed,
 * because every level rolled for them (`01` section 4).
 *
 * @param {object} hero the hero, with `skills: [{ id, rank }]`
 * @returns {object} the same hero, changed in place
 */
/**
 * The skills a hero has: the ones they learned, plus the ones their gear
 * lends them (`04` section 13, "A granted skill works exactly like the learned
 * skill while the item is equipped. If the hero already has the skill, the
 * item adds nothing extra").
 * @param {object} hero
 * @returns {{ id: string, rank: number, granted?: boolean }[]}
 */
export function skillsOf(hero) {
  const out = (hero?.skills ?? []).map(({ id, rank = 1 }) => ({ id, rank }));
  for (const effect of hero?.gear?.effects ?? []) {
    if (!effect.grants) continue;
    const rank = effect.rank ?? 1;
    const known = out.find((entry) => entry.id === effect.grants);
    if (known) known.rank = Math.max(known.rank, rank);
    else out.push({ id: effect.grants, rank, granted: true });
  }
  return out;
}

export function applySkillSheet(hero) {
  const learned = skillsOf(hero);
  // Start from what the attributes alone give, so re-applying is safe.
  const base = hero.baseSheet ?? snapshot(hero);
  hero.baseSheet = base;

  // The nested parts are copied too: a shallow spread would leave `attacks`
  // and `saves` pointing at the base's own objects, and every rebuild would
  // add the skill's bonus to the base it was measuring from.
  const sheet = { ...base, attacks: { ...base.attacks }, saves: { ...base.saves } };
  for (const { id, rank = 1 } of learned) {
    for (const effect of sheetEffects(id, rank)) applySheetEffect(sheet, effect, rank, hero);
    // A skill's `explore` effects belong on the sheet too: `03` and `05`'s
    // systems — searching, picking, bashing — read one place for what the
    // hero brings, whether it came from a skill or from the pack.
    for (const effect of exploreEffects(id, rank)) applyExploreEffect(sheet, effect, rank);
  }
  // The gear goes on after the skills, because Armor Training is what cancels
  // the heavy penalties (`04` section 3). `hero.gear` is the pack's summary,
  // so nothing here has to know what an item is.
  applyGear(sheet, hero.gear, hero);
  // And what the hero drank: a buff lasts a combat or a hundred steps, and is
  // folded last so it is on top of everything (`04` section 8).
  for (const buff of hero.buffs ?? []) {
    for (const effect of buff.effects ?? []) applySheetEffect(sheet, effect, 1, hero);
  }

  hero.maxHp = sheet.maxHp;
  hero.maxFp = sheet.maxFp;
  hero.def = sheet.def;
  hero.critFrom = sheet.critFrom;
  hero.saves = { ...sheet.saves };
  hero.attacks = { ...sheet.attacks };
  hero.atk = sheet.attacks.melee;
  if (sheet.attacksPerAction > 1) hero.attacksPerAction = sheet.attacksPerAction;
  if (sheet.critDice) hero.critDice = sheet.critDice;
  if (sheet.surpriseOn) hero.surpriseOn = sheet.surpriseOn;
  if (sheet.cannotBeSurprised) hero.cannotBeSurprised = true;
  if (sheet.dr) hero.dr = sheet.dr;
  if (sheet.spellCost) hero.spellCost = sheet.spellCost;
  // These two come from the gear, and gear comes off: they are written every
  // time rather than only when they are set, or a penalty would outlive the
  // armour that caused it.
  hero.spellFizzle = sheet.spellFizzle ?? 0;
  hero.ignoresHalfCover = Boolean(sheet.ignoresHalfCover);
  hero.stealth = sheet.stealth ?? 0;
  hero.init = sheet.initiative ?? hero.init;
  hero.slots = sheet.slots ?? hero.slots;
  // The damage rules read these three off the unit (`06` section 7).
  hero.resistant = [...(sheet.resistant ?? [])];
  hero.immune = [...(sheet.immune ?? [])];
  hero.immunities = [...(sheet.immunities ?? [])];
  hero.mods = { ...sheet.mods };
  hero.damageBonus = sheet.damageBonus ?? 0;
  hero.cannot = sheet.cannot ?? [];
  hero.explore = sheet.explore ?? {};
  // A potion can put the hero in the first initiative band, and the fight's
  // end takes it away again (`06` section 3, `04` section 8).
  hero.actsFirst = Boolean(sheet.actsFirst);

  // Anything the engine does not read itself — the pack's and the dungeon's
  // own flags — is copied across under its own name for that system to find.
  for (const [key, value] of Object.entries(sheet)) {
    if (key in base || key in hero) continue;
    hero[key] = value;
  }

  // Nothing is healed here: this only recomputes the maxima, and it runs
  // again every time the sheet is rebuilt. Handing over what a *new* rank or
  // a level added is the job of whoever added it, or a rebuild would heal the
  // hero every time it ran.
  hero.hp = Math.min(hero.hp, sheet.maxHp);
  hero.fp = Math.min(hero.fp, sheet.maxFp);
  return hero;
}

/**
 * Whether an effect's `while` condition holds. The two the tree uses are about
 * what is worn — Duelist's +1 DEF with no shield, Armor Training's DR in heavy
 * armour — and the pack's summary answers both. With no pack yet, a
 * conditional bonus stays off.
 */
function holds(condition, hero) {
  if (!condition) return true;
  switch (condition) {
    case 'noShield':
      return Boolean(hero?.gear) && !hero.gear.shield;
    case 'heavyArmor':
      return Boolean(hero?.gear?.heavyArmor);
    default:
      return false;
  }
}

/** The hero's numbers before any skill touched them. */
function snapshot(hero) {
  return {
    maxHp: hero.maxHp,
    maxFp: hero.maxFp,
    def: hero.def,
    critFrom: hero.critFrom,
    initiative: hero.init ?? 0,
    saves: { ...hero.saves },
    attacks: { ...hero.attacks },
    mods: { ...(hero.mods ?? {}) },
    slots: hero.slots ?? 0,
    resistant: [...(hero.baseResistant ?? [])],
    immune: [...(hero.baseImmune ?? [])],
    immunities: [...(hero.baseImmunities ?? [])],
    attacksPerAction: 1,
  };
}

/**
 * What the worn gear does to the sheet's attack lines (`04` sections 2 and 3).
 *
 * DEF is already in the base — it is part of `01` section 4's formula — so
 * what is left is to-hit: heavy armour and tower shields, which Armor Training
 * cancels, a requirement the hero does not meet, which nothing cancels, and
 * the weapon's own bonus, which lands on the line it is swung with. Spell
 * attacks are untouched: heavy armour taxes spells by fizzling them instead.
 *
 * @param {object} sheet
 * @param {object} [gear] the pack's summary, or nothing while there is no pack
 */
function applyGear(sheet, gear, hero) {
  if (!gear) return;
  const heavy = sheet.noHeavyArmorPenalty ? 0 : (gear.heavyToHit ?? 0);
  const worn = heavy + (gear.toHit ?? 0);
  sheet.attacks.melee += worn + (gear.weaponToHit?.melee ?? 0);
  sheet.attacks.ranged += worn + (gear.weaponToHit?.ranged ?? 0);
  if (gear.fizzle) sheet.spellFizzle = sheet.noHeavyArmorPenalty ? 0 : gear.fizzle;
  if (gear.stealth) sheet.stealth = (sheet.stealth ?? 0) + gear.stealth;

  // What the gear itself does — a charm's bonus, a property, a curse — in the
  // same vocabulary a skill uses, so none of it gets a code path of its own
  // (`04` sections 4, 6 and 7). The hook effects are registered on a fight
  // rather than folded here.
  for (const effect of gear.effects ?? []) {
    if (effect.sheet) applySheetEffect(sheet, effect, 1, hero);
    else if (effect.explore) applyExploreEffect(sheet, effect, 1);
  }

  // The critical range follows the Luck modifier (`01` section 4), and a curse
  // can move that modifier: it is recomputed from where Luck ended up, with
  // whatever Weapon Mastery widened still on top.
  const luck = sheet.mods?.[DERIVED.critRange.mod];
  if (luck !== undefined) {
    const rule = DERIVED.critRange;
    const base = luck >= rule.wideFromMod ? rule.wideNatural : rule.natural;
    sheet.critFrom = base - (sheet.critWiden ?? 0);
  }
}

/**
 * One `explore` effect, folded in. A number adds up across the skills and the
 * gear that give it — two ranks of Trapfinding and a Thief's Glove are +6 to
 * picking — and a flag is simply set.
 */
function applyExploreEffect(sheet, effect, rank = 1) {
  sheet.explore = { ...(sheet.explore ?? {}) };
  const amount = amountOf(effect, rank);
  const current = sheet.explore[effect.explore];
  if (effect.perRank !== undefined || effect.value !== undefined) {
    sheet.explore[effect.explore] = typeof current === 'number' ? current + amount : amount;
  } else {
    sheet.explore[effect.explore] = true;
  }
}

/** One `sheet` effect, folded in. */
function applySheetEffect(sheet, effect, rank, hero) {
  const amount = amountOf(effect, rank);
  switch (effect.sheet) {
    case 'maxHp':
      sheet.maxHp += amount;
      break;
    case 'maxFp':
      sheet.maxFp += amount;
      break;
    case 'def':
      // A conditional bonus — Duelist's +1 with no shield — asks the pack's
      // summary whether it applies.
      if (holds(effect.while, hero)) sheet.def += amount;
      break;
    case 'saves':
      for (const save of Object.keys(sheet.saves)) sheet.saves[save] += amount;
      break;
    case 'attack':
      // A potion's "+2 to attack" names no kind, so it lands on all of them.
      if (effect.attack) sheet.attacks[effect.attack] += amount;
      else for (const kind of Object.keys(sheet.attacks)) sheet.attacks[kind] += amount;
      break;
    case 'critFrom':
      sheet.critFrom -= effect.widen ?? 0;
      // Kept so the gear step can rebuild the range from the Luck a curse
      // may have moved, without losing what a skill widened.
      sheet.critWiden = (sheet.critWiden ?? 0) + (effect.widen ?? 0);
      break;
    case 'initiative':
      sheet.initiative = (sheet.initiative ?? 0) + amount;
      break;
    case 'damage':
      // A flat bonus to every hit. Anything narrower — a die of fire, a type
      // or a kind of attack — is a hook, because it needs the hit to know.
      if (!effect.add && !effect.damageType && !effect.attack && !effect.vs) {
        sheet.damageBonus = (sheet.damageBonus ?? 0) + amount;
      }
      break;
    case 'attributeMod':
      sheet.mods = { ...(sheet.mods ?? {}) };
      sheet.mods[effect.attribute] = (sheet.mods[effect.attribute] ?? 0) + amount;
      break;
    case 'cannot':
      sheet.cannot = [...new Set([...(sheet.cannot ?? []), ...(effect.actions ?? [])])];
      break;
    case 'resist':
      sheet.resistant = [...new Set([...(sheet.resistant ?? []), effect.damageType])];
      break;
    case 'immune':
      // A charm can turn away a damage type, a condition or a whole tag
      // (`04` section 7): the Amulet of Antivenom does two of the three.
      if (effect.damageType) sheet.immune = [...new Set([...(sheet.immune ?? []), effect.damageType])];
      if (effect.conditions?.length || effect.tags?.length) {
        sheet.immunities = [
          ...new Set([...(sheet.immunities ?? []), ...(effect.conditions ?? []), ...(effect.tags ?? [])]),
        ];
      }
      break;
    case 'inventorySlots':
      sheet.slots = (sheet.slots ?? 0) + amount;
      break;
    case 'attribute':
      // The score itself is raised before the sheet is derived, by the pack's
      // summary; nothing to fold here.
      break;
    case 'critDice':
      sheet.critDice = effect.value;
      break;
    case 'attacks':
      sheet.attacksPerAction = effect.value;
      break;
    case 'surpriseOn':
      sheet.surpriseOn = Math.max(sheet.surpriseOn ?? 0, effect.value);
      break;
    case 'cannotBeSurprised':
      sheet.cannotBeSurprised = true;
      break;
    case 'dr':
      if (holds(effect.while, hero)) sheet.dr = (sheet.dr ?? 0) + amount;
      break;
    case 'spellCost':
      sheet.spellCost = (sheet.spellCost ?? 0) + effect.value;
      break;
    default:
      // Anything the pack or the dungeon reads rather than the engine —
      // `lightWeaponAttribute`, `ignoresHalfCover`, `noHeavyArmorPenalty` —
      // stays on the sheet under its own name for that system to find.
      sheet[effect.sheet] = effect.value ?? true;
      if (effect.sheet === 'lightWeaponAttribute') sheet.lightWeaponMod = modFor(hero.attributes?.[effect.value]);
  }
}

/* -------------------------------------------------------------------------- */
/* The hooks                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The handlers that are written. Each takes the fight's register, the unit and
 * the effect's own numbers, and returns its removers — the same shape
 * `monster-traits.js` uses.
 * @type {Record<string, (hooks: any, unit: object, effect: object, rank: number) => (() => void)[]>}
 */
export const HANDLERS = {
  /** Mana Siphon: regain 1 Focus whenever you kill an enemy. */
  manaSiphon(hooks, unit, effect) {
    return [
      hooks.on(
        'kill',
        (payload) => {
          if (payload.attacker !== unit) return;
          unit.fp = Math.min(unit.maxFp ?? 0, (unit.fp ?? 0) + (effect.fp ?? 1));
          payload.say(`${unit.id} draws focus`);
        },
        { name: 'manaSiphon', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /** Regeneration: 1 HP at the start of each of your turns. */
  regeneration(hooks, unit, effect) {
    return [
      hooks.on(
        'turnStart',
        (payload) => {
          if (payload.unit !== unit || payload.phase === 'free') return;
          if (!unit.alive || unit.hp >= unit.maxHp) return;
          unit.hp = Math.min(unit.maxHp, unit.hp + (effect.hp ?? 1));
          payload.healing = (payload.healing ?? 0) + (effect.hp ?? 1);
        },
        { name: 'regeneration', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /** Crusader: heal 2 HP each time your melee attack hits. */
  crusader(hooks, unit, effect) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit) return;
          if (effect.meleeOnly && (payload.attack?.kind ?? 'melee') !== 'melee') return;
          unit.hp = Math.min(unit.maxHp ?? unit.hp, unit.hp + (effect.hp ?? 2));
        },
        { name: 'crusader', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /** Undying: once per rest, a killing blow leaves you at half your hit points. */
  undying(hooks, unit, effect) {
    return [
      hooks.on(
        'zeroHP',
        (payload) => {
          if (payload.unit !== unit) return SKIP;
          payload.saved = true;
          payload.savedBy = 'undying';
          payload.recoverTo = effect.shareOfMaxHp ?? 0.5;
        },
        {
          name: 'undying',
          owner: unit.id,
          source: 'skills',
          limit: effect.limit ?? { uses: 1, per: 'rest' },
        },
      ),
    ];
  },

  /**
   * Cleave: drop a front-row enemy and swing at another one, once a turn
   * (`01` section 6).
   */
  cleave(hooks, unit, effect) {
    return [
      hooks.on(
        'kill',
        (payload) => {
          const { combat, attacker, target, attack } = payload;
          if (attacker !== unit || !combat || !target) return SKIP;
          if ((attack?.kind ?? 'melee') !== 'melee' || target.row !== 'front') return SKIP;
          const next = targetableEnemies(combat).find(
            (enemy) => enemy !== target && enemy.alive && isTargetable(enemy) && enemy.row === 'front' && !enemy.object,
          );
          if (!next || !unit.alive) return SKIP;
          const swing = resolveAttack(combat, unit, { ...unit.attack, kind: 'melee', target: next, cleave: true });
          followUp(payload, 'cleave', swing);
          return undefined;
        },
        { name: 'cleave', owner: unit.id, source: 'skills', limit: effect.limit },
      ),
    ];
  },

  /** Riposte: a melee attack misses you, and you answer it (`01` section 6). */
  riposte(hooks, unit, effect) {
    const cost = skill('riposte').fp ?? 0;
    return [
      hooks.on(
        'miss',
        (payload) => {
          const { combat, attacker, target, attack } = payload;
          if (target !== unit || !combat || !attacker?.alive) return SKIP;
          if (effect.meleeOnly && (attack?.kind ?? 'melee') !== 'melee') return SKIP;
          if (!unit.alive || isHelpless(unit) || (unit.fp ?? 0) < cost) return SKIP;
          const swing = resolveAttack(combat, unit, { ...unit.attack, kind: 'melee', target: attacker, riposte: true });
          if (!swing.legal) return SKIP;
          unit.fp -= cost;
          followUp(payload, 'riposte', swing);
          return undefined;
        },
        { name: 'riposte', owner: unit.id, source: 'skills', limit: effect.limit },
      ),
    ];
  },

  /**
   * Backstab: +2 weapon dice against a Surprised, Stunned, Asleep or Blinded
   * target, or from hiding (`01` section 6, and Hidden in section 7).
   */
  backstab(hooks, unit, effect) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit || !payload.weapon || payload.overTime) return;
          if (!opening(payload, effect.vs)) return;
          addDiceOfMain(payload, effect.weaponDice ?? 2, 'backstab');
        },
        { name: 'backstab', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /**
   * Arcane Trickster: a damage spell from hiding, or against a Surprised
   * target, gets the Backstab dice — of its own die, a spell having no weapon
   * (docs/DECISIONS.md).
   */
  arcaneTrickster(hooks, unit) {
    const dice = hookEffects('backstab', 1)[0]?.weaponDice ?? 2;
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit || payload.weapon || payload.overTime) return;
          if (!(payload.attack?.fromHiding || payload.target?.surprised)) return;
          addDiceOfMain(payload, dice, 'arcaneTrickster');
        },
        { name: 'arcaneTrickster', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /**
   * Evasion rank 2: a Reflex save made against an area effect means no damage
   * at all. Anything that halves on a Reflex save is an area effect for this.
   */
  evasion(hooks, unit, effect, rank) {
    if (rank < (effect.fromRank ?? 2)) return [];
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== unit) return;
          const save = payload.result?.save;
          if (!save?.passed || save.save !== 'reflex') return;
          if (!(payload.attack?.area || payload.attack?.save?.half)) return;
          payload.allPartsMultiplier = 0;
        },
        { name: 'evasion', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /**
   * Lucky: once a combat, a d20 is thrown again. Played on Auto — the attack
   * against you that would take more than a quarter of your hit points.
   */
  lucky(hooks, unit, effect) {
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase !== 'judge' || payload.target !== unit || !payload.hit) return SKIP;
          const policy = policyNow(payload.combat);
          if (policy === 'never') return SKIP;
          if (policy === 'ask') {
            if (answerFor(payload, unit) !== 'lucky') return SKIP;
          } else if (!worthAReaction(unit, payload.attack, payload.crit)) {
            return SKIP;
          }
          spend(payload.combat, unit, 'lucky');
          payload.reroll = true;
          return undefined;
        },
        { name: 'lucky', owner: unit.id, source: 'skills', limit: effect.limit },
      ),
    ];
  },

  /** Arcane Shield: +4 DEF against a hit, after the roll; on Auto (`06` section 17). */
  arcaneShield(hooks, unit, effect) {
    const cost = skill('arcane_shield').fp ?? 0;
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase !== 'judge' || payload.target !== unit || !payload.hit) return SKIP;
          const policy = policyNow(payload.combat);
          if (policy === 'never') return SKIP;
          if (policy === 'ask') {
            if (answerFor(payload, unit) !== 'arcaneShield') return SKIP;
          } else {
            // A natural 20 hits whatever the DEF, so the shield would be wasted.
            if (payload.roll === 20 || (unit.fp ?? 0) < cost || isHelpless(unit)) return SKIP;
            if (payload.total >= payload.def + (effect.def ?? 4)) return SKIP;
            if (!worthAReaction(unit, payload.attack, payload.crit)) return SKIP;
          }
          spend(payload.combat, unit, 'arcaneShield');
          unit.fp -= cost;
          payload.bonusDef = (payload.bonusDef ?? 0) + (effect.def ?? 4);
          return undefined;
        },
        { name: 'arcaneShield', owner: unit.id, source: 'skills', limit: effect.limit },
      ),
    ];
  },

  /** Blink: while it holds, a hit against you misses half the time. */
  blink(hooks, unit, effect) {
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase !== 'judge' || payload.target !== unit || !payload.hit) return;
          if (!buffOf(payload.combat, unit, 'blink')) return;
          if (payload.combat.rng.chance(effect.chance ?? 0.5)) payload.hit = false;
        },
        { name: 'blink', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /**
   * Spellblade: a melee hit takes up to 3 FP, 1d6 each. The extra dice are
   * part of the same hit, so they are added after it rather than run through
   * the damage order again (DR once per hit, `06` section 7 step 9).
   */
  spellblade(hooks, unit, effect) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          const { combat, attacker, target, attack, result } = payload;
          if (attacker !== unit || !combat || !target?.alive) return;
          if ((attack?.kind ?? 'melee') !== 'melee' || result?.effectOnly) return;
          const spend = Math.min(effect.maxFp ?? 3, unit.fp ?? 0);
          if (spend <= 0) return;
          unit.fp -= spend;
          const [count, sides] = String(effect.dicePerFp ?? '1d6').split('d').map(Number);
          const amount = combat.rng.dice(count * spend, sides);
          dealDamage(combat, target, amount, { attacker: unit, attack, kind: 'spellblade' });
          if (result?.damage) result.damage.total = (result.damage.total ?? 0) + amount;
          if (target.hp <= 0 && target.alive) {
            const zero = zeroHp(combat, target, { attacker: unit, attack, result, cause: 'attack' });
            if (zero.died && result) result.killed = true;
          }
        },
        { name: 'spellblade', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /** Envenom: the next hit this combat Poisons its target. */
  envenom(hooks, unit) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          const { combat, attacker, target, result } = payload;
          if (attacker !== unit || !combat || !target?.alive || result?.effectOnly) return;
          const state = combat.skillState?.[unit.id];
          if (!state?.buffs?.envenom) return;
          state.buffs.envenom = null;
          const applied = applyCondition(target, 'poisoned', { source: unit.id, onOwnTurn: false });
          if (applied.applied) payload.say(`${target.id} is poisoned`);
        },
        { name: 'envenom', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /** Spirit Ward: DR 3 for the rest of the combat. */
  spiritWard(hooks, unit, effect) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== unit || payload.overTime) return;
          if (!buffOf(payload.combat, unit, 'spiritWard')) return;
          payload.dr = (payload.dr ?? 0) + (effect.dr ?? 3);
        },
        { name: 'spiritWard', owner: unit.id, source: 'skills' },
      ),
    ];
  },

  /** Hunter's Mark: +2 to hit and +1d6 damage against the marked foe (Ranger). */
  huntersMark(hooks, unit) {
    const marked = (payload) => {
      const mark = buffOf(payload.combat, unit, 'huntersMark');
      return mark && payload.attacker === unit && payload.target?.id === mark.target ? mark : null;
    };
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase !== 'gather') return;
          const mark = marked(payload);
          if (mark) payload.bonus = (payload.bonus ?? 0) + (mark.toHit ?? 0);
        },
        { name: 'huntersMark', owner: unit.id, source: 'skills' },
      ),
      hooks.on(
        'damageCalc',
        (payload) => {
          const mark = marked(payload);
          if (!mark?.extraDice || payload.overTime) return;
          payload.parts = [...(payload.parts ?? []), { ...parseDice(mark.extraDice), extra: true }];
        },
        { name: 'huntersMark', owner: unit.id, source: 'skills' },
      ),
    ];
  },
};


/* -------------------------------------------------------------------------- */
/* What the handlers share                                                    */
/* -------------------------------------------------------------------------- */

/** A free blow a skill threw, hung on the result that caused it for the log. */
function followUp(payload, skillId, result) {
  const host = payload.result;
  if (!host) return;
  host.followUps = [...(host.followUps ?? []), { skill: skillId, result }];
}

/** Whether the target is open to a Backstab: listed conditions, surprise, or hiding. */
function opening(payload, vs = []) {
  const target = payload.target;
  if (payload.attack?.fromHiding) return true;
  if (!target) return false;
  return vs.some((id) => (id === 'surprised' ? target.surprised : has(target, id)));
}

/** Adds more of the main part's own dice, which is what "weapon dice" are. */
function addDiceOfMain(payload, times, tag) {
  const main = (payload.parts ?? []).find((part) => part.main) ?? payload.parts?.[0];
  if (!main || !main.count) return;
  const extra = [];
  for (let i = 0; i < times; i += 1) {
    extra.push({ count: main.count, sides: main.sides, flat: 0, ...(main.type ? { type: main.type } : {}), extra: true, [tag]: true });
  }
  payload.parts = [...payload.parts, ...extra];
}

/** A dice string as a part, for an extra die a buff adds. */
function parseDice(text) {
  const [head, type] = String(text).split(' ');
  const [count, sides] = head.split('d').map(Number);
  return { count: count || 1, sides, flat: 0, ...(type ? { type } : {}) };
}

/**
 * `06` section 17's Auto rule: a reaction is spent on a hit that would take
 * more than a quarter of the hero's maximum. What it "would take" is its
 * average, with the dice doubled on a critical.
 */
export function worthAReaction(unit, attack, crit = false) {
  let average = 0;
  for (const part of gatherParts(attack ?? {})) {
    const dice = part.count * (crit ? 2 : 1);
    average += (dice * (part.sides + 1)) / 2 + (part.flat ?? 0);
  }
  return average > (unit.maxHp ?? 0) * REACTIONS.autoShareOfMaxHp;
}

/**
 * Registers a hero's hook effects on a fight.
 *
 * @param {object} combat
 * @param {object} [unit] whose skills; the hero by default
 * @returns {() => void} removes them again
 */
export function registerSkills(combat, unit = combat.hero) {
  const off = [];
  for (const { id, rank = 1 } of skillsOf(unit)) {
    for (const effect of hookEffects(id, rank)) {
      const handler = HANDLERS[effect.handler];
      if (!handler) {
        // A handler waiting on another phase is listed in PENDING; anything
        // else is a typo, and the data check catches it before this runs.
        if (!PENDING[effect.handler]) throw new Error(`unknown skill handler: ${effect.handler}`);
        continue;
      }
      off.push(...handler(combat.hooks, unit, effect, rank));
    }
  }
  return () => {
    for (const remove of off) remove();
  };
}

/**
 * True when everything a skill declares is applied by something that exists
 * today: its sheet numbers, its dungeon bonuses, a handler for each of its
 * hooks, and — for a skill with an action — a resolver for the action.
 */
export function isLive(id) {
  const entry = skill(id);
  if (entry.action && whyNotPlayable(id) !== null) return false;
  const effects = entry.effects ?? [];
  if (effects.length === 0) return Boolean(entry.action);
  return effects.every(
    (effect) => effect.sheet || effect.explore || (effect.handler && HANDLERS[effect.handler]),
  );
}

/** Every skill whose effects are all waiting on another phase. */
export function pendingSkills() {
  return skillIds().filter((id) => !isLive(id) && SKILLS[id]);
}
