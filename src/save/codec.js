/**
 * Turning the game into text and back (`05` section 11).
 *
 * The game's state is plain data with one exception: the floor memory keeps
 * its map and its opened doors as Sets, because exploration writes into them
 * as it walks (`05` section 8). JSON has no Set, so a Set is written as
 * `{ "$set": [...] }` and a Map as `{ "$map": [[k, v], ...] }`, and read back
 * as what it was.
 *
 * The checksum is taken over a **stable** stringification — keys sorted at
 * every depth — so the same state always hashes the same, whatever order its
 * keys were added in.
 */

/** JSON.stringify's replacer: Sets and Maps as tagged arrays. */
function replacer(_key, value) {
  if (value instanceof Set) return { $set: [...value] };
  if (value instanceof Map) return { $map: [...value] };
  return value;
}

/** JSON.parse's reviver: the tagged arrays back into Sets and Maps. */
function reviver(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$set' && Array.isArray(value.$set)) return new Set(value.$set);
    if (keys.length === 1 && keys[0] === '$map' && Array.isArray(value.$map)) return new Map(value.$map);
  }
  return value;
}

/** The save as text. */
export function encode(save) {
  return JSON.stringify(save, replacer);
}

/** The text as a save. Throws on text that is not JSON, which is corruption. */
export function decode(text) {
  return JSON.parse(text, reviver);
}

/**
 * The same value as text with every object's keys sorted, Sets and Maps
 * tagged as `encode` tags them. Two equal states give equal strings.
 */
export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (node) => {
    const plain = replacer('', node);
    if (plain === null || typeof plain !== 'object') return plain;
    if (seen.has(plain)) throw new TypeError('save: a cycle cannot be saved');
    seen.add(plain);
    if (Array.isArray(plain)) {
      const list = plain.map((item) => (item === undefined ? null : walk(item)));
      seen.delete(plain);
      return list;
    }
    const out = {};
    for (const key of Object.keys(plain).sort()) {
      if (plain[key] === undefined || typeof plain[key] === 'function') continue;
      out[key] = walk(plain[key]);
    }
    seen.delete(plain);
    return out;
  };
  return JSON.stringify(walk(value));
}

/**
 * The save's checksum: SHA-1 over everything but the checksum itself, written
 * the way `05` section 14's template shows it (`"sha1-…"`).
 * @param {object} save
 * @returns {Promise<string>}
 */
export async function checksumOf(save) {
  const { checksum: _ignored, ...rest } = save;
  const bytes = new TextEncoder().encode(stableStringify(rest));
  const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha1-${hex}`;
}

/** Stamps a save with its checksum, in place, and hands it back. */
export async function seal(save) {
  save.checksum = await checksumOf(save);
  return save;
}

/** True when the save's checksum matches what it holds. */
export async function verify(save) {
  if (!save || typeof save !== 'object' || typeof save.checksum !== 'string') return false;
  return save.checksum === (await checksumOf(save));
}
