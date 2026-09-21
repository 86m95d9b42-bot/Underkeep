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
import { buildFloor, isWalkable } from '../dungeon/floor-builder.js';
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
import { tick, inSafeZone, inDarkness, costOf, rollNoiseCheck, wanderingBonus } from '../dungeon/step-clock.js';
import { remember } from '../dungeon/automap.js';
import { bestWay, waysToOpen, tryOpen, stepsFor, bashTn, searchSecret } from './locks.js';
import { layoutStream, carriedStreams } from '../engine/rng.js';
import { t } from '../data/strings.js';
import { attune, whyNotLeaveByStone } from './travel.js';
import { applyMemory, memoryFor, restockFloor } from './floor-memory.js';
import { search as searchTrap, trigger as fireTrap } from './traps.js';
import {
  disarmTrap,
  inspect as inspectChest,
  isArmed,
  isLocked,
  open as openChest,
  poleTrap,
  unlock as unlockChest,
  whyNotOpen,
} from './chests.js';
import { takeAll } from './loot.js';
import { ITEMS } from '../data/items.js';
import { nameOf } from './identification.js';

/** A tile's key in the floor's side tables. */
const key = (x, y) => `${x},${y}`;

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
    case 'attuned':
      return { text: t('explore.log.attuned'), tone: 'accent' };
    case 'waystoneTravel':
      return { text: t('explore.log.waystoneTravel'), tone: 'accent' };
    case 'secretFound':
      return { text: t('explore.log.secretFound'), tone: 'accent' };
    case 'jammed':
      return { text: t('explore.log.jammed'), tone: 'danger' };
    case 'picksBroke':
      return { text: t('explore.log.picksBroke'), tone: 'danger' };
    case 'backlash':
      return { text: t('explore.log.backlash'), tone: 'danger' };
    case 'earned':
      return { text: t('explore.log.earned', { n: event.xp }), tone: 'accent' };
    case 'trapSprung':
      return {
        text: t('explore.log.trapSprung', {
          name: t(`traps.${event.trap?.kind ?? 'alarm_chime'}.name`),
          n: event.trap?.damage ?? 0,
        }),
        tone: 'danger',
      };
    case 'searched':
      if (!event.found) return { text: t('explore.log.foundNothing'), tone: 'muted' };
      return {
        text: event.exact
          ? t('explore.log.foundTrapExact', { name: t(`traps.${event.trap.kind}.name`) })
          : t('explore.log.foundTrap'),
        tone: 'danger',
      };
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
    case 'unlocked':
      return { text: t('explore.log.chestUnlocked'), tone: 'accent' };
    case 'lockHeld':
      return { text: t('explore.log.chestHeld'), tone: 'muted' };
    case 'disarmed':
      return { text: t('explore.log.disarmed'), tone: 'accent' };
    case 'disarmFailed':
      return { text: t('explore.log.disarmFailed'), tone: 'muted' };
    case 'poled':
      return { text: t('explore.log.poled') };
    case 'poleBroke':
      return { text: t('explore.log.poleBroke'), tone: 'danger' };
    case 'salvaged':
      return { text: t('explore.log.salvaged', { name: ITEMS[event.item]?.name ?? event.item }), tone: 'accent' };
    case 'mimicSeen':
      return { text: t('explore.log.mimicSeen'), tone: 'danger' };
    case 'mimic':
      return { text: t(event.surprise ? 'explore.log.mimicSurprise' : 'explore.log.mimic'), tone: 'danger' };
    case 'chestOpened':
      return {
        text: event.gold > 0
          ? t('explore.log.chestGold', { n: event.gold })
          : t('explore.log.chestEmpty'),
        tone: 'accent',
      };
    case 'took':
      return { text: t('explore.log.took', { name: event.name }), tone: 'accent' };
    case 'packFull':
      return { text: t('explore.log.packFull'), tone: 'danger' };
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
 * @param {{ at: [number, number], facing?: string }} [options.startAt] a Return
 *   Mark, or anywhere else a trip begins that is not the arrival room
 * @param {object} [options.town] what the trip attunes and comes home to
 * @param {(options?: object) => void} [options.leaveDungeon] the way up, which
 *   the session owns: a Waystone offers it, `travel.js` does it
 */
export function createRun({
  masterSeed,
  floor: floorNumber = 1,
  hero = { ...PLACEHOLDER_HERO },
  streams,
  startAt,
  town,
  leaveDungeon,
}) {
  const rng = streams ?? carriedStreams(masterSeed);
  let floor = buildFloor(floorNumber, masterSeed, layoutStream);

  // What the hero left here last time, and what has come back since
  // (`05` section 8). A floor with no town behind it is a fresh one, which is
  // what the tools and the tests build.
  const memory = town ? memoryFor(town, floorNumber) : null;
  if (memory) {
    restockFloor({ floor, memory, town, masterSeed, isWalkable });
    applyMemory(floor, memory);
    memory.visits += 1;
    // The hero is here today, so today is not a return they missed.
    memory.restockedOnDay = town.day;
  }

  let ex = createExploration(floor, memory);
  // A trip that begins at a Return Mark begins where the scroll was read
  // (`05` section 9), not in the arrival room.
  if (startAt?.at) {
    ex.pos = [...startAt.at];
    if (startAt.facing) ex.facing = startAt.facing;
  }
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

  /** `03` section 6: MIG mod + Brute Force + a crowbar. */
  function bashBonusOf() {
    return hero.bashBonus ?? (hero.mods?.might ?? 0) + (hero.explore?.bash ?? 0);
  }

  /** Winds the clock by what an action cost, from where the hero now stands. */
  function spend(steps, cause) {
    // A Beacon curse widens the wandering check (`04` section 6).
    const bonus = wanderingBonus(hero);
    return steps > 0 ? tick(floor, ex, rng.encounter, steps, { cause, bonus }) : [];
  }

  // The hero is standing on the up stairs and its waystone, so the log opens
  // with what is underfoot — the same events as walking onto the tile.
  const arriving = arrivalEvents(floor, ex.pos, ex);
  // Arriving on the stone is standing on it (`05` section 9).
  if (town && arriving.some((event) => event.type === 'waystone')) attune(town, floor.floor);
  record(arriving);
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
      // Stepping on a Waystone attunes it, permanently (`05` section 9).
      for (const event of events) {
        if (event.type !== 'waystone' || !town) continue;
        if (attune(town, floor.floor).attuned) events.push({ type: 'attuned', floor: floor.floor });
      }
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
    act({ careful = false, method } = {}) {
      const ahead = run.ahead;
      const at = ahead.at;

      // A Waystone the hero has attuned offers a free trip to town
      // (`05` section 9). It is not a step and it costs nothing.
      if (run.context === 'touch') {
        const why = whyNotLeaveByStone(town, run);
        if (why) return { events: [] };
        record([{ type: 'waystoneTravel', floor: floor.floor }]);
        leaveDungeon?.({ leaveMark: false, by: 'waystone' });
        return { events: [{ type: 'waystoneTravel', floor: floor.floor }], left: true };
      }

      // SEARCH (`03` section 3): the hero's own tile, the one ahead, and the
      // door or chest in front of them. One Search and one Careful Search
      // each, and what is found is marked on the floor.
      if (run.context === 'search') {
        const events = [];
        const targets = [
          floor.traps?.[key(...ex.pos)],
          floor.traps?.[key(...at)],
          ahead.chest?.trap,
          floor.secrets?.[key(...at)],
        ].filter(Boolean);

        for (const entry of targets) {
          // A secret door is found with the traps' own roll against 12 + F
          // (`03` section 6, Secret Doors).
          if (entry.kind === undefined && entry.at !== undefined) {
            if (entry.found || ex.secretsFound.has(key(...entry.at))) continue;
            const seen = searchSecret(rng.combat, hero, entry, floor.floor, { careful: Boolean(careful) });
            if (seen.found) {
              ex.secretsFound.add(key(...entry.at));
              events.push({ type: 'secretFound', at: entry.at, xp: seen.xp });
            }
            continue;
          }
          if (!entry.kind) continue;
          const found = searchTrap(rng.combat, hero, entry, floor.floor, {
            careful: Boolean(careful),
            dark: inDarkness(floor, ex.pos),
          });
          if (found.why) continue;
          events.push({ type: 'searched', found: found.found, exact: found.exact, trap: entry });
        }
        if (events.length === 0) events.push({ type: 'searched', found: false, exact: false });
        events.push(...spend(costOf(careful ? 'carefulSearch' : 'search'), 'search'));
        record(events);
        return { events };
      }

      if (run.context === 'burn') {
        clearHazard(ex, at);
        const events = [{ type: 'burned', at }, ...spend(costOf('item'), 'burn')];
        record(events);
        return { events };
      }

      const door = run.doorAhead;
      // A chest has a screen of its own (`03` section 7, "The Chest
      // Sequence"): the context key opens it rather than resolving anything
      // here, because every step of the sequence is a choice.
      if (!door) return run.chestAhead ? { events: [], openChest: true } : { events: [] };

      const outcome = tryOpen({
        door,
        floor: floor.floor,
        rng: rng.combat,
        keysHeld: ex.keysTaken,
        has: hero.has ?? {},
        hero,
        // The walk harness sets its own on the stand-in hero, and keeps it.
        bashBonus: bashBonusOf(),
        method,
      });
      if (!outcome) return { events: [] };

      /** @type {object[]} */
      const events = [];
      if (outcome.opened) {
        openDoor(ex, at);
        events.push({ type: 'opened', at, method: outcome.method, roll: outcome.roll ?? null });
        if (outcome.xp) events.push({ type: 'earned', xp: outcome.xp, why: outcome.method });
        // A Skeleton Key is spent on the door it opens (`04` section 11).
        if (outcome.usedUp) events.push({ type: 'usedUp', item: 'skeleton_key' });
      } else {
        events.push({ type: 'heldShut', at, roll: outcome.roll, tn: outcome.tn });
      }

      // What went wrong with a pick, and what a ward does to the hero who
      // fails to lift it (`03` section 6).
      if (outcome.jammed) events.push({ type: 'jammed', at });
      if (outcome.broke) events.push({ type: 'picksBroke' });
      if (outcome.backlash) events.push({ type: 'backlash', ...outcome.backlash });

      // `03` section 5: a door trap goes off when the door is opened, bashed,
      // or when a pick fails by 5 or more.
      const doorTrap = floor.traps?.[at];
      const fires = outcome.springsTrap || (outcome.opened && outcome.method !== 'key');
      if (doorTrap?.kind && !doorTrap.disarmed && !doorTrap.sprung && fires) {
        const went = fireTrap(
          { rng: rng.combat },
          hero,
          doorTrap,
          floor.floor,
          { detected: doorTrap.found },
        );
        events.push({ type: 'trapSprung', at, by: outcome.method, trap: went });
      }

      // The time it took, then the noise it made: bashing is 2-in-6 to bring
      // something along, Knock 1-in-6 (`03` section 6).
      events.push(...spend(outcome.steps, outcome.method));
      if (outcome.noisy) events.push(rollNoiseCheck(rng.encounter, outcome.method));

      record(events);
      return { events };
    },

    /** What the hero adds to a bash (`03` section 6), for the odds a key shows. */
    get bashBonus() {
      return bashBonusOf();
    },

    /**
     * The chest the hero is facing, while it is still shut. A chest can sit
     * on a doorway tile, and then the door comes first: what is in the way is
     * always what the context key offers (`00`, Exploration).
     */
    get chestAhead() {
      const chest = run.ahead.chest;
      if (!chest || chest.opened || run.doorAhead) return null;
      return chest;
    },

    /**
     * One key of the Chest screen's grid (`03` section 7). The sequence's
     * rules are `systems/chests.js`'s; what belongs here is the floor around
     * them — the time each step costs, the noise a bash makes, the gold and
     * the loot going into the hero's own pack, and the log.
     *
     * @param {'search' | 'careful' | 'disarm' | 'pole' | 'pick' | 'bash'
     *   | 'key' | 'knock' | 'dispelWard' | 'open'} action
     */
    chestAct(action) {
      const chest = run.chestAhead;
      if (!chest) return { events: [] };
      const services = { rng: rng.combat };
      const at = run.ahead.at;
      /** @type {object[]} */
      const events = [];

      // 1. Inspect (`03` section 7 step 1).
      if (action === 'search' || action === 'careful') {
        const careful = action === 'careful';
        const looked = inspectChest(rng.combat, hero, chest, floor.floor, {
          careful,
          dark: inDarkness(floor, ex.pos),
        });
        if (looked.why) return { events: [] };
        if (looked.mimic) events.push({ type: 'mimicSeen', at });
        events.push({
          type: 'searched',
          found: Boolean(looked.trap),
          exact: Boolean(chest.trap?.typeKnown),
          trap: chest.trap,
        });
        events.push(...spend(looked.steps, careful ? 'carefulSearch' : 'search'));
        record(events);
        return { events };
      }

      // 2. Handle the trap (`03` section 7 step 2).
      if (action === 'disarm' || action === 'pole') {
        const out =
          action === 'disarm'
            ? disarmTrap(rng.combat, hero, chest, floor.floor)
            : poleTrap(rng.combat, hero, chest);
        if (out.why) return { events: [] };

        if (action === 'pole') {
          events.push({ type: 'poled', at });
          if (out.poleBroke) events.push({ type: 'poleBroke' });
          // An area trap still reaches the hero, with the save made with
          // advantage (`03` section 4).
          if (out.reaches) {
            events.push({
              type: 'trapSprung',
              at,
              by: 'pole',
              trap: fireTrap(services, hero, chest.trap, floor.floor, { detected: true, advantage: true }),
            });
          }
        } else if (out.disarmed) {
          events.push({ type: 'disarmed', at });
          if (out.salvage) events.push({ type: 'salvaged', item: out.salvage });
          if (out.xp) events.push({ type: 'earned', xp: out.xp, why: 'disarm' });
        } else {
          events.push({ type: 'disarmFailed', at });
          if (out.sprung) {
            events.push({
              type: 'trapSprung',
              at,
              by: 'disarm',
              // `03` section 4: the hero is working on it, so it is no
              // surprise when it goes off in their hands.
              trap: fireTrap(services, hero, chest.trap, floor.floor, { detected: true }),
            });
          }
        }
        events.push(...spend(out.steps ?? 0, action));
        record(events);
        return { events, outcome: out };
      }

      // 3. Unlock (`03` section 7 step 3).
      if (action !== 'open') {
        const out = unlockChest(services, hero, chest, floor.floor, {
          method: action,
          keysHeld: ex.keysTaken,
          has: hero.has ?? {},
          bashBonus: bashBonusOf(),
        });
        if (out.why) return { events: [] };

        events.push(out.opened ? { type: 'unlocked', at, method: out.method } : { type: 'lockHeld', at });
        if (out.xp) events.push({ type: 'earned', xp: out.xp, why: out.method });
        if (out.jammed) events.push({ type: 'jammed', at });
        if (out.broke) events.push({ type: 'picksBroke' });
        if (out.backlash) events.push({ type: 'backlash', ...out.backlash });
        if (out.usedUp) events.push({ type: 'usedUp', item: 'skeleton_key' });
        if (out.sprung) events.push({ type: 'trapSprung', at, by: out.method, trap: out.sprung });
        events.push(...spend(out.steps ?? 0, out.method));
        if (out.noisy) events.push(rollNoiseCheck(rng.encounter, out.method));
        record(events);
        return { events, outcome: out };
      }

      // 4 and 5. Open, and loot (`03` section 7 steps 4 and 5).
      const armed = isArmed(chest);
      const out = openChest(services, hero, chest, floor.floor);
      if (out.why) return { events: [] };
      if (armed && out.sprung) events.push({ type: 'trapSprung', at, by: 'open', trap: out.sprung });

      if (out.mimic) {
        events.push({ type: 'mimic', at, surprise: out.surprise });
        // Lifting a lid is a use, and a use is one step (`03` section 1).
        events.push(...spend(costOf('item'), 'open'));
        record(events);
        return { events, outcome: out, mimic: true };
      }

      events.push({ type: 'chestOpened', at, gold: out.gold, drops: out.drops });
      hero.gold = (hero.gold ?? 0) + out.gold;
      // What the pack will hold goes in; the rest stays in the chest, so a
      // hero who drops something can come back for it.
      const { taken, left } = takeAll(hero, out.drops);
      for (const drop of taken) events.push({ type: 'took', name: nameOf(drop, hero.identification) });
      if (left.length) events.push({ type: 'packFull' });
      chest.left = left;
      events.push(...spend(costOf('item'), 'open'));
      record(events);
      return { events, outcome: out };
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
      if (run.context === 'touch') {
        const why = whyNotLeaveByStone(town, run);
        return why ? t(`explore.reason.${why}`) : undefined;
      }
      // SEARCH is always something the hero can do, even where there is
      // nothing to find: `03` section 3 says a failure looks the same.
      if (run.context === 'search') return inDarkness(floor, ex.pos) ? t('explore.reason.tooDark') : undefined;
      if (run.context === 'open' && run.chestAhead) return undefined;
      if (run.context === 'open' && run.doorAhead) {
        // A door with no way through says which one is missing, not "later".
        const way = run.openingWay;
        return way ? undefined : t(`explore.reason.${firstReason(run.doorAhead, ex, hero)}`);
      }
      return t('common.comingSoon');
    },

    /** What the context key's second line says. */
    get actHint() {
      if (run.context === 'search') return t('explore.hint.search');
      if (run.context === 'open' && run.chestAhead) return t('explore.hint.open');
      if (run.context === 'touch') {
        return whyNotLeaveByStone(town, run) ? null : t('explore.hint.toTown');
      }
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
