/**
 * The traits that belong to one boss each (`02` sections 4 to 13).
 *
 * They live apart from `monster-traits.js` because every one of them is about
 * the shape of a *fight* rather than the shape of a monster: a body that
 * cannot be reached while its heads live, a book that takes half damage while
 * its wraiths stand, a lich that re-forms while its phylactery is whole.
 *
 * Each is a hook owned by its unit, registered the same way, and listed in
 * the same `TRAITS` table the data check reads.
 */
import { applyCondition, has } from './conditions.js';
import { countedEnemies, place, toUnit } from './field.js';
import { makeMonster } from '../data/monsters.js';
import { parsePart, resolveDamage } from './damage.js';
import { registerFor } from './monster-traits.js';
import { BOSSES } from '../data/bosses.js';

/** Living units of one kind, which is how a part or an escort is counted. */
function kindOf(combat, kind) {
  return combat.units.filter(
    (unit) => unit.side === 'monsters' && unit.alive && unit.type === kind,
  );
}

/** @type {Record<string, (hooks: any, unit: object, trait: object) => (() => void)[]>} */
export const BOSS_TRAITS = {
  /**
   * The Rat King: it stays in the Back row while any rat stands, squeaking
   * orders — every rat +1 ATK — and steps forward once the swarm is gone
   * (`02` section 4).
   */
  hiding_in_swarm(hooks, unit, trait) {
    // Who has had the bonus is written on the rat, not kept here, so a fight
    // picked up from a save never hands it out twice (`05` section 11).
    const lead = (combat) => {
      const rats = kindOf(combat, trait.kin ?? 'giant_rat');
      for (const rat of rats) {
        if ((rat.ledBy ?? []).includes(unit.id)) continue;
        rat.ledBy = [...(rat.ledBy ?? []), unit.id];
        rat.atk += trait.bonus ?? 1;
      }
      // Anchored only while at least one rat stands (`06` section 13).
      const hiding = rats.length > 0;
      unit.anchored = hiding;
      if (!hiding && unit.row !== 'front') {
        unit.row = 'front';
        unit.steppedForward = true;
      }
      return hiding;
    };
    return [
      hooks.on('combatStart', (payload) => lead(payload.combat), { name: 'swarm', owner: unit.id, source: 'boss' }),
      hooks.on('roundStart', (payload) => lead(payload.combat), { name: 'swarm', owner: unit.id, source: 'boss' }),
      hooks.on(
        'kill',
        (payload) => {
          if (payload.target?.type !== (trait.kin ?? 'giant_rat')) return;
          if (lead(payload.combat) === false && unit.steppedForward) {
            payload.say?.(`${unit.id} steps forward`);
            unit.steppedForward = false;
          }
        },
        { name: 'swarm', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /** Grukk: below half, he hits harder and guards less (`02` section 6). */
  royal_temper(hooks, unit, trait) {
    return [
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit || unit.tempered) return;
          if (unit.hp > (unit.maxHp ?? 0) * (trait.below ?? 0.5)) return;
          unit.tempered = true;
          unit.atk += trait.atk ?? 2;
          unit.def += trait.def ?? -2;
          unit.damageBonus = (unit.damageBonus ?? 0) + (trait.damage ?? 2);
          payload.say?.(`${unit.id} loses his temper`);
        },
        { name: 'phase', owner: unit.id, source: 'boss' },
      ),
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit || !unit.tempered) return;
          payload.flat = (payload.flat ?? 0) + (trait.damage ?? 2);
        },
        { name: 'crit', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /**
   * Grukk: at a quarter he offers a bribe, and the fight stops for the
   * hero's answer (`02` section 6). Nothing is decided here — the offer is
   * put on the combat and the screen asks.
   */
  cowards_gold(hooks, unit, trait) {
    return [
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit || unit.begged) return;
          if (unit.hp > (unit.maxHp ?? 0) * (trait.below ?? 0.25)) return;
          unit.begged = true;
          payload.combat.offer = {
            from: unit.id,
            kind: 'cowardsGold',
            gold: trait.gold ?? 200,
            // Accepting is gold and no XP; refusing is the rest of the fight.
            accept: 'gold',
            refuse: 'fight',
          };
          payload.say?.(`${unit.id} begs`);
        },
        { name: 'phase', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /**
   * The Hydra: its body cannot be reached in melee while three heads live.
   * Ranged attacks and spells can hit it at any time (`02` section 8).
   */
  shielded_body(hooks, unit, trait) {
    return [
      hooks.on(
        'beforeAction',
        (payload) => {
          if (payload.phase !== 'redirect' || payload.target !== unit) return;
          if ((payload.attack?.kind ?? 'melee') !== 'melee') return;
          const heads = kindOf(payload.combat, trait.part ?? 'hydra_head').length;
          if (heads < (trait.meleeBlockedWhile ?? 3)) return;
          // The blow finds a head instead of the body it was aimed at.
          const head = kindOf(payload.combat, trait.part ?? 'hydra_head')[0];
          if (head) payload.target = head;
        },
        { name: 'guardian', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /**
   * The Hydra: a severed head grows back double at the end of the round,
   * unless the stump took fire or cold that round — or a lit torch found it
   * (`02` section 8, and section 2's *Torches as Tools*).
   */
  regrowth(hooks, unit, trait) {
    const kind = trait.part ?? 'hydra_head';
    return [
      hooks.on(
        'kill',
        (payload) => {
          if (payload.target?.type !== kind) return;
          const burned = (payload.target.lastDamageTypes ?? []).some((type) =>
            (trait.stoppedBy ?? ['fire', 'cold']).includes(type),
          );
          if (burned) {
            payload.target.cauterized = true;
            payload.say?.(`${payload.target.id} is seared shut`);
            return;
          }
          unit.stumps = (unit.stumps ?? 0) + 1;
        },
        { name: 'rowMovement', owner: unit.id, source: 'boss' },
      ),
      hooks.on(
        'roundEnd',
        (payload) => {
          const combat = payload.combat;
          const stumps = unit.stumps ?? 0;
          unit.stumps = 0;
          if (!unit.alive || stumps === 0) return;

          for (let i = 0; i < stumps; i += 1) {
            const living = kindOf(combat, kind).length;
            const room = (trait.max ?? 5) - living;
            for (let grown = 0; grown < Math.min(trait.grows ?? 2, room); grown += 1) {
              const ordinal = combat.units.filter((one) => one.type === kind).length;
              const head = toUnit(makeMonster(kind, { floor: combat.floor ?? 5 }), 'monsters', ordinal);
              head.part = true;
              head.partOf = unit.type;
              head.init = unit.init;
              if (!place(combat, head).placed) break;
              registerFor(combat, head);
              payload.say?.(`${head.id} grows`);
            }
          }
        },
        { name: 'regrowth', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /** The Hydra: killing the body kills every head (`02` section 8). */
  one_body(hooks, unit, trait) {
    return [
      hooks.on(
        'kill',
        (payload) => {
          if (payload.target !== unit) return;
          for (const head of kindOf(payload.combat, trait.part ?? 'hydra_head')) {
            head.alive = false;
            head.hp = 0;
          }
          payload.say?.(`${unit.id} goes still`);
        },
        { name: 'rowMovement', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /**
   * The Forge Colossus: below half it glows — every hit carries fire, and the
   * heat alone costs the hero a round (`02` section 10).
   */
  stoke_the_furnace(hooks, unit, trait) {
    return [
      hooks.on(
        'damageTaken',
        (payload) => {
          if (payload.target !== unit || unit.stoked || unit.cooled) return;
          if (unit.hp > (unit.maxHp ?? 0) * (trait.below ?? 0.5)) return;
          unit.stoked = true;
          payload.say?.(`${unit.id} glows red`);
        },
        { name: 'phase', owner: unit.id, source: 'boss' },
      ),
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.attacker !== unit || !unit.stoked) return;
          payload.parts.push(parsePart(trait.dice ?? '1d6', { type: trait.damageType ?? 'fire', extra: true }));
        },
        { name: 'backstab', owner: unit.id, source: 'boss' },
      ),
      hooks.on(
        'turnStart',
        (payload) => {
          if (payload.phase !== 'start' || !unit.stoked || !unit.alive) return;
          if (payload.unit?.side !== 'hero') return;
          const dealt = resolveDamage(payload.combat, {
            attacker: unit,
            target: payload.unit,
            attack: {
              name: 'the heat',
              kind: 'aura',
              damage: `${trait.auraDice ?? '1d4'} ${trait.damageType ?? 'fire'}`,
              noAttributeDamage: true,
            },
          });
          payload.damage = [...(payload.damage ?? []), { from: unit.id, amount: dealt?.total ?? 0 }];
        },
        { name: 'burning', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /**
   * The Forge Colossus: breaking a valve stuns it for a round and puts the
   * furnace out. Each valve works once (`02` section 10).
   */
  coolant_valves(hooks, unit, trait) {
    return [
      hooks.on(
        'kill',
        (payload) => {
          if (payload.target?.type !== (trait.object ?? 'coolant_valve')) return;
          if (payload.target.spent) return;
          payload.target.spent = true;
          applyCondition(unit, 'stunned', { rounds: trait.stunRounds ?? 1 });
          unit.stoked = false;
          unit.cooled = true;
          payload.say?.(`${unit.id} is doused`);
        },
        { name: 'rowMovement', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /** The Bound Grimoire: half damage while any Ink Wraith stands. */
  warded_binding(hooks, unit, trait) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== unit) return;
          if (kindOf(payload.combat, trait.part ?? 'ink_wraith').length === 0) return;
          payload.allPartsMultiplier = (payload.allPartsMultiplier ?? 1) * (trait.share ?? 0.5);
        },
        { name: 'resistance', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /** The Grimoire turns a page at the start of every round (`02` section 11). */
  turn_the_page(hooks, unit, trait) {
    return [
      hooks.on(
        'roundStart',
        (payload) => {
          if (!unit.alive) return;
          payload.combat.pageTurner?.(payload.combat, unit, trait);
        },
        { name: 'page', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /**
   * Read Ahead: a hero with Lore or INT 15+ sees the page a round early,
   * which is what makes an unreadable book readable (`02` section 11).
   */
  read_ahead(hooks, unit, trait) {
    return [
      hooks.on(
        'roundStart',
        (payload) => {
          const hero = payload.combat.hero;
          const reads =
            (hero?.attributes?.intellect ?? 0) >= (trait.needsIntellect ?? 15) ||
            (hero?.skills ?? []).some((row) => row.id === (trait.skill ?? 'lore'));
          unit.pageShown = reads ? unit.page : null;
        },
        { name: 'page', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /** The Phylactery takes half damage while the Lich stands (`02` section 12). */
  warded_vessel(hooks, unit, trait) {
    return [
      hooks.on(
        'damageCalc',
        (payload) => {
          if (payload.target !== unit) return;
          const lich = countedEnemies(payload.combat).find(
            (one) => one.alive && one.type === (trait.owner ?? 'malgorath'),
          );
          if (!lich) return;
          payload.allPartsMultiplier = (payload.allPartsMultiplier ?? 1) * (trait.share ?? 0.5);
        },
        { name: 'resistance', owner: unit.id, source: 'boss' },
      ),
    ];
  },

  /**
   * Malgorath: while the Phylactery is whole he cannot be killed — he
   * re-forms at full HP the next round, every time (`02` section 12).
   */
  undying_vessel(hooks, unit, trait) {
    return [
      hooks.on(
        'zeroHP',
        (payload) => {
          if (payload.unit !== unit) return;
          // An object is not a counted enemy (`06` section 13), so the
          // vessel is looked for among everything that is standing there.
          const vessel = payload.combat.units.find(
            (one) => one.type === (trait.object ?? 'phylactery') && one.alive,
          );
          if (!vessel) return;
          // He falls, stays gone through the round after, and stands up
          // whole at his vessel: that round is the window `02` gives the hero,
          // when the Phylactery takes full damage and nothing stands in front
          // of it (docs/DECISIONS.md).
          payload.fallen = true;
          payload.fallenFor = {
            rounds: trait.gone ?? 2,
            hp: unit.maxHp,
            untargetable: true,
            row: BOSSES[unit.type]?.row ?? unit.row,
          };
        },
        { name: 'reform', owner: unit.id, source: 'boss' },
      ),
    ];
  }
};
