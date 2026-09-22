/**
 * When the hero falls: what killed them, what the run was worth, and the
 * record the Hall of the Dead keeps (`05` sections 11 and 12, `01` section 12).
 *
 * Everything here is read off the game as it stands at the moment of death —
 * before an Adventurer's grave takes half their gold — and nothing is changed.
 * The session decides what falling does; the Death screen shows this.
 *
 * No DOM.
 */
import rules from '../data/hall.json' with { type: 'json' };
import { PATHS } from '../data/skills.js';
import { costOf, itemOf } from '../data/items.js';
import { nameOf } from './identification.js';
import { spentIn } from './skill-tree.js';
import { t } from '../data/strings.js';

export const SCORE = rules.score;
export const HALL_KEPT = rules.kept;

/**
 * The score of `05` section 12: XP + gold carried + deepest floor × 1,000 +
 * bosses defeated × 500, doubled for a victory and × 1.5 for Ironman.
 * @param {{ xp: number, gold: number, deepest: number, bosses: number, victory?: boolean, mode?: string }} run
 */
export function scoreOf({ xp = 0, gold = 0, deepest = 0, bosses = 0, victory = false, mode = 'adventurer' }) {
  let score = xp + gold + deepest * SCORE.perFloor + bosses * SCORE.perBoss;
  if (victory) score *= SCORE.victory;
  if (mode === 'ironman') score *= SCORE.ironman;
  return Math.floor(score);
}

/**
 * The deepest floor the hero has stood on: every floor the town remembers a
 * visit to, and the one they are on now.
 * @param {object} town
 * @param {number | null} [here]
 */
export function deepestFloor(town, here = null) {
  const visited = Object.values(town?.floors ?? {})
    .filter((memory) => (memory.visits ?? 0) > 0)
    .map((memory) => memory.floor);
  return Math.max(0, here ?? 0, ...visited, ...(town?.bosses ?? []));
}

/** Every step taken, on every trip: the town's tally, and this trip's so far. */
export function totalSteps(town, run = null) {
  return (town?.steps ?? 0) + (run?.ex?.steps ?? 0);
}

/**
 * The best item the hero owns: the rarest, and the dearest of those at the
 * Shop's own price with its magic (`04` section 4). A unique has no price and
 * wins on rarity alone. Named the way the hero knows it.
 * @param {object} hero
 * @returns {{ name: string, baseId: string, bonus: number } | null}
 */
export function bestItemOf(hero) {
  const rank = (entry) => rules.rarityOrder.indexOf(itemOf(entry.baseId).rarity ?? 'common');
  const price = (entry) => costOf(entry.baseId, { bonus: entry.bonus ?? 0, property: entry.property ?? null }) ?? 0;
  const owned = (hero?.pack?.items ?? []).filter((entry) => {
    const category = itemOf(entry.baseId).category;
    return ['weapon', 'armor', 'shield', 'charm'].includes(category);
  });
  if (owned.length === 0) return null;
  const best = [...owned].sort((a, b) => rank(b) - rank(a) || price(b) - price(a))[0];
  return { name: nameOf(best, hero.identification), baseId: best.baseId, bonus: best.bonus ?? 0 };
}

/** Points spent in each Path, for the record's "skill Paths" (`05` section 12). */
export function pathsOf(hero) {
  const out = {};
  for (const path of [...Object.keys(PATHS), 'crossroads']) {
    const spent = spentIn(hero, path);
    if (spent > 0) out[path] = spent;
  }
  return out;
}

/**
 * What killed the hero, as the Death screen and the Hall say it. A monster is
 * named by its kind, a boss by its name; a trap or a hazard by what it was.
 *
 * @param {object | null} cause from the fight or the run
 * @returns {{ kind: string, name?: string, boss?: boolean, id?: string }}
 */
export function causeOf(cause) {
  if (!cause || typeof cause !== 'object') return { kind: 'unknown' };
  return { ...cause };
}

/**
 * What killed them, in the words the tombstone uses: "Slain by a Ghast",
 * "Slain by Vyrmathrax the Ashen", "Killed by a Dart Plate".
 * @param {object | null} cause
 */
export function causeText(cause) {
  const kind = cause?.kind ?? 'unknown';
  if (kind === 'monster') {
    const name = cause.name ?? '';
    // A boss is somebody, and carries its own name; a monster is a kind of thing.
    const who = cause.boss ? name : `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
    return t('death.cause.monster', { who });
  }
  if (kind === 'trap') {
    const name = t(`traps.${cause.id}.name`);
    return typeof name === 'string' && !name.startsWith('traps.') ? t('death.cause.trap', { name }) : t('death.cause.unknown');
  }
  const line = t(`death.cause.${kind}`);
  return typeof line === 'string' && !line.startsWith('death.') ? line : t('death.cause.unknown');
}

/**
 * The record of a fallen hero (`05` section 12): name, level, origin and
 * Paths; the floor and the cause; days, steps and play time; gold carried,
 * bosses defeated and the best item; and the score.
 *
 * @param {object} options
 * @param {object} options.hero
 * @param {object} options.town
 * @param {object | null} [options.run]
 * @param {object | null} [options.cause]
 * @param {number} [options.playTimeSec]
 * @param {boolean} [options.victory]
 * @param {Date} [options.now]
 */
export function recordOf({ hero, town, run = null, cause = null, playTimeSec = 0, victory = false, now = new Date() }) {
  const mode = hero.mode === 'ironman' ? 'ironman' : 'adventurer';
  const floor = run?.floor?.floor ?? null;
  const deepest = deepestFloor(town, floor);
  const bosses = (town?.bosses ?? []).length;
  const gold = hero.gold ?? 0;
  const xp = hero.xp ?? 0;
  return {
    name: hero.name ?? '',
    level: hero.level ?? 1,
    origin: hero.origin ?? null,
    paths: pathsOf(hero),
    mode,
    victory,
    floor,
    deepest,
    cause: victory ? null : causeOf(cause),
    day: town?.day ?? 1,
    days: Math.max(0, (town?.day ?? 1) - 1),
    steps: totalSteps(town, run),
    playTimeSec: Math.round(playTimeSec),
    gold,
    xp,
    bosses,
    bestItem: bestItemOf(hero),
    score: scoreOf({ xp, gold, deepest, bosses, victory, mode }),
    at: now.toISOString(),
  };
}

/**
 * The Hall of the Dead as the screen lists it (`05` section 12): the top
 * records by score, or the most recent, each carrying its rank by score.
 * @param {object[]} records
 * @param {'score' | 'recent'} [sort]
 * @param {number} [limit]
 * @returns {{ rank: number, record: object }[]}
 */
export function hallView(records = [], sort = 'score', limit = HALL_KEPT) {
  // Ties go to whoever got there first.
  const when = (record) => String(record.at ?? '');
  const byScore = [...records].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0),
  );
  const ranked = byScore.map((record, index) => ({ rank: index + 1, record }));
  if (sort === 'recent') {
    const at = (row) => when(row.record);
    return [...ranked].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0)).slice(0, limit);
  }
  return ranked.slice(0, limit);
}

/**
 * The cause as a Hall row says it, short: "Ghast, floor 5", "Rat King",
 * "Dart Plate, floor 2", "VICTORY".
 * @param {object} record
 */
export function shortCause(record) {
  if (record.victory) return t('hall.victory');
  const cause = record.cause ?? {};
  let name;
  // A row is short: "Rat King", where the stone says "the Rat King".
  if (cause.kind === 'monster') name = String(cause.name ?? '').replace(/^The\s+/i, '');
  else if (cause.kind === 'trap') name = t(`traps.${cause.id}.name`);
  const plain = typeof name === 'string' && name && !name.startsWith('traps.') ? name : causeText(cause);
  return record.floor && name ? t('hall.floor', { name: plain, n: record.floor }) : plain;
}
