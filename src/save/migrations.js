/**
 * Save versions and the chain that upgrades them (`05` section 11,
 * Versioning).
 *
 * Every save carries a `version`. When the game changes what it writes, the
 * version goes up by one and a small function is added here that turns a save
 * of the old version into the new one. Loading runs every step in turn —
 * v1 → v2 → v3 — so a save written by any earlier game still opens.
 *
 * Version 1 is the first the game shipped, and the chain is empty and ready
 * for version 2 (`00`, Launch checklist).
 */

/** The version this build writes. */
export const SAVE_VERSION = 1;

/**
 * `MIGRATIONS[n]` takes a version-n save and returns a version-(n + 1) one.
 * Each is a pure function: it gets a copy and may change it freely.
 * @type {Record<number, (save: object) => object>}
 */
export const MIGRATIONS = {};

/**
 * Brings a save up to this build's version, one step at a time.
 * @param {object} save
 * @param {{ version?: number, steps?: Record<number, (save: object) => object> }} [options]
 *   for tests: a different target, and a different chain
 * @returns {{ save: object, from: number, to: number }}
 */
export function migrate(save, { version = SAVE_VERSION, steps = MIGRATIONS } = {}) {
  const from = save?.version;
  if (!Number.isInteger(from) || from < 1) throw new Error('save: no version');
  // A save from a newer game cannot be understood, only damaged, by this one.
  if (from > version) throw new Error(`save: version ${from} is newer than this game (${version})`);

  let current = structuredClone(save);
  while (current.version < version) {
    const step = steps[current.version];
    if (!step) throw new Error(`save: no migration from version ${current.version}`);
    const next = step(current);
    next.version = current.version + 1;
    current = next;
  }
  return { save: current, from, to: current.version };
}
