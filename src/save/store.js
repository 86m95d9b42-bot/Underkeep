/**
 * Save slots in IndexedDB, written safely (`05` section 11, Safe Writing and
 * Storage).
 *
 *   1. Write the new save to a temporary key.
 *   2. Read it back and verify its checksum.
 *   3. Swap it in as the main save, keeping the previous one as the backup —
 *      in **one** transaction, so the swap either happens whole or not at all.
 *
 * Reading checks the main save's checksum and falls back to the backup when it
 * fails, and says so, so the game can tell the player. A save that neither
 * copy can vouch for is reported as corrupt rather than half-loaded.
 *
 * Each slot is three records in the `slots` store, `<slot>:main`,
 * `<slot>:backup` and `<slot>:temp`, each holding the encoded save text. The
 * `meta` store remembers which slot was played last, for the Title screen.
 *
 * No DOM: the only browser API here is IndexedDB, which `fake-indexeddb`
 * stands in for under test.
 */
import { decode, encode, seal, verify } from './codec.js';
import { migrate } from './migrations.js';

/** The database, and the version of its layout (not of the saves in it). */
export const DB_NAME = 'underkeep';
export const DB_VERSION = 2;

const SLOTS = 'slots';
const META = 'meta';
/** The Hall of the Dead (`05` section 12), added in layout version 2. */
const HALL = 'hall';

/** An IndexedDB request as a promise. */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** A transaction's end as a promise: it resolves once the writes are durable. */
function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('save: transaction aborted'));
  });
}

/** Opens (and on first use, lays out) the database. */
function openDb(idb, name) {
  const request = idb.open(name, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(SLOTS)) db.createObjectStore(SLOTS);
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    if (!db.objectStoreNames.contains(HALL)) db.createObjectStore(HALL, { autoIncrement: true });
  };
  return done(request);
}

/** Text back into a save, or null when it will not parse. */
function parse(text) {
  if (typeof text !== 'string') return null;
  try {
    return decode(text);
  } catch {
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {IDBFactory} [options.indexedDB] the browser's, or a test's
 * @param {string} [options.name]
 */
export async function openStore({ indexedDB = globalThis.indexedDB, name = DB_NAME } = {}) {
  if (!indexedDB) throw new Error('save: no IndexedDB here');
  const db = await openDb(indexedDB, name);

  const get = async (store, key) => done(db.transaction(store, 'readonly').objectStore(store).get(key));

  const store = {
    /**
     * Writes a save to a slot the safe way. The save is sealed with its
     * checksum first; the promise resolves once the new main save is durable.
     * @param {string} slot
     * @param {object} save
     * @returns {Promise<{ bytes: number, checksum: string }>}
     */
    async write(slot, save) {
      await seal(save);
      const text = encode(save);

      // 1. The temporary key.
      const first = db.transaction(SLOTS, 'readwrite');
      first.objectStore(SLOTS).put(text, `${slot}:temp`);
      await committed(first);

      // 2. What landed is what was meant.
      const landed = parse(await get(SLOTS, `${slot}:temp`));
      if (!(await verify(landed)) || landed.checksum !== save.checksum) {
        throw new Error('save: the new save did not verify, and the old one is untouched');
      }

      // 3. The swap: main becomes backup, temp becomes main, temp goes.
      //    The puts are issued from the read's own callback so the whole swap
      //    is one transaction, whatever the browser does with promises.
      const swap = db.transaction([SLOTS, META], 'readwrite');
      const slots = swap.objectStore(SLOTS);
      const previous = slots.get(`${slot}:main`);
      previous.onsuccess = () => {
        if (previous.result !== undefined) slots.put(previous.result, `${slot}:backup`);
        slots.put(text, `${slot}:main`);
        slots.delete(`${slot}:temp`);
      };
      swap.objectStore(META).put(slot, 'last');
      await committed(swap);

      return { bytes: text.length, checksum: save.checksum };
    },

    /**
     * Reads a slot. The main save if it verifies, otherwise the backup —
     * with `recovered` set so the player can be told. Either way the save is
     * brought up to this build's version.
     * @param {string} slot
     * @returns {Promise<{ save: object | null, recovered: boolean, corrupt?: boolean, migrated?: number }>}
     */
    async read(slot) {
      const main = parse(await get(SLOTS, `${slot}:main`));
      const backup = parse(await get(SLOTS, `${slot}:backup`));
      if (main === null && backup === null && (await get(SLOTS, `${slot}:main`)) === undefined) {
        return { save: null, recovered: false };
      }

      let chosen = null;
      let recovered = false;
      if (await verify(main)) chosen = main;
      else if (await verify(backup)) {
        chosen = backup;
        recovered = true;
      }
      if (!chosen) return { save: null, recovered: false, corrupt: true };

      const upgraded = migrate(chosen);
      return {
        save: upgraded.save,
        recovered,
        ...(upgraded.from !== upgraded.to ? { migrated: upgraded.from } : {}),
      };
    },

    /** Every slot that holds a save, with what the Title screen shows of it. */
    async list() {
      const tx = db.transaction(SLOTS, 'readonly');
      const keys = await done(tx.objectStore(SLOTS).getAllKeys());
      const slots = [...new Set(keys.map((key) => String(key).split(':')[0]))];
      const out = [];
      for (const slot of slots) {
        const { save } = await store.read(slot);
        if (save) out.push({ slot, summary: summaryOf(save) });
      }
      return out;
    },

    /** Forgets a slot entirely: main, backup and anything half-written. */
    async remove(slot) {
      const tx = db.transaction([SLOTS, META], 'readwrite');
      const slots = tx.objectStore(SLOTS);
      for (const part of ['main', 'backup', 'temp']) slots.delete(`${slot}:${part}`);
      const meta = tx.objectStore(META);
      const last = meta.get('last');
      last.onsuccess = () => {
        if (last.result === slot) meta.delete('last');
      };
      await committed(tx);
    },

    /**
     * An Ironman's end (`05` section 11): the save is deleted and the
     * tombstone goes to the Hall of the Dead, in **one** transaction, so a
     * force-close can never leave a dead hero's save to be continued, nor a
     * deleted save with no tombstone.
     * @param {string} slot
     * @param {object} record from `systems/death.js`
     */
    async bury(slot, record) {
      const tx = db.transaction([SLOTS, META, HALL], 'readwrite');
      const slots = tx.objectStore(SLOTS);
      for (const part of ['main', 'backup', 'temp']) slots.delete(`${slot}:${part}`);
      const meta = tx.objectStore(META);
      const last = meta.get('last');
      last.onsuccess = () => {
        if (last.result === slot) meta.delete('last');
      };
      tx.objectStore(HALL).add(record);
      await committed(tx);
    },

    /** Adds a record to the Hall of the Dead: a finished game (`05` section 12). */
    async addToHall(record) {
      const tx = db.transaction(HALL, 'readwrite');
      tx.objectStore(HALL).add(record);
      await committed(tx);
    },

    /** The Hall of the Dead, best score first: the top `limit` records. */
    async hall(limit = Infinity) {
      const all = await done(db.transaction(HALL, 'readonly').objectStore(HALL).getAll());
      return all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
    },

    /** The slot played last, or null. */
    async lastSlot() {
      return (await get(META, 'last')) ?? null;
    },

    /** For tests and the recovery path: the raw text a slot part holds. */
    async raw(slot, part = 'main') {
      return get(SLOTS, `${slot}:${part}`);
    },

    /** For tests: puts raw text straight into a slot part, checksum or not. */
    async poke(slot, part, text) {
      const tx = db.transaction(SLOTS, 'readwrite');
      tx.objectStore(SLOTS).put(text, `${slot}:${part}`);
      await committed(tx);
    },

    close() {
      db.close();
    },
  };
  return store;
}

/**
 * What the Title screen's Last Played card shows of a save (`05` section 13):
 * the hero, where they are, and how long they have played.
 * @param {object} save
 */
export function summaryOf(save) {
  return {
    name: save.hero?.name ?? '',
    level: save.hero?.level ?? 1,
    mode: save.mode ?? 'adventurer',
    floor: save.location?.floor ?? null,
    place: save.location?.place ?? 'town',
    playTimeSec: save.playTimeSec ?? 0,
    savedAt: save.savedAt ?? null,
  };
}
