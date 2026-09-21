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
import { parsePart, resolveDamage } from './damage.js';
import { checkMorale } from './morale.js';
import { place, countedEnemies, ROWS } from './field.js';
import { resolveAttack } from './attack.js';
import { rollSave } from './riders.js';
import { BOSS_TRAITS } from './boss-traits.js';

/** Traits the documents describe but that need a system no phase has built. */
export const PENDING = {
  corrode: 'Weapon damage and repair arrive with the item database (04, Phase 5).',
  snuff: 'The hero has no torch to put out until items arrive (04, Phase 5).',
  greedy:
    "Throwing 50 gp at an ogre is an Item action the hero does not have: `04` has no \"throw gold\", and the Combat screen's Item list is built from the pack.",
  disguise:
    'A Mimic is a chest until it is opened (`03` section 7). The chest sequence already reports one and rolls its surprise; what is missing is the exploration loop starting a fight, which is where a wandering monster is missing too.',
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
  /* ---------------------------------------------------------------- */
  /* Floors 3 to 10 (`02` sections 6 to 13)                            */
  /* ---------------------------------------------------------------- */

  /**
   * Orc: "once per combat, when reduced to 0 HP, a 1-in-2 chance to keep
   * fighting at 1 HP for one more turn." Relentless with a clock: the orc
   * falls at the end of the turn it was given.
   */
  ferocity(hooks, unit, trait) {
    return [
      hooks.on(
        'zeroHP',
        (payload) => {
          if (payload.unit !== unit || unit.usedFerocity) return;
          unit.usedFerocity = true;
          if (payload.combat.rng.die(trait.oneIn ?? 2) !== 1) return;
          payload.saved = true;
          payload.savedBy = 'ferocity';
          payload.recoverTo = 0;
          unit.hp = trait.hp ?? 1;
          unit.ferocityTurns = trait.turns ?? 1;
        },
        { name: 'ferocity', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'turnEnd',
        (payload) => {
          if (payload.unit !== unit || unit.ferocityTurns === undefined) return;
          unit.ferocityTurns -= 1;
          if (unit.ferocityTurns > 0) return;
          unit.ferocityTurns = undefined;
          unit.hp = 0;
          unit.alive = false;
          payload.say?.(`${unit.id} falls`);
        },
        { name: 'ferocity', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Worg: round 1 only — +2 to hit, and a hit knocks the hero down. */
  pounce(hooks, unit, trait) {
    const inRound = (combat) => (combat?.round ?? 0) <= (trait.round ?? 1);
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase === 'judge' || payload.attacker !== unit) return;
          if (!inRound(payload.combat)) return;
          payload.bonus += trait.bonus ?? 2;
        },
        { name: 'pounce', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit || !inRound(payload.combat)) return;
          const save = rollSave(payload.target, trait.save ?? 'reflex', trait.dc ?? 11, payload.combat.rng);
          if (save.passed) return;
          if (applyCondition(payload.target, trait.condition ?? 'knockedDown').applied) {
            payload.say(`${payload.target.id} is knocked down`);
          }
        },
        { name: 'rider', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Worg: "with two or more worgs present, once per combat every goblin gets
   * +1 ATK for the rest of the fight."
   */
  howl(hooks, unit, trait) {
    return [
      hooks.on(
        'turnStart',
        (payload) => {
          if (payload.unit !== unit || payload.phase !== 'free') return;
          if (unit.howled || kin(payload.combat, unit).length + 1 < (trait.needsKin ?? 2)) return;
          unit.howled = true;
          const pack = countedEnemies(payload.combat).filter(
            (other) => other.alive && other.family === (trait.family ?? 'humanoid'),
          );
          for (const ally of pack) ally.atk += trait.bonus ?? 1;
          if (pack.length) payload.say?.(`${unit.id} howls`);
        },
        { name: 'howl', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Hobgoblin Captain: "while it's alive, all allies use Morale 10 and get
   * +1 ATK. When it dies, all allies check morale immediately."
   */
  leader(hooks, unit, trait) {
    const led = new Set();
    const lead = (combat) => {
      for (const ally of countedEnemies(combat)) {
        if (ally === unit || !ally.alive || led.has(ally.id)) continue;
        led.add(ally.id);
        ally.atk += trait.bonus ?? 1;
        ally.moraleBefore = ally.morale;
        if (ally.morale !== null) ally.morale = trait.morale ?? 10;
      }
    };
    return [
      hooks.on('combatStart', (payload) => lead(payload.combat), {
        name: 'leader',
        owner: unit.id,
        source: 'traits',
      }),
      hooks.on('roundStart', (payload) => lead(payload.combat), {
        name: 'leader',
        owner: unit.id,
        source: 'traits',
      }),
      hooks.on(
        'kill',
        (payload) => {
          if (payload.target !== unit) return;
          for (const ally of countedEnemies(payload.combat)) {
            if (ally === unit || !ally.alive) continue;
            ally.atk -= trait.bonus ?? 1;
            if (ally.moraleBefore !== undefined) ally.morale = ally.moraleBefore;
            const check = checkMorale(payload.combat, ally, 'leaderFell');
            if (check?.flees) payload.say(`${ally.id} breaks`);
          }
        },
        { name: 'morale', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Hobgoblin Captain: once a round, +2 DEF against one attack, automatic. */
  shield_block(hooks, unit, trait) {
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          // Step 8b of `06` section 6: more DEF, and the roll is compared
          // again. A natural 20 still hits, which step 6 has already settled.
          if (payload.phase !== 'judge' || payload.target !== unit) return;
          if (unit.blockedInRound === payload.combat.round) return;
          unit.blockedInRound = payload.combat.round;
          payload.bonusDef = (payload.bonusDef ?? 0) + (trait.bonus ?? 2);
        },
        { name: 'shieldBlock', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Shrieker: "at the end of each round, roll d6. On a 1-2, a wandering
   * monster group joins next round (max twice per combat)."
   *
   * What joins is the floor's own encounter table, which is what a wandering
   * group is (`02` section 16) — so the fight it calls in is the fight the
   * hero would have met anyway.
   */
  shriek(hooks, unit, trait) {
    return [
      hooks.on(
        'roundEnd',
        (payload) => {
          const combat = payload.combat;
          if (!unit.alive) return;
          unit.shrieks = unit.shrieks ?? 0;
          if (unit.shrieks >= (trait.maxTimes ?? 2)) return;
          if (combat.rng.die(6) > (trait.oneIn ?? 2)) return;
          unit.shrieks += 1;

          const joining = combat.reinforce?.(combat, { floor: combat.floor, why: 'shriek' }) ?? [];
          if (joining.length) payload.say?.(`${unit.id} shrieks`);
        },
        { name: 'shriek', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * What a monster leaves behind: the Myconid's Rot Bloom and the Zealot's
   * Martyr's Flame are the same shape — a save when it dies, damage or a
   * condition on a failure, and a killing blow that can prevent it.
   */
  death_burst(hooks, unit, trait) {
    const removers = [];
    if (trait.glowBelow) {
      removers.push(
        hooks.on(
          'damageTaken',
          (payload) => {
            if (payload.target !== unit || unit.glowing) return;
            if (unit.hp > (unit.maxHp ?? 0) * trait.glowBelow) return;
            unit.glowing = true;
            payload.say?.(`${unit.id} begins to glow`);
          },
          { name: 'martyrsFlame', owner: unit.id, source: 'traits' },
        ),
      );
    }
    removers.push(
      hooks.on(
        'kill',
        (payload) => {
          if (payload.target !== unit) return;
          const killedBy = unit.lastDamageTypes ?? [];
          if (killedBy.some((type) => (trait.unlessKilledBy ?? []).includes(type))) return;

          const hero = payload.attacker ?? payload.combat.hero;
          const save = trait.save
            ? rollSave(hero, trait.save, trait.dc ?? 11, payload.combat.rng)
            : null;

          if (trait.dice && (!save?.passed || trait.half)) {
            const attack = {
              name: trait._trait ?? 'death burst',
              kind: 'burst',
              damage: `${trait.dice}${trait.damageType ? ` ${trait.damageType}` : ''}`,
              noAttributeDamage: true,
            };
            const dealt = resolveDamage(payload.combat, {
              attacker: unit,
              target: hero,
              attack,
              allPartsMultiplier: save?.passed ? 0.5 : 1,
            });
            payload.say(`${unit.id} bursts for ${dealt?.total ?? 0}`);
          }
          if (trait.condition && !save?.passed) {
            if (applyCondition(hero, trait.condition, { dc: trait.dc }).applied) {
              payload.say(`${hero.id} is ${trait.condition}`);
            }
          }
        },
        { name: trait.dice ? 'martyrsFlame' : 'rotBloom', owner: unit.id, source: 'traits' },
      ),
    );
    return removers;
  },

  /**
   * A save the hero makes at the start of every round for standing near it:
   * the Ghast's Stench and the Basilisk's Petrifying Gaze. Defending skips
   * the gaze, and so does looking away (`02` section 13).
   */
  aura_save(hooks, unit, trait) {
    return [
      hooks.on(
        'roundStart',
        (payload) => {
          if (!unit.alive) return;
          const hero = payload.combat.hero;
          if (!hero?.alive) return;
          if (trait.skipIfDefending && hero.defending) return;
          if (trait.skipIfAverted && hero.avertedEyes) return;
          const save = rollSave(hero, trait.save ?? 'body', trait.dc ?? 12, payload.combat.rng);
          if (save.passed) return;
          if (applyCondition(hero, trait.condition, { dc: trait.dc }).applied) {
            payload.say?.(`${hero.id} is ${trait.condition}`);
          }
        },
        { name: 'aura', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Lizardfolk Warrior: "each round, a 1-in-6 chance it dives and can't be
   * targeted, then returns next round with +4 to hit."
   */
  submerge(hooks, unit, trait) {
    return [
      hooks.on(
        'turnStart',
        (payload) => {
          if (payload.unit !== unit || payload.phase !== 'free') return;
          if (unit.submerged) {
            unit.submerged = false;
            unit.untargetable = false;
            unit.surfacing = true;
            payload.say?.(`${unit.id} surfaces`);
            return;
          }
          if (payload.combat.rng.die(6) > (trait.oneIn ?? 1)) return;
          unit.submerged = true;
          unit.untargetable = true;
          payload.say?.(`${unit.id} dives`);
        },
        { name: 'submerge', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase === 'judge' || payload.attacker !== unit || !unit.surfacing) return;
          payload.bonus += trait.bonus ?? 4;
          unit.surfacing = false;
        },
        { name: 'submerge', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Giant Leech: "on a hit, it attaches. At the start of each of the hero's
   * turns, the hero takes 1d6 and the leech heals that much, until the leech
   * dies or the hero pulls it off. Attacks against a latched leech have
   * advantage."
   */
  latch(hooks, unit, trait) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit || unit.latched) return;
          unit.latched = payload.target.id;
          payload.target.latchedBy = [...(payload.target.latchedBy ?? []), unit.id];
          payload.say(`${unit.id} latches on`);
        },
        { name: 'latch', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'turnStart',
        (payload) => {
          if (payload.phase !== 'start' || !unit.alive || !unit.latched) return;
          if (payload.unit?.id !== unit.latched) return;
          const bite = payload.combat.rng.roll(trait.dice ?? '1d6');
          payload.unit.hp -= bite;
          unit.hp = Math.min(unit.maxHp ?? unit.hp, unit.hp + bite);
          payload.damage = [...(payload.damage ?? []), { from: unit.id, amount: bite }];
        },
        { name: 'latch', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase === 'judge' || payload.target !== unit || !unit.latched) return;
          payload.advantage = true;
        },
        { name: 'latch', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Stone and mist: "resistant to non-magic weapons". The Gargoyle's hide
   * lets crush through; a Wraith and a Banshee turn everything but magic
   * aside.
   */
  stone_hide(hooks, unit, trait) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== unit) return;
          if (!payload.weapon || payload.attack?.magic) return;
          const through = payload.parts?.every((part) => (trait.except ?? []).includes(part.type));
          if (through) return;
          payload.allPartsMultiplier = (payload.allPartsMultiplier ?? 1) * 0.5;
        },
        { name: 'resistance', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Gargoyle: below a quarter HP it flies to the Back row, then dives at +4. */
  take_flight(hooks, unit, trait) {
    return [
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit || unit.flown) return;
          if (unit.hp > (unit.maxHp ?? 0) * (trait.below ?? 0.25)) return;
          unit.flown = true;
          unit.row = ROWS[1];
          unit.diving = true;
          payload.say?.(`${unit.id} takes flight`);
        },
        { name: 'phase', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase === 'judge' || payload.attacker !== unit || !unit.diving) return;
          payload.bonus += trait.bonus ?? 4;
          unit.diving = false;
          unit.row = ROWS[0];
        },
        { name: 'dive', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** A critical hit that leaves something behind: Crushing Blow, Hamstring. */
  crit_rider(hooks, unit, trait) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.attacker !== unit || !payload.result?.crit) return;
          for (const condition of trait.conditions ?? []) {
            if (applyCondition(payload.target, condition).applied) {
              payload.say(`${payload.target.id} is ${condition}`);
            }
          }
        },
        { name: 'rider', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Skin that bites back: the Magma Beetle's Molten Shell and the
   * Salamander's Heat Aura. Only a melee hit sets it off, and the beetle's
   * shell only answers metal.
   */
  retaliate(hooks, unit, trait) {
    return [
      hooks.on(
        'hit',
        (payload) => {
          if (payload.target !== unit) return;
          const attacker = payload.attacker;
          if (!attacker || attacker === unit) return;
          if ((payload.attack?.kind ?? 'melee') !== 'melee') return;
          if (trait.needsMetal && payload.attack?.metal === false) return;

          const dealt = resolveDamage(payload.combat, {
            attacker: unit,
            target: attacker,
            attack: {
              name: trait._trait ?? 'heat',
              kind: 'aura',
              damage: `${trait.dice ?? '1d4'} ${trait.damageType ?? 'fire'}`,
              noAttributeDamage: true,
            },
          });
          payload.say(`${attacker.id} is burned for ${dealt?.total ?? 0}`);
        },
        { name: 'retaliate', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Animated Armor: "no vital organs, so Backstab and Death Strike deal only
   * normal damage." The skills mark the dice they add, so the shell drops
   * exactly those.
   */
  empty_shell(hooks, unit) {
    // The flag is for the skills themselves: Backstab and Death Strike are
    // `04`'s, and each marks the dice it adds as `vital` so this can drop
    // them. Until then the filter finds nothing, which is the same answer.
    unit.noVitals = true;
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== unit) return;
          payload.parts = (payload.parts ?? []).filter((part) => !part.vital);
        },
        { name: 'backstab', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Dark Mage: below half HP, attacks against it miss half the time. */
  blink(hooks, unit, trait) {
    return [
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit || unit.blinkUntil !== undefined) return;
          if (unit.hp > (unit.maxHp ?? 0) * (trait.below ?? 0.5)) return;
          unit.blinkUntil = (payload.combat.round ?? 0) + (trait.rounds ?? 3);
          payload.say?.(`${unit.id} blinks`);
        },
        { name: 'phase', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'attackRoll',
        (payload) => {
          // Step 8c: a blow that had landed simply does not (`06` section 6).
          if (payload.phase !== 'judge' || payload.target !== unit || !payload.hit) return;
          if (unit.blinkUntil === undefined || (payload.combat.round ?? 0) > unit.blinkUntil) return;
          if (!payload.combat.rng.chance(trait.missChance ?? 0.5)) return;
          payload.hit = false;
        },
        { name: 'blink', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Dark Mage: once per combat, one of the hero's spells simply fails. */
  counterspell(hooks, unit, trait) {
    return [
      hooks.on(
        'beforeAction',
        (payload) => {
          if (payload.phase !== 'action' || unit.counterspelled) return;
          if (!unit.alive || payload.unit === unit) return;
          if (!(payload.tags ?? []).includes('spell')) return;
          unit.counterspelled = true;
          payload.cancelled = true;
          payload.cancelledBy = 'counterspell';
        },
        { name: 'counterspell', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Banshee: it has advantage on a hero who is already Feared. */
  advantage_vs(hooks, unit, trait) {
    return [
      hooks.on(
        'attackRoll',
        (payload) => {
          if (payload.phase === 'judge' || payload.attacker !== unit) return;
          if (has(payload.target, trait.condition)) payload.advantage = true;
        },
        { name: 'rider', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Ashbound Knight: "once per round, when the hero targets a Back-row ally,
   * the knight intercepts and takes the attack instead."
   */
  guardian(hooks, unit, trait) {
    return [
      hooks.on(
        'beforeAction',
        (payload) => {
          if (payload.phase !== 'redirect' || !unit.alive) return;
          if (payload.attacker === unit || payload.target === unit) return;
          if (payload.target?.side !== unit.side || payload.target?.row !== ROWS[1]) return;
          if (unit.guardedInRound === payload.combat.round) return;
          if (payload.attack?.area) return;
          unit.guardedInRound = payload.combat.round;
          payload.target = unit;
        },
        { name: 'guardian', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /** Troll: 5 HP a round, unless fire or holy found it since its last turn. */
  regeneration(hooks, unit, trait) {
    return [
      hooks.on(
        'turnStart',
        (payload) => {
          if (payload.unit !== unit || payload.phase !== 'start') return;
          if (!unit.alive || unit.hp >= (unit.maxHp ?? 0)) return;
          const since = unit.damagedSinceTurn ?? [];
          if (since.some((type) => (trait.stoppedBy ?? []).includes(type))) {
            unit.damagedSinceTurn = [];
            return;
          }
          unit.damagedSinceTurn = [];
          const healed = Math.min((unit.maxHp ?? 0) - unit.hp, trait.hp ?? 5);
          unit.hp += healed;
          payload.healing = (payload.healing ?? 0) + healed;
        },
        { name: 'regeneration', owner: unit.id, source: 'traits' },
      ),
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit) return;
          unit.damagedSinceTurn = [
            ...(unit.damagedSinceTurn ?? []),
            ...(payload.damage?.parts ?? []).map((part) => part.type).filter(Boolean),
          ];
        },
        { name: 'regeneration', owner: unit.id, source: 'traits' },
      ),
    ];
  },

  /**
   * Troll: "at 0 HP it falls, then gets back up after 3 rounds with 10 HP,
   * unless it's burned." The engine owns the Fallen state (`06` section 9);
   * this is the trait that asks for it.
   */
  wont_stay_down(hooks, unit, trait) {
    return [
      hooks.on(
        'zeroHP',
        (payload) => {
          if (payload.unit !== unit) return;
          const killedBy = unit.lastDamageTypes ?? [];
          if (killedBy.some((type) => ['fire', 'holy'].includes(type))) return;
          payload.fallen = true;
          payload.fallenFor = { rounds: trait.rounds ?? 3, hp: trait.hp ?? 10 };
        },
        { name: 'wontStayDown', owner: unit.id, source: 'traits' },
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
          const result = resolveAttack(payload.combat, other, {
            id: 'attack',
            kind: ability.kind ?? 'ranged',
            bonus: (other.atk ?? 0) + (ability.bonus ?? 0),
            damage: ability.damage,
            ability: ability.id,
          });
          // Somebody else's arrow is still something the player watched
          // happen, so the turn records it and the log says so.
          payload.alsoResolved ??= [];
          payload.alsoResolved.push({ by: other, action: 'attack', result });
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
    const register = TRAITS[trait.id] ?? BOSS_TRAITS[trait.id];
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
