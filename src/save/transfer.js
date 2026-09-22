/**
 * Export and import (`05` section 11, Export and Import — Adventurer only).
 *
 * A save leaves the game as one line of text: a short prefix naming the game
 * and the format, then the sealed save — checksum and all — in base64. The
 * same line is both the file the player downloads and the text they can copy
 * to another phone. Reading one back checks everything the store checks when
 * it loads a slot: the prefix, the checksum, the version, and that it is an
 * Adventurer's game, since an Ironman save is never exported (`05` section 11,
 * Ironman protections).
 *
 * No DOM: the file, the clipboard and the picker are the host's.
 */
import { decode, encode, seal, verify } from './codec.js';
import { migrate } from './migrations.js';

/** The line every exported save starts with. The number is the format's. */
export const EXPORT_PREFIX = 'UNDERKEEP:1:';

/** What an exported file is called: the hero, and the day it was taken. */
export function exportName(save) {
  const who = String(save?.hero?.name ?? 'hero').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'hero';
  const day = String(save?.savedAt ?? '').slice(0, 10) || 'save';
  return `underkeep-${who.toLowerCase()}-${day}.txt`;
}

/** Text as UTF-8 base64, which every browser and Node can read back. */
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(binary);
}

function fromBase64(text) {
  const binary = globalThis.atob(text);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Why a save may not be exported, or null.
 * @param {object | null} save
 * @returns {'noSave' | 'ironman' | null}
 */
export function whyNotExport(save) {
  if (!save) return 'noSave';
  if (save.mode === 'ironman') return 'ironman';
  return null;
}

/**
 * A save as the line of text the player keeps.
 * @param {object} save a verified save, as the store reads it
 * @returns {Promise<string>}
 */
export async function exportText(save) {
  const why = whyNotExport(save);
  if (why) throw new Error(`export: ${why}`);
  const sealed = await seal(structuredClone(save));
  return EXPORT_PREFIX + toBase64(encode(sealed));
}

/**
 * Reads an exported line back into a save, or says why it cannot be.
 * @param {string} text what the player gave: a file's contents or pasted text
 * @returns {Promise<{ save: object } | { why: 'notASave' | 'damaged' | 'newer' | 'ironman' }>}
 */
export async function importText(text) {
  const line = String(text ?? '').trim();
  if (!line.startsWith(EXPORT_PREFIX)) return { why: 'notASave' };
  let save;
  try {
    save = decode(fromBase64(line.slice(EXPORT_PREFIX.length).replace(/\s+/g, '')));
  } catch {
    return { why: 'damaged' };
  }
  if (!(await verify(save))) return { why: 'damaged' };
  if (save.mode === 'ironman') return { why: 'ironman' };
  try {
    return { save: migrate(save).save };
  } catch (error) {
    return { why: /newer/.test(String(error?.message)) ? 'newer' : 'damaged' };
  }
}

/**
 * Which slot an imported game goes in: the slot already holding that same
 * game (the same master seed and hero), so a backup restores over itself;
 * otherwise the first free Adventurer slot; otherwise none — an import never
 * overwrites a different game (docs/DECISIONS.md).
 * @param {object} save
 * @param {{ slot: string, summary?: { name?: string, masterSeed?: number } }[]} taken what `store.list` says
 * @param {string[]} adventurerSlots
 * @returns {string | null}
 */
export function importSlot(save, taken, adventurerSlots) {
  const same = taken.find(
    (row) => row.summary?.masterSeed === save.masterSeed && row.summary?.name === save.hero?.name,
  );
  if (same && adventurerSlots.includes(same.slot)) return same.slot;
  const used = new Set(taken.map((row) => row.slot));
  return adventurerSlots.find((slot) => !used.has(slot)) ?? null;
}
