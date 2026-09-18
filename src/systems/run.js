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
  COMMANDS,
} from '../dungeon/movement.js';
import { tick, inSafeZone, costOf } from '../dungeon/step-clock.js';
import { remember } from '../dungeon/automap.js';
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
      record(events);
      return { outcome, events };
    },

    /**
     * The context key. Burning a web curtain is the one action of the six that
     * Phase 2 can finish: a lit torch does it with no roll (`03` section 8).
     * The rest — opening, searching, waystones, fountains — are Phase 6 and
     * Phase 7, and `canAct` says so.
     */
    act() {
      if (run.context !== 'burn') return { events: [] };
      const at = run.ahead.at;
      clearHazard(ex, at);
      const events = [{ type: 'burned', at }, ...spend(costOf('item'), 'burn')];
      record(events);
      return { events };
    },

    /** Why the context key is disabled, or undefined when it can be pressed. */
    get actReason() {
      return run.context === 'burn' ? undefined : t('common.comingSoon');
    },

    /** Drops a line into the log by hand, for the screen's own messages. */
    say(text, tone) {
      log.push({ text, tone });
      if (log.length > LOG_KEPT) log.shift();
    },
  };

  return run;
}
