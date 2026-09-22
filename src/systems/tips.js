/**
 * Floor 1's onboarding tips (`00`, Build phases: "onboarding tips on floor 1";
 * `docs/TASKS.md`: "one system per room"; docs/DECISIONS.md: one short
 * sentence per first-time event).
 *
 * The first time the hero meets a system on floor 1 — moving, the Waystone,
 * a door, a chest, a trap, searching — the log says one sentence about it,
 * once a game. A room teaches one system: once it has given a tip, nothing
 * else is taught until the hero walks into another room, and whatever they
 * met in the meantime is taught the next time it comes up. A fight teaches at
 * most one thing too.
 *
 * Which tips have been seen lives in the town, so it is saved with the game.
 * No DOM.
 */
import rules from '../data/tips.json' with { type: 'json' };

export const TIP_FLOORS = rules.floors;

/** The town's record of what has been taught, made on first use. */
export function tipState(town) {
  if (!town) return { seen: [] };
  town.tips ??= { seen: [] };
  return town.tips;
}

/** True when this tip has not been given in this game. */
function fresh(state, id) {
  return !state.seen.includes(id);
}

/**
 * The exploration tip these events and this moment call for, most specific
 * first, or null. It does not know about rooms; `offer` does.
 *
 * @param {object[]} events what the action produced
 * @param {{ context?: string, chestAhead?: boolean, doorAhead?: object | null, hero?: object }} here
 */
export function exploreTip(events, here = {}) {
  const has = (type, test = () => true) => events.some((event) => event.type === type && test(event));
  const candidates = [
    has('arrived') && 'move',
    (has('trapSprung') || has('searched', (event) => event.found)) && 'trap',
    here.chestAhead && 'chest',
    (has('blocked', (event) => ['stuck', 'locked', 'keyed', 'sealed', 'barred'].includes(event.looksLike)) ||
      (here.doorAhead && here.doorAhead.kind !== 'open')) &&
      'door',
    has('hazardFound') && 'hazard',
    (has('attuned') || has('waystone')) && 'waystone',
    has('safeRoom') && 'safeRoom',
    has('stairs', (event) => event.direction === 'down') && 'stairs',
    has('wanderingCheck') && 'wandering',
    here.hero && (here.hero.hp ?? 0) < (here.hero.maxHp ?? 1) * rules.hurtBelow && 'hurt',
    here.context === 'search' && 'search',
  ];
  return candidates.filter(Boolean);
}

/**
 * Offers one exploration tip, if the floor, the room and the game allow it.
 *
 * @param {object} options
 * @param {object} options.state the town's tip record
 * @param {object} options.room where the hero is teaching-wise: `{ current, tipped }`
 * @param {number} options.floor
 * @param {string | null} options.roomId the room the hero stands in, if any
 * @param {object[]} options.events
 * @param {object} [options.here]
 * @returns {string | null} the tip given
 */
export function offer({ state, room, floor, roomId, events, here }) {
  if (!TIP_FLOORS.includes(floor)) return null;
  // Walking into another room opens it for teaching; a corridor belongs to
  // the room the hero last came out of.
  if (roomId && roomId !== room.current) {
    room.current = roomId;
    room.tipped = false;
  }
  if (room.tipped) return null;
  const tip = exploreTip(events, here).find((id) => fresh(state, id));
  if (!tip) return null;
  state.seen.push(tip);
  room.tipped = true;
  return tip;
}

/**
 * The fight tip for this moment, if the fight has not taught one yet: a
 * slime on the field, the first fight at all, a wind-up coming, or a hero
 * hurt in a fight they could run from.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {object} options.combat
 * @param {'start' | 'turn'} options.moment
 * @returns {string | null}
 */
export function fightTip({ state, combat, moment }) {
  if (!state || combat.tipGiven || !TIP_FLOORS.includes(combat.floor)) return null;
  const monsters = combat.units.filter((unit) => unit.side === 'monsters' && unit.alive && !unit.object);
  const hero = combat.hero;
  const candidates =
    moment === 'start'
      ? [monsters.some((unit) => rules.slimeTypes.includes(unit.type)) && 'slime', 'fight']
      : [
          monsters.some((unit) => unit.telegraph) && 'telegraph',
          !combat.boss && (hero.hp ?? 0) < (hero.maxHp ?? 1) * rules.hurtBelow && 'flee',
        ];
  const tip = candidates.filter(Boolean).find((id) => fresh(state, id));
  if (!tip) return null;
  state.seen.push(tip);
  combat.tipGiven = tip;
  return tip;
}
