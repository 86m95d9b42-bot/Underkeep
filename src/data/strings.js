/**
 * Player-facing text. Every string the player reads comes from strings.json, so
 * wording changes never touch game logic (CLAUDE.md, "Style").
 */
import strings from './strings.json' with { type: 'json' };

/**
 * @param {string} path dotted path, e.g. 'title.continue'
 * @param {Record<string, string | number>} [vars] fills `{name}` placeholders,
 *   which the combat log needs: "You hit the {target} for {n}."
 * @returns {string} the string, or the path itself when it is missing, so a
 *   typo shows up on screen instead of rendering as "undefined".
 */
export function t(path, vars) {
  let node = strings;
  for (const key of path.split('.')) {
    if (node == null || typeof node !== 'object') return path;
    node = node[key];
  }
  if (typeof node !== 'string') return path;
  return vars ? fill(node, vars) : node;
}

/** Replaces `{name}` with what the caller passed, and leaves the rest alone. */
function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

export { strings };
