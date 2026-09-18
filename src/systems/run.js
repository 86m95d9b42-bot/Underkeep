/**
 * The run: one game in progress, and everything the Exploration screen acts on.
 *
 * The screen presses a key; this module resolves the move, winds the step
 * clock, and hands back the events and the log lines they produced. Nothing
 * here touches the DOM, so the same calls drive a test or the balance simulator
 * (CLAUDE.md, "Architecture rules").
 *
 * Order of operations is the one CLAUDE.md sets out and `05` section 11
 * requires: resolve, commit, then let the screen animate what already happened.
 * The save layer is Phase 8; when it arrives it writes at the end of `press`,
 * before the screen is told anything.
 */
import { buildFloor } from '../dungeon/floor-builder.js';
import {
  createExploration,
  resolveMove,
  commitMove,
  contextFor,
  arrivalEvents,
  lookAhead,
  whatIsAt,
  clearHazard,
  openDoor,
  COMMANDS,
} from '../dungeon/movement.js';
import { tick, inSafeZone, costOf, rollNoiseCheck } from '../dungeon/step-clock.js';
import { remember } from '../dungeon/automap.js';
import { bestWay, waysToOpen, tryOpen, stepsFor, bashTn } from './locks.js';
import { layoutStream, carriedStreams } from '../engine/rng.js';
import { t } from '../data/strings.js';

/**
 * A stand-in hero so the bars have something to show. Real attributes, derived
 * stats and origins are Phase 4 (`01` sections 2–4); nothing reads these
 * numbers but the HP and FP meters.
 */
export const PLACEHOLDER_HERO = Object.freeze({
  name: 'Harrow',
  level: 1,
  hp: 12,
  maxHp: 12,
  fp: 4,
  maxFp: 4,
});

/** How many log lines are kept. The resume flow needs the last three (`05` section 13). */
export const LOG_KEPT = 40;

/**
 * The line one event puts in the log, or null when the event is not something
 * the hero would notice. An undetected trap says nothing, on purpose.
 *
 * @param {object} event
 * @returns {{ text: string, tone?: 'accent' | 'muted' | 'danger' } | null}
 */
export function lineFor(event) {
  switch (event.type) {
    case 'blocked':
      // What the hero is allowed to notice: a secret door and a one-way door
      // from behind both read as wall (`03` section 6).
      return { text: t(`explore.blocked.${event.looksLike}`), tone: 'muted' };
    case 'stairs':
      return { text: t(`explore.log.stairs.${event.direction}`) };
    case 'waystone':
      return { text: t('explore.log.waystone'), tone: 'accent' };
    case 'pit':
      return { text: t('explore.log.pit'), tone: 'danger' };
    case 'safeRoom':
      // 05 section 5: the warning given on entering the Safe Room.
      return { text: t('explore.log.safeRoom'), tone: 'accent' };
    case 'burned':
      return { text: t('explore.log.burned') };
    case 'key':
      return { text: t('explore.log.keyTaken'), tone: 'accent' };
    case 'opened':
      return {
        text: t(event.method === 'key' ? 'explore.log.keyOpen' : 'explore.log.bashOpen'),
        tone: 'accent',
      };
    case 'heldShut':
      return { text: t('explore.log.bashFail'), tone: 'muted' };
    case 'wanderingCheck':
    case 'noiseCheck':
      // Which monsters arrive is Phase 3; a failed check stays silent, as it
      // must, or the log would count out the clock for the player.
      return event.encounter ? { text: t('explore.log.wandering'), tone: 'danger' } : null;
    case 'stalkerWarning':
      return { text: t(`explore.log.stalkerWarning.${event.at}`), tone: 'danger' };
    case 'stalker':
      return { text: t('explore.log.stalker'), tone: 'danger' };
    default:
      return null;
  }
}

/**
 * The reason a shut door cannot be opened: the first thing the hero is missing.
 * `03` section 6 gives each kind exactly one way in for the minimum hero, so
 * the first unusable way is the one worth naming.
 *
 * @param {object} door
 * @param {import('../dungeon/movement.js').Exploration} ex
 * @param {object} hero
 */
export function firstReason(door, ex, hero) {
  const ways = waysToOpen(door, { keysHeld: ex.keysTaken, has: hero.has ?? {} });
  return ways.find((way) => !way.usable)?.why ?? 'shut';
}

/**
 * Starts a run on one floor.
 *
 * @param {object} options
 * @param {number} options.masterSeed
 * @param {number} [options.floor]
 * @param {object} [options.hero]
 * @param {ReturnType<typeof carriedStreams>} [options.streams] resumed streams
 */
export function createRun({ masterSeed, floor: floorNumber = 1, hero = { ...PLACEHOLDER_HERO }, streams }) {
  const rng = streams ?? carriedStreams(masterSeed);
  let floor = buildFloor(floorNumber, masterSeed, layoutStream);
  let ex = createExploration(floor);
  let wasSafe = inSafeZone(floor, ex.pos);

  /** @type {{ text: string, tone?: string }[]} oldest first */
  const log = [];

  /** @param {object[]} events */
  function record(events) {
    for (const event of events) {
      const line = lineFor(event);
      if (line) log.push(line);
    }
    if (log.length > LOG_KEPT) log.splice(0, log.length - LOG_KEPT);
    return events;
  }

  /**
   * Entering the Safe Room is worth a line, and it is the floor that knows
   * (`05` section 5). Only the crossing is announced, not every step inside.
   */
  function safeRoomEvents() {
    const safe = inSafeZone(floor, ex.pos);
    const crossed = safe && !wasSafe;
    wasSafe = safe;
    return crossed ? [{ type: 'safeRoom', at: [...ex.pos] }] : [];
  }

  /** Winds the clock by what an action cost, from where the hero now stands. */
  function spend(steps, cause) {
    return steps > 0 ? tick(floor, ex, rng.encounter, steps, { cause }) : [];
  }

  // The hero is standing on the up stairs and its waystone, so the log opens
  // with what is underfoot — the same events as walking onto the tile.
  record(arrivalEvents(floor, ex.pos, ex));
  remember(floor, ex);

  const run = {
    get masterSeed() {
      return masterSeed;
    },
    get floor() {
      return floor;
    },
    get ex() {
      return ex;
    },
    get hero() {
      return hero;
    },
    get log() {
      return log;
    },
    get rng() {
      return rng;
    },

    /** What the movement pad's centre key does here (`00`, Exploration). */
    get context() {
      return contextFor(floor, ex);
    },
    get ahead() {
      return lookAhead(floor, ex);
    },
    get here() {
      return whatIsAt(floor, ex.pos, ex);
    },

    /**
     * One press of the movement pad. Everything is resolved and committed
     * before it returns; the caller then draws it.
     * @param {keyof typeof COMMANDS} command
     */
    press(command) {
      const outcome = resolveMove(floor, ex, command);
      commitMove(ex, outcome);
      // What the hero can see from the new tile goes on the map before
      // anything else happens (`05` section 10).
      if (outcome.moved) remember(floor, ex);

      const events = [
        ...outcome.events,
        ...safeRoomEvents(),
        ...spend(outcome.cost, 'steps'),
      ];
      // A key underfoot is picked up on the way past: it belongs to the floor,
      // not to a pack, until inventory arrives in Phase 5.
      for (const event of events) if (event.type === 'key') ex.keysTaken.add(event.key.id);
      record(events);
      return { outcome, events };
    },

    /**
     * The context key.
     *
     * Two of its six actions work today, and both are what `05` section 4's
     * minimum hero can do, so every floor stays walkable: burning a web
     * curtain with a torch (`03` section 8, no roll), and opening a door by
     * bashing it or turning its key (`03` section 6). Searching, waystones and
     * fountains arrive with Phase 6 and Phase 7.
     */
    act() {
      const ahead = run.ahead;
      const at = ahead.at;

      if (run.context === 'burn') {
        clearHazard(ex, at);
        const events = [{ type: 'burned', at }, ...spend(costOf('item'), 'burn')];
        record(events);
        return { events };
      }

      const door = run.doorAhead;
      if (!door) return { events: [] };

      const outcome = tryOpen({
        door,
        floor: floor.floor,
        rng: rng.combat,
        keysHeld: ex.keysTaken,
        has: hero.has ?? {},
        bashBonus: hero.bashBonus ?? 0,
      });
      if (!outcome) return { events: [] };

      /** @type {object[]} */
      const events = [];
      if (outcome.opened) {
        openDoor(ex, at);
        events.push({ type: 'opened', at, method: outcome.method, roll: outcome.roll ?? null });
      } else {
        events.push({ type: 'heldShut', at, roll: outcome.roll, tn: outcome.tn });
      }
      // The time it took, then the noise it made: bashing is 2-in-6 to bring
      // something along (`03` section 6).
      events.push(...spend(outcome.steps, outcome.method));
      if (outcome.noisy) events.push(rollNoiseCheck(rng.encounter, 'bash'));

      record(events);
      return { events };
    },

    /** The door the hero is facing, when there is one still shut. */
    get doorAhead() {
      const ahead = run.ahead;
      if (!ahead.door) return null;
      const at = `${ahead.at[0]},${ahead.at[1]}`;
      if (ahead.door.kind === 'open' || ex.doorsOpened.has(at)) return null;
      return ahead.door;
    },

    /** How the hero would open the door ahead, if they can. */
    get openingWay() {
      const door = run.doorAhead;
      return door ? bestWay(door, { keysHeld: ex.keysTaken, has: hero.has ?? {} }) : null;
    },

    /** Why the context key is disabled, or undefined when it can be pressed. */
    get actReason() {
      if (run.context === 'burn') return undefined;
      if (run.context === 'open' && run.doorAhead) {
        // A door with no way through says which one is missing, not "later".
        const way = run.openingWay;
        return way ? undefined : t(`explore.reason.${firstReason(run.doorAhead, ex, hero)}`);
      }
      return t('common.comingSoon');
    },

    /** What the context key's second line says. */
    get actHint() {
      const way = run.openingWay;
      if (!way) return null;
      const steps = stepsFor(way.method);
      const tn = way.method === 'bash' ? bashTn(run.doorAhead, floor.floor) : null;
      return tn === null
        ? `${t(`explore.way.${way.method}`)} · ${steps}`
        : `${t(`explore.way.${way.method}`)} · TN ${tn}`;
    },

    /** Drops a line into the log by hand, for the screen's own messages. */
    say(text, tone) {
      log.push({ text, tone });
      if (log.length > LOG_KEPT) log.shift();
    },
  };

  return run;
}
