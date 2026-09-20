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
  hookEffects,
  sheetEffects,
  skill,
  skillIds,
} from '../data/skills.js';
import { DERIVED, modFor } from '../data/attributes.js';

/**
 * Handlers whose systems have not been built yet. Each says what it is waiting
 * for, the way the monster traits and the lock methods do.
 */
export const PENDING = {
  cleave: 'The free attack needs the Victory and Loot flow to count its kills (Phase 4).',
  riposte: 'A reaction spends the hero’s FP outside their turn, which the Reaction prompt adds (Phase 8).',
  backstab: 'The extra weapon dice need a weapon to take them from (`04`, Phase 5).',
  evasion: 'Area effects arrive with the spells that make them (Phase 4, later).',
  envenom: 'A buff that waits for the next hit needs the Skills sheet to cast it (Phase 4, later).',
  lucky: 'The reroll is offered by the Reaction prompt (Phase 8).',
  arcaneShield: 'The same prompt: a reaction after a hit has landed (Phase 8).',
  blink: 'Cast as an action, which the Skills sheet will offer (Phase 4, later).',
  archmage: 'The free spell needs the spell list first (Phase 4, later).',
  spellblade: 'Spending FP on a hit needs the pack and the prompt (Phase 5, Phase 8).',
  arcaneTrickster: 'Backstab dice on a spell, so it waits on Backstab.',
  mystic: 'Temporary HP from overhealing needs the healing skills (Phase 4, later).',
  mysticDrain: 'The same: a damage spell to drain from.',
  forager: 'The herb is an item (`04`, Phase 5).',
  spiritWard: 'Cast as an action, which the Skills sheet will offer (Phase 4, later).',
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
export function applySkillSheet(hero) {
  const learned = hero.skills ?? [];
  // Start from what the attributes alone give, so re-applying is safe.
  const base = hero.baseSheet ?? snapshot(hero);
  hero.baseSheet = base;

  // The nested parts are copied too: a shallow spread would leave `attacks`
  // and `saves` pointing at the base's own objects, and every rebuild would
  // add the skill's bonus to the base it was measuring from.
  const sheet = { ...base, attacks: { ...base.attacks }, saves: { ...base.saves } };
  for (const { id, rank = 1 } of learned) {
    for (const effect of sheetEffects(id, rank)) applySheetEffect(sheet, effect, rank, hero);
  }
  // The gear goes on after the skills, because Armor Training is what cancels
  // the heavy penalties (`04` section 3). `hero.gear` is the pack's summary,
  // so nothing here has to know what an item is.
  applyGear(sheet, hero.gear, hero);

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
  hero.stealth = sheet.stealth ?? 0;
  hero.init = sheet.initiative ?? hero.init;
  hero.mods = { ...sheet.mods };
  hero.damageBonus = sheet.damageBonus ?? 0;
  hero.cannot = sheet.cannot ?? [];
  hero.explore = sheet.explore ?? {};

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
    else if (effect.explore) {
      sheet.explore = { ...(sheet.explore ?? {}) };
      sheet.explore[effect.explore] = effect.value ?? true;
    }
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
      sheet.attacks[effect.attack] += amount;
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
          if (payload.unit !== unit) return;
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
};

/**
 * Registers a hero's hook effects on a fight.
 *
 * @param {object} combat
 * @param {object} [unit] whose skills; the hero by default
 * @returns {() => void} removes them again
 */
export function registerSkills(combat, unit = combat.hero) {
  const off = [];
  for (const { id, rank = 1 } of unit?.skills ?? []) {
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
 * An active skill is an action, and the Combat: Skills sheet has nothing to
 * resolve one with yet — it lists what the hero knows and stops there. The
 * action blocks in the data are what that resolver will read.
 */
export const ACTIVE_PENDING =
  'Using a skill needs the Combat: Skills sheet to resolve an action (Phase 4, later).';

/**
 * True when everything a skill declares is applied by something that exists
 * today: its sheet numbers, its dungeon bonuses, and a handler for each of its
 * hooks. An active skill is not live until its action can be used.
 */
export function isLive(id) {
  const entry = skill(id);
  if (entry.type === 'active') return false;
  const effects = entry.effects ?? [];
  if (effects.length === 0) return false;
  return effects.every(
    (effect) => effect.sheet || effect.explore || (effect.handler && HANDLERS[effect.handler]),
  );
}

/** Every skill whose effects are all waiting on another phase. */
export function pendingSkills() {
  return skillIds().filter((id) => !isLive(id) && SKILLS[id]);
}
