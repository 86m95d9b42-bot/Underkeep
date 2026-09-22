/**
 * One game in progress: the hero, the town they come back to, the trip they
 * are on, and the fight in front of them.
 *
 * Everything the loop of `00`'s screen flow needs — descend, fight, return,
 * shop, descend again — is here rather than in `main.js`, for two reasons:
 * the browser is not the only thing that plays the game (`npm run loop`
 * drives this object), and Phase 8's save file is this object written down.
 *
 * The screens reach it through the router's context. It owns no DOM.
 */
import { createRun } from './run.js';
import { createTown, descend as countTrip } from './town.js';
import { openShop } from './shop.js';
import { FLOORS, returnToTown, useMark } from './travel.js';
import { createFight } from './fight.js';
import { BOSSES, bossOnFloor } from '../data/bosses.js';
import { heroFell as fell } from './graves.js';
import { carriedStreams } from '../engine/rng.js';
import { recordOf } from './death.js';
import { tipState } from './tips.js';
import { makeMonster } from '../data/monsters.js';
import { rollEncounter } from '../data/encounters.js';

/**
 * @param {object} options
 * @param {object} options.hero the hero creation finished
 * @param {number} [options.seed] the master seed, when the hero has none
 * @param {string} [options.difficulty]
 * @param {(to: string, params?: object) => void} [options.go] where a screen
 *   change goes; the tools do not need one
 * @param {object} [options.restore] a save file's state to pick up from
 *   (`src/save/snapshot.js` builds it)
 * @param {() => string} [options.reactions] the Reaction prompt setting, read
 *   when each fight begins (`06` section 17); the tools fly Auto
 */
export function createSession({ hero, seed, difficulty = 'normal', go, restore, reactions = () => 'auto' } = {}) {
  const masterSeed = hero?.seed ?? seed ?? 1;
  const town = restore?.town ?? createTown();

  /**
   * The carried random streams: encounter, combat and loot. They belong to the
   * game, not to a trip or a fight — each trip and each fight draws on from
   * where the last one stopped, and the save carries their state
   * (`05` section 11, Random Number Streams).
   */
  const rng = carriedStreams(masterSeed, restore?.rng);

  /** @type {ReturnType<typeof createRun> | null} */
  let run = null;
  /** @type {ReturnType<typeof createFight> | null} */
  let fight = null;
  /** The shelves for this stay, rebuilt when the day turns over. */
  let shelves = null;
  /** What has been bought out of the Shop for good (`04` section 15). */
  const sold = restore?.sold ? [...restore.sold] : [];
  /** Seconds played, for the Title screen and the Hall of the Dead (`05` section 12). */
  let playTimeSec = restore?.playTimeSec ?? 0;

  const session = {
    get hero() {
      return hero;
    },
    get town() {
      return town;
    },
    get masterSeed() {
      return masterSeed;
    },
    get run() {
      return run;
    },
    get fight() {
      return fight;
    },
    get rng() {
      return rng;
    },
    get difficulty() {
      return difficulty;
    },
    get playTimeSec() {
      return playTimeSec;
    },
    /** Adds play time; the host counts it while the game is in front. */
    played(seconds) {
      playTimeSec += Math.max(0, seconds);
    },
    /** True while the hero is underground. */
    get inDungeon() {
      return Boolean(run);
    },

    /**
     * The Shop as it stands on this visit. Built once a stay, so walking out
     * and back in shows the same shelves; the rotating lines reroll when the
     * hero comes back from the dungeon (`04` section 15).
     */
    get shop() {
      if (!shelves || shelves.day !== town.day) {
        shelves = { day: town.day, ...openShop({ town, masterSeed, sold }) };
      }
      return shelves;
    },

    /**
     * Taking the Dungeon Gate. The trip is counted on the way down, so a trip
     * the hero never comes back from is still a trip (`05` section 12), and a
     * trip that begins at a Return Mark begins where the scroll was read and
     * spends the mark (`05` section 9).
     */
    descend({ floor, mark: byMark = false } = {}) {
      const startAt = byMark ? useMark(town) : null;
      run = createRun({
        masterSeed,
        floor: startAt?.floor ?? floor ?? run?.floor?.floor ?? 1,
        hero,
        streams: rng,
        ...(startAt ? { startAt } : {}),
        town,
        leaveDungeon: (options) => session.leaveDungeon(options),
      });
      fight = null;
      countTrip(town);
      return run;
    },

    /**
     * Coming back up, by Waystone or by scroll. The day turns over and the
     * run is let go: the next trip builds its own floor from the seed
     * (`05` sections 8, 11 and 12).
     */
    leaveDungeon({ leaveMark = false } = {}) {
      run?.remember();
      countSteps();
      const left = returnToTown(town, { run, leaveMark });
      run = null;
      fight = null;
      shelves = null;
      go?.('town');
      return left;
    },

    /**
     * The hero fell (`01` section 12, `05` sections 9 and 12).
     *
     * The record of the run is taken first, as the hero stood when they fell.
     * Then an Adventurer wakes in town without half their gold and without
     * what they could not name, and a Grave holds it where they died — one
     * grave at a time, so dying again loses the last one. An Ironman's run
     * is over; the host deletes the save and sends the record to the Hall.
     * Where the player goes next is the caller's: the Death screen.
     *
     * @param {{ cause?: object }} [options] what killed them
     * @returns {{ mode: string, grave: object | null, record: object }}
     */
    heroFell({ cause = null } = {}) {
      const where = run;
      where?.remember();
      const record = recordOf({ hero, town, run: where, cause, playTimeSec });
      countSteps();
      const mode = hero.mode === 'ironman' ? 'ironman' : 'adventurer';
      const grave =
        where && mode === 'adventurer'
          ? fell(town, hero, { floor: where.floor.floor, at: [...where.ex.pos] })
          : null;

      // Waking up is not coming home: the day still turns over, and the trip
      // is over either way.
      hero.hp = mode === 'adventurer' ? Math.max(1, Math.floor(hero.maxHp / 2)) : 0;
      hero.alive = mode === 'adventurer';
      run = null;
      fight = null;
      shelves = null;
      if (mode === 'adventurer') town.day += 1;
      return { mode, grave, record };
    },

    /**
     * What a step or a use on the map leads to, resolved at once so it is
     * saved with the step (`05` section 11). A fight comes first, in the
     * order the hero meets it: a Mimic or a waking Sarcophagus, the Hollow
     * Stalker, the boss arena, then a wandering monster the clock or a noise
     * called up. With no fight, stairs underfoot are taken: down once the
     * floor's boss is beaten, up to the floor above's down stairs, or out of
     * floor 1 to town (`05` section 1).
     *
     * @param {{ events?: object[], mimic?: boolean, fight?: string[] | null, outcome?: object }} result
     *   what `run.press`, `run.act` or `run.chestAct` handed back
     * @returns {{ next: 'combat' | 'floor' | 'town' | null }} where the screen goes
     */
    follow(result = {}) {
      // A fight that is over and was never put away is done with.
      if (fight?.over) fight = null;
      if (!run || fight) return { next: fight ? 'combat' : null };
      const events = result.events ?? [];
      const on = run.floor.floor;

      if (result.mimic) {
        session.startFight({ monsters: [makeMonster('mimic', { floor: on })], ambush: Boolean(result.outcome?.surprise) });
        return { next: 'combat' };
      }
      if (Array.isArray(result.fight) && result.fight.length) {
        session.startFight({ monsters: result.fight.map((id) => makeMonster(id, { floor: on })) });
        return { next: 'combat' };
      }
      const stalker = events.find((event) => event.type === 'stalker' && event.monsters?.length);
      if (stalker) {
        session.startFight({ monsters: stalker.monsters });
        return { next: 'combat' };
      }
      if (events.some((event) => event.type === 'arena') && session.startBoss({ floor: on })) {
        return { next: 'combat' };
      }
      const called = events.find((event) => (event.type === 'wanderingCheck' || event.type === 'noiseCheck') && event.encounter);
      if (called) {
        session.startFight({ monsters: rollEncounter(on, rng.encounter).monsters, ambush: Boolean(called.surprise) });
        return { next: 'combat' };
      }

      const stairs = events.find((event) => event.type === 'stairs');
      if (stairs?.direction === 'down' && on < FLOORS.length && town.bosses.includes(on)) {
        takeStairs(on + 1, null);
        return { next: 'floor' };
      }
      if (stairs?.direction === 'up') {
        if (on === 1) {
          session.leaveDungeon({ leaveMark: false });
          return { next: 'town' };
        }
        takeStairs(on - 1, 'down');
        return { next: 'floor' };
      }
      return { next: null };
    },

    /**
     * Camping, from the Pause Menu (`01` section 9): the rest itself, or the
     * wandering monster that interrupts it.
     * @returns {{ events: object[], why?: string, next: 'combat' | null }}
     */
    camp() {
      if (!run || fight) return { events: [], why: fight ? 'inFight' : 'inTown', next: null };
      const result = run.camp();
      return { ...result, next: result.why ? null : session.follow(result).next };
    },

    /** The fight in front of the hero, started if there is not one. */
    startFight({ monsters, seed: fightSeed, ambush = false } = {}) {
      const where = run ?? session.descend({ floor: 1 });
      fight = createFight({
        hero,
        monsters,
        floor: where.floor.floor,
        // A tool asking for a particular fight passes its own seed; the game
        // draws on the carried streams.
        ...(fightSeed !== undefined ? { masterSeed: fightSeed } : { streams: rng }),
        difficulty,
        reactions: reactions(),
        tips: tipState(town),
        // Where the hero is standing decides whether magic works at all
        // (`03` section 8, Anti-Magic Field).
        antiMagic: where.antiMagic ?? false,
        ambush,
      });
      return fight;
    },

    /**
     * The fight at the bottom of the floor (`05` section 1, Boss gates): the
     * boss that guards the stairs down, with its escort and its arena.
     *
     * A boss that has fallen never comes back, so this answers null for a
     * floor whose boss the town already remembers.
     */
    startBoss({ floor: on, seed: fightSeed } = {}) {
      const where = run ?? session.descend({ floor: on ?? 1 });
      const floorNumber = on ?? where.floor.floor;
      const id = bossOnFloor(floorNumber);
      if (!id || town.bosses.includes(floorNumber)) return null;

      fight = createFight({
        hero,
        boss: id,
        floor: floorNumber,
        ...(fightSeed !== undefined ? { masterSeed: fightSeed } : { streams: rng }),
        difficulty,
        reactions: reactions(),
        tips: tipState(town),
      });
      return fight;
    },

    /**
     * What a beaten boss changes: the floor's stairs open for good, the Shop
     * moves up a tier, and the Alchemist opens after the second
     * (`05` section 1, `04` section 12).
     */
    bossBeaten(floorNumber) {
      if (!town.bosses.includes(floorNumber)) town.bosses.push(floorNumber);
      // The last boss is the ending (`02` section 13), and a finished game is
      // recorded once, as it stands (`05` section 12).
      const id = bossOnFloor(floorNumber);
      let finished = null;
      if (id && BOSSES[id]?.reward?.ending && !town.finished) {
        finished = recordOf({ hero, town, run, playTimeSec, victory: true });
        town.finished = { at: finished.at, score: finished.score };
      }
      return { bosses: town.bosses, finished };
    },

    /** Forgets the fight, which is what walking away from one means. */
    endFight() {
      fight = null;
    },

    /** What has been bought out of the Shop for good. */
    get sold() {
      return sold;
    },
  };

  /**
   * Stairs between floors: the same trip goes on, so no trip is counted and
   * the day does not turn. The floor left behind is remembered, and the hero
   * arrives on the up stairs going down, or on the down stairs going up
   * (`05` section 1).
   * @param {number} to
   * @param {'down' | null} arriveOn which stairs of the new floor to stand on
   */
  function takeStairs(to, arriveOn) {
    run.remember();
    countSteps();
    run = createRun({
      masterSeed,
      floor: to,
      hero,
      streams: rng,
      town,
      leaveDungeon: (options) => session.leaveDungeon(options),
      ...(arriveOn ? { arriveOn } : {}),
    });
  }

  /** Adds this trip's steps to the town's tally, for the Hall (`05` section 12). */
  function countSteps() {
    if (run) town.steps = (town.steps ?? 0) + (run.ex.steps ?? 0);
  }

  // Picking a trip back up from a save: the same floor, the same visit — and,
  // if the hero was mid-fight, the same fight at the same turn (`05` section 13).
  if (restore?.run) {
    run = createRun({
      masterSeed,
      floor: restore.run.floor,
      hero,
      streams: rng,
      town,
      leaveDungeon: (options) => session.leaveDungeon(options),
      restore: restore.run,
    });
  }
  if (restore?.fight) {
    const origin = restore.fight.origin ?? {};
    fight = createFight({
      hero,
      ...(origin.boss ? { boss: origin.boss } : { monsters: origin.monsters ?? [] }),
      floor: origin.floor ?? run?.floor?.floor ?? 1,
      antiMagic: origin.antiMagic ?? false,
      streams: rng,
      difficulty,
      reactions: reactions(),
      tips: tipState(town),
      resume: restore.fight,
    });
  }

  return session;
}
