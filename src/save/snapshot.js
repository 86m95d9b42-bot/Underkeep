/**
 * The game in progress, written down and read back (`05` section 14, Save
 * File).
 *
 * A save holds only what cannot be rebuilt: the hero, the town (with every
 * floor's memory), the carried random streams, and — while the hero is
 * underground — where they stand and what they have changed on the floor.
 * Floors themselves are rebuilt from the master seed (`05` section 11,
 * principle 3), and the Shop's shelves from the seed and the day.
 *
 * A fight in progress is written whole into `combat` — every enemy's hit
 * points, conditions and cooldowns, the round and turn order, whose turn, a
 * telegraph waiting to fire, and the last three log lines — so closing the app
 * mid-fight changes nothing (`05` sections 11, 13 and 14).
 */
import { SAVE_VERSION } from './migrations.js';
import { serializeStreams } from '../engine/rng.js';
import { createSession } from '../systems/session.js';

/**
 * @param {ReturnType<typeof createSession>} session
 * @param {object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.screen] the router's current screen, for the resume
 * @returns {object} a save, without its checksum (the store seals it)
 */
export function takeSnapshot(session, { now = new Date(), screen = null } = {}) {
  const hero = session.hero;
  const run = session.run;
  // The trip's floor changes go into the town's floor memory first, so the
  // town written below already holds them. Copied before, a sprung trap was
  // missing from this save and only appeared in the next one.
  run?.remember();
  return {
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    mode: hero.mode === 'ironman' ? 'ironman' : 'adventurer',
    difficulty: session.difficulty,
    masterSeed: session.masterSeed,
    playTimeSec: Math.round(session.playTimeSec),
    townVisits: session.town.day - 1,
    location: run
      ? {
          place: session.fight ? 'combat' : 'dungeon',
          floor: run.floor.floor,
          pos: [...run.ex.pos],
          facing: run.ex.facing,
          screen,
        }
      : { place: 'town', floor: null, screen },
    hero: structuredClone(hero),
    town: structuredClone(session.town),
    sold: [...session.sold],
    rng: serializeStreams(session.rng),
    run: run ? run.toSave() : null,
    combat: session.fight ? session.fight.toSave() : null,
  };
}

/**
 * A session picked up from a save: the same hero, town, streams and trip.
 * The save must already be verified and migrated (`store.read` does both).
 * @param {object} save
 * @param {{ go?: (to: string, params?: object) => void }} [options]
 */
export function restoreSession(save, { go, reactions } = {}) {
  const hero = structuredClone(save.hero);
  return createSession({
    hero,
    seed: save.masterSeed,
    difficulty: save.difficulty ?? 'normal',
    go,
    ...(reactions ? { reactions } : {}),
    restore: {
      town: structuredClone(save.town),
      sold: save.sold ?? [],
      rng: save.rng,
      playTimeSec: save.playTimeSec ?? 0,
      run: save.run ?? null,
      fight: save.combat ?? null,
    },
  });
}

/**
 * The slot a new game goes in (`05` section 11, Save Slots and Modes). An
 * Ironman gets one of their own; an Adventurer takes the first free one of
 * three, or — with all three full — the one played longest ago
 * (docs/DECISIONS.md: there is no slot picker among the 26 screens).
 * @param {object} hero
 * @param {{ slot: string, summary: { savedAt: string | null } }[]} taken what `store.list` said
 * @param {string[]} adventurerSlots
 */
export function slotFor(hero, taken, adventurerSlots) {
  if (hero.mode === 'ironman') return `ironman-${hero.seed ?? 0}`;
  const used = new Map(taken.map((row) => [row.slot, row.summary?.savedAt ?? '']));
  const free = adventurerSlots.find((slot) => !used.has(slot));
  if (free) return free;
  // ISO timestamps order as plain strings; no locale may decide which save goes.
  const when = (slot) => String(used.get(slot));
  return [...adventurerSlots].sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0))[0];
}
