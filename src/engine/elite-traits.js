/**
 * The twelve elite traits (`02` section 15) and the Hollow Stalker's one
 * (`02` section 14).
 *
 * `data/elites.js` does what a trait is worth before the fight — double hit
 * points, an extra +4 initiative, DR 3, an immunity — and these are the ones
 * that need a hook: what happens when it hits, when it is hit, when it falls,
 * and when its turn comes round again.
 *
 * Each trait's numbers travel with it on the unit, so nothing here reads a
 * table. They are registered the same way every monster trait is.
 */
import { applyCondition } from './conditions.js';
import { parsePart, resolveDamage } from './damage.js';
import { resolveAttack } from './attack.js';
import { rollSave } from './riders.js';

/** True on the rounds an "every other round" trait fires: 2, 4, 6… */
function everyOther(combat) {
  const round = combat?.round ?? 0;
  return round > 0 && round % 2 === 0;
}

/** Adds dice of one type to everything this unit hits with. */
function brand(hooks, unit, trait, name) {
  return hooks.on(
    'damageCalc',
    (payload) => {
      if (payload.attacker !== unit) return;
      payload.parts.push(parsePart(trait.dice ?? '1d6', { type: trait.damageType, extra: true }));
    },
    { name: 'backstab', owner: unit.id, source: 'elite', label: name },
  );
}

/** @type {Record<string, (hooks: any, unit: object, trait: object) => (() => void)[]>} */
export const ELITE_TRAITS = {
  /** Hulking: +2 damage, on top of the quarter more hit points it was given. */
  elite_hulking(hooks, unit, trait) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit) return;
          payload.flat = (payload.flat ?? 0) + (trait.damage ?? 2);
        },
        { name: 'crit', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /** Swift: an extra attack every other round, after its own action. */
  elite_swift(hooks, unit) {
    return [
      hooks.on(
        'turnEnd',
        (payload) => {
          if (payload.unit !== unit || !unit.alive || !everyOther(payload.combat)) return;
          if (!payload.combat.hero?.alive) return;
          const extra = resolveAttack(payload.combat, unit, {
            ...unit.attack,
            target: payload.combat.hero.id,
          });
          payload.alsoResolved = [...(payload.alsoResolved ?? []), { by: unit, result: extra }];
        },
        { name: 'durations', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /** Blazing and Frostbound: another die of its own element on every hit. */
  elite_blazing(hooks, unit, trait) {
    return [brand(hooks, unit, trait, 'blazing')];
  },

  elite_frostbound(hooks, unit, trait) {
    return [
      brand(hooks, unit, trait, 'frostbound'),
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit || !payload.result?.crit) return;
          if (applyCondition(payload.target, trait.critCondition ?? 'slowed').applied) {
            payload.say(`${payload.target.id} is slowed`);
          }
        },
        { name: 'rider', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /** Vampiric: it heals half of what it deals. */
  elite_vampiric(hooks, unit, trait) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit || !unit.alive) return;
          const dealt = payload.damage?.total ?? 0;
          if (dealt <= 0) return;
          const healed = Math.min((unit.maxHp ?? 0) - unit.hp, Math.floor(dealt * (trait.share ?? 0.5)));
          if (healed <= 0) return;
          unit.hp += healed;
          payload.say(`${unit.id} drinks it in`);
        },
        { name: 'vampiric', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /**
   * Arcane: Magic Missile every other round, one missile per three hit dice
   * (`02` section 15, `06` section 12's elite line).
   */
  elite_arcane(hooks, unit, trait) {
    return [
      hooks.on(
        'turnStart',
        (payload) => {
          if (payload.unit !== unit || payload.phase !== 'free') return;
          if (!unit.alive || !everyOther(payload.combat)) return;
          const hero = payload.combat.hero;
          if (!hero?.alive) return;

          const missiles = Math.max(1, Math.floor((unit.hd ?? 3) / (trait.missilePerHd ?? 3)));
          for (let i = 0; i < missiles; i += 1) {
            resolveDamage(payload.combat, {
              attacker: unit,
              target: hero,
              attack: {
                name: 'magic missile',
                kind: 'spell',
                magic: true,
                autoHit: true,
                damage: `${trait.dmg ?? '1d4+1'} ${trait.damageType ?? 'force'}`,
                noAttributeDamage: true,
              },
            });
          }
          payload.say?.(`${unit.id} looses ${missiles} missiles`);
        },
        { name: 'arcane', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /** Warded: once a round, +4 DEF against one attack that would have hit. */
  elite_warded(hooks, unit, trait) {
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase !== 'judge' || payload.target !== unit || !payload.hit) return;
          if (unit.wardedInRound === payload.combat.round) return;
          unit.wardedInRound = payload.combat.round;
          payload.bonusDef = (payload.bonusDef ?? 0) + (trait.def ?? 4);
        },
        { name: 'arcaneShield', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /** Berserker: below half, it hits harder and guards less. */
  elite_berserker(hooks, unit, trait) {
    return [
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit || unit.raging) return;
          if (unit.hp > (unit.maxHp ?? 0) * (trait.below ?? 0.5)) return;
          unit.raging = true;
          unit.atk += trait.atk ?? 3;
          unit.def += trait.def ?? -3;
          payload.say?.(`${unit.id} goes berserk`);
        },
        { name: 'phase', owner: unit.id, source: 'elite' },
      ),
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit || !unit.raging) return;
          payload.flat = (payload.flat ?? 0) + (trait.damage ?? 3);
        },
        { name: 'crit', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /** Cursed: killing it costs the hero a Mind save. */
  elite_cursed(hooks, unit, trait) {
    return [
      hooks.on(
        'kill',
        (payload) => {
          if (payload.target !== unit) return;
          const hero = payload.attacker ?? payload.combat.hero;
          if (!hero?.alive) return;
          const save = rollSave(hero, trait.save ?? 'mind', trait.dc ?? dcOf(unit), payload.combat.rng);
          if (save.passed) return;
          if (applyCondition(hero, trait.condition ?? 'weakened').applied) {
            payload.say(`${hero.id} is ${trait.condition ?? 'weakened'}`);
          }
        },
        { name: 'whisper', owner: unit.id, source: 'elite' },
      ),
    ];
  },

  /** Gilded: the purse is the loot rules', and this is the note on the unit. */
  elite_gilded() {
    return [];
  },

  /** Venomous and Ironhide are numbers on the sheet, nothing to register. */
  elite_venomous() {
    return [];
  },

  elite_ironhide() {
    return [];
  },

  /**
   * The Hollow Stalker: the hero can run from it, and it comes back a
   * hundred steps later, until they leave the floor (`02` section 14).
   *
   * The returning is the step clock's — `dungeon/step-clock.js` counts the
   * steps — so what the fight has to know is only that it happened.
   */
  returns(hooks, unit, trait) {
    return [
      hooks.on(
        'combatEnd',
        (payload) => {
          if (!unit.fled && unit.alive) return;
          payload.combat.stalkerReturnsIn = unit.alive ? trait.afterSteps ?? 100 : null;
        },
        { name: 'loot', owner: unit.id, source: 'wanderer' },
      ),
    ];
  },
};

/** A monster's own effect DC, for a trait that does not name one. */
function dcOf(unit) {
  return 10 + Math.floor((unit.hd ?? 1) / 2);
}
