/**
 * The traits of the monsters on floors 1 and 2 (`02` sections 4 and 5).
 *
 * Each one is a hook, registered from the unit's own `traits` list and owned
 * by that unit, so a trait only ever fires for the monster that has it and the
 * engine never asks what kind of monster it is fighting. The numbers live in
 * `monsters.json` beside the trait's name — a Kobold's `+1 ATK per ally, max
 * +2` is `{ "id": "pack_tactics", "bonus": 1, "max": 2 }`.
 *
 * On-hit riders are not here: the Zombie's Grab, the Ghoul's Paralyzing Claw
 * and the Giant Rat's Filthy Bite are `onHit` data on the attack, and
 * `riders.js` is the one hook that applies them all.
 *
 * Two traits wait for the systems they need, and say so in `PENDING`.
 */
import { applyCondition, has } from './conditions.js';
import { parsePart } from './damage.js';
import { checkMorale } from './morale.js';
import { place, countedEnemies } from './field.js';
import { resolveAttack } from './attack.js';

/** Traits the documents describe but that need a system Phase 3 hasn't built. */
export const PENDING = {
  corrode: 'Weapon damage and repair arrive with the item database (04, Phase 5).',
  snuff: 'The hero has no torch to put out until items arrive (04, Phase 5).',
};

/** How the trait list is written: a bare id, or an id with its numbers. */
function asTrait(entry) {
  return typeof entry === 'string' ? { id: entry } : { ...entry };
}

/** Living monsters of the same kind as this one, itself excluded. */
function kin(combat, unit) {
  return countedEnemies(combat).filter(
    (other) => other !== unit && other.alive && other.type === unit.type,
  );
}

/** The damage of one type in a resolved hit. */
function damageOfType(damage, type) {
  return (damage?.parts ?? [])
    .filter((part) => part.type === type)
    .reduce((total, part) => total + (part.amount ?? 0), 0);
}

/* -------------------------------------------------------------------------- */
/* The traits                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Each entry registers one trait for one unit and returns the removers.
 * @type {Record<string, (hooks: any, unit: object, trait: object) => (() => void)[]>}
 */
export const TRAITS = {
  /** Kobold: +1 ATK for each other kobold still standing (max +2). */
  pack_tactics(hooks, unit, trait) {
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase === 'judge' || payload.attacker !== unit) return;
          const pack = kin(payload.combat, unit).length;
          payload.bonus += Math.min(trait.max ?? 2, pack * (trait.bonus ?? 1));
        },
        { name: 'packTactics', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Kobold: the last one standing checks morale at once. */
  last_one_standing(hooks, unit) {
    return [
      hooks.on(
        'kill',
        (payload) => {
          if (!unit.alive || kin(payload.combat, unit).length > 0) return;
          const check = checkMorale(payload.combat, unit, 'lastStanding');
          if (check?.flees) payload.say(`${unit.id} breaks`);
        },
        { name: 'morale', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Green Slime: slash damage of 5 or more splits it, up to four slimes. */
  divide(hooks, unit, trait) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.target !== unit || !unit.alive) return;
          if (damageOfType(payload.damage, 'slash') < (trait.slashAtLeast ?? 5)) return;
          const slimes = countedEnemies(payload.combat).filter(
            (other) => other.alive && other.type === unit.type,
          ).length;
          if (slimes >= (trait.maxSlimes ?? 4)) return;

          // The two halves share what is left, and the split is never fatal.
          const half = Math.max(1, Math.floor(unit.hp / 2));
          unit.hp = Math.max(1, unit.hp - half);
          const spawn = {
            ...unit,
            id: `${unit.id}-split${slimes}`,
            hp: half,
            conditions: {},
            controlImmunity: {},
            freshImmunity: [],
            summoned: true,
            traits: unit.traits,
          };
          delete spawn.slot;
          delete spawn.seq;
          if (place(payload.combat, spawn).placed) {
            registerFor(payload.combat, spawn);
            payload.say(`${unit.id} divides`);
          }
        },
        { name: 'divide', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Skeleton: 1-in-6 at the end of a round, unless crush or holy put it down. */
  reassemble(hooks, unit, trait) {
    return [
      hooks.on(
        'roundEnd',
        (payload) => {
          if (unit.alive || unit.fled || unit.reassembled) return;
          const killedBy = unit.lastDamageTypes ?? [];
          if (killedBy.some((type) => (trait.notBy ?? []).includes(type))) return;
          if (payload.combat.rng.die(trait.oneIn ?? 6) !== 1) return;
          unit.alive = true;
          unit.hp = Math.max(1, Math.floor(unit.maxHp * (trait.share ?? 0.5)));
          unit.reassembled = true;
          payload.say(`${unit.id} rises`);
        },
        { name: 'reassemble', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Zombie: once, 1-in-3 to rise at 1 HP — not from fire, holy, or a crit. */
  relentless(hooks, unit, trait) {
    return [
      hooks.on(
        'zeroHP',
        (payload) => {
          if (payload.unit !== unit || unit.usedRelentless) return;
          unit.usedRelentless = true;
          const killedBy = unit.lastDamageTypes ?? [];
          if (killedBy.some((type) => (trait.notBy ?? []).includes(type))) return;
          if (trait.notOnCrit && payload.result?.crit) return;
          if (payload.combat.rng.die(trait.oneIn ?? 3) !== 1) return;
          payload.saved = true;
          payload.savedBy = 'relentless';
          unit.hp = trait.hp ?? 1;
        },
        { name: 'relentless', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Cave Bat Swarm: half from a single-target weapon, and a half more from an area effect. */
  swarm_body(hooks, unit) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== unit) return;
          if (payload.attack?.area) payload.allPartsMultiplier = 1.5;
          else if (payload.weapon) payload.allPartsMultiplier = 0.5;
        },
        { name: 'resistance', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Cave Bat Swarm: a critical hit Blinds. */
  blinding_flurry(hooks, unit) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit || !payload.result?.crit) return;
          if (applyCondition(payload.target, 'blinded').applied) {
            payload.say(`${payload.target.id} is blinded`);
          }
        },
        { name: 'rider', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Cave Bat Swarm: advantage while the hero is in the dark. */
  echolocation(hooks, unit) {
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase === 'judge' || payload.attacker !== unit) return;
          if (payload.combat.dark) payload.advantage = true;
        },
        { name: 'rider', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Grave Robber: on a hit, steals 2d10 gp. Killing it returns everything. */
  pickpocket(hooks, unit, trait) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit) return;
          const purse = payload.target.gold ?? 0;
          if (purse <= 0) return;
          const stolen = Math.min(purse, payload.combat.rng.roll(trait.gold ?? '2d10'));
          payload.target.gold = purse - stolen;
          unit.stolenGold = (unit.stolenGold ?? 0) + stolen;
          payload.say(`${unit.id} steals ${stolen} gold`);
        },
        { name: 'pickpocket', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Grave Robber: it runs once it is holding gold. That is the Thief
   * archetype's own first rule, so the trait is the script — nothing to
   * register, and it is listed here so the data check knows it is handled.
   */
  slippery() {
    return [];
  },

  /** Ghoul: +1d6 against a Paralyzed hero. */
  feast(hooks, unit, trait) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit) return;
          if (!has(payload.target, trait.vs ?? 'paralyzed')) return;
          const main = payload.parts.find((part) => part.main);
          payload.parts.push(
            parsePart(trait.dice ?? '1d6', { type: main?.type, extra: true }),
          );
        },
        { name: 'backstab', owner: unit.id, source: 'traits' },
      ),
    ];
  },
};

/* -------------------------------------------------------------------------- */
/* Abilities that take more than one monster's turn                           */
/* -------------------------------------------------------------------------- */

/**
 * Volley: "with two or more archers present, once per combat they all fire
 * together at +2 … this uses the turns of all archers in the group"
 * (`02` section 4, `06` section 12). The archer that chose it fires as usual;
 * the others fire here and are marked as having acted this round.
 */
function registerSharedTurns(hooks, unit) {
  const shared = (unit.abilities ?? []).filter((ability) => ability.sharedTurn);
  if (!shared.length) return [];

  return [
    hooks.on(
      'beforeAction',
      (payload) => {
        if (payload.phase !== 'action' || payload.unit !== unit) return;
        const ability = shared.find((entry) => entry.id === payload.action?.ability);
        if (!ability) return;

        for (const other of kin(payload.combat, unit)) {
          if (other.actedInRound === payload.combat.round) continue;
          other.actedInRound = payload.combat.round;
          const theirs = (other.abilities ?? []).find((entry) => entry.id === ability.id);
          if (theirs) theirs.used = true;
          resolveAttack(payload.combat, other, {
            id: 'attack',
            kind: ability.kind ?? 'ranged',
            bonus: (other.atk ?? 0) + (ability.bonus ?? 0),
            damage: ability.damage,
            ability: ability.id,
          });
        }
        payload.say(`${unit.id} volleys`);
      },
      { name: 'guardian', owner: unit.id, source: 'traits' },
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Registering                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Registers one unit's traits. Called at setup for every monster, and again
 * for anything that arrives mid-fight — a summon, or a slime that divided.
 * @returns {(() => void)[]}
 */
export function registerFor(combat, unit) {
  const off = [];
  for (const entry of unit.traits ?? []) {
    const trait = asTrait(entry);
    const register = TRAITS[trait.id];
    if (!register) {
      // A trait waiting on another phase is listed in PENDING; anything else
      // is a typo, and the data check catches it before this ever runs.
      if (!PENDING[trait.id]) throw new Error(`unknown monster trait: ${trait.id}`);
      continue;
    }
    off.push(...register(combat.hooks, unit, trait));
  }
  off.push(...registerSharedTurns(combat.hooks, unit));
  return off;
}

/**
 * Registers the traits of every monster on the field.
 * @param {object} combat
 * @returns {() => void}
 */
export function registerMonsterTraits(combat) {
  const off = [];
  for (const unit of combat.units) {
    if (unit.side !== 'monsters') continue;
    off.push(...registerFor(combat, unit));
  }
  return () => {
    for (const remove of off) remove();
  };
}
