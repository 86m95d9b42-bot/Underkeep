/**
 * Player-facing text. Every string the player reads comes from strings.json, so
 * wording changes never touch game logic (CLAUDE.md, "Style").
 */
import strings from './strings.json' with { type: 'json' };

/**
 * @param {string} path dotted path, e.g. 'title.continue'
 * @returns {string} the string, or the path itself when it is missing, so a
 *   typo shows up on screen instead of rendering as "undefined".
 */
export function t(path) {
  let node = strings;
  for (const key of path.split('.')) {
    if (node == null || typeof node !== 'object') return path;
    node = node[key];
  }
  return typeof node === 'string' ? node : path;
}

export { strings };
