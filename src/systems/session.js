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
import { returnToTown, useMark } from './travel.js';
import { createFight } from './fight.js';

/**
 * @param {object} options
 * @param {object} options.hero the hero creation finished
 * @param {number} [options.seed] the master seed, when the hero has none
 * @param {string} [options.difficulty]
 * @param {(to: string, params?: object) => void} [options.go] where a screen
 *   change goes; the tools do not need one
 */
export function createSession({ hero, seed, difficulty = 'normal', go } = {}) {
  const masterSeed = hero?.seed ?? seed ?? 1;
  const town = createTown();

  /** @type {ReturnType<typeof createRun> | null} */
  let run = null;
  /** @type {ReturnType<typeof createFight> | null} */
  let fight = null;
  /** The shelves for this stay, rebuilt when the day turns over. */
  let shelves = null;
  /** What has been bought out of the Shop for good (`04` section 15). */
  const sold = [];

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
      const left = returnToTown(town, { run, leaveMark });
      run = null;
      fight = null;
      shelves = null;
      go?.('town');
      return left;
    },

    /** The fight in front of the hero, started if there is not one. */
    startFight({ monsters, seed: fightSeed } = {}) {
      const where = run ?? session.descend({ floor: 1 });
      fight = createFight({
        hero,
        monsters,
        floor: where.floor.floor,
        masterSeed: fightSeed ?? where.masterSeed,
        difficulty,
      });
      return fight;
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

  return session;
}
