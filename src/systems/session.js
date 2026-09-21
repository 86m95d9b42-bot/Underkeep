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
import { bossOnFloor } from '../data/bosses.js';
import { heroFell as fell } from './graves.js';

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

    /**
     * The hero fell (`01` section 12, `05` section 9).
     *
     * An Adventurer wakes in town without half their gold and without what
     * they could not name, and a Grave holds it where they died — one grave
     * at a time, so dying again loses the last one. An Ironman's save is
     * deleted, which is Phase 8's; here the trip simply ends.
     *
     * @returns {{ mode: string, grave: object | null }}
     */
    heroFell() {
      const where = run;
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
      if (mode === 'adventurer') {
        town.day += 1;
        go?.('town');
      } else {
        go?.('death');
      }
      return { mode, grave };
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
        // Where the hero is standing decides whether magic works at all
        // (`03` section 8, Anti-Magic Field).
        antiMagic: where.antiMagic ?? false,
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
        masterSeed: fightSeed ?? where.masterSeed,
        difficulty,
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
      return town.bosses;
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
