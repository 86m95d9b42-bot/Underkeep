/**
 * Learning a skill (`01` sections 5 and 6).
 *
 * ```text
 * A tier opens at 0, 3, 6 and 10 points spent in its own Path.
 * Tier IV also wants an attribute of 15 or higher.
 * A Crossroads skill costs 1 point and wants 4 in each of its two Paths.
 * A rank costs 1 point, up to the ranks the skill has.
 * An origin's free skill does not count against any of that.
 * ```
 *
 * A hero's skills live on the hero as `[{ id, rank, free }]`, where `free` is
 * how many of those ranks an origin gave. Everything here counts *paid* ranks,
 * which is what `01` section 6's "points already spent in the Path" means.
 *
 * Learning changes the hero in place and re-derives their sheet, so the
 * engine's `maxHp`, `def` and the rest are always the whole truth. No DOM.
 */
import {
  CROSSROADS,
  COST_PER_RANK,
  exploreEffects,
  gateFor,
  isCrossroads,
  skill,
  skillIds,
} from '../data/skills.js';
import { LEVELING } from '../data/attributes.js';
import { applySkillSheet } from '../engine/skill-hooks.js';

/** Why a skill cannot be learned. Each has a line in `strings.json`. */
export const REASONS = /** @type {const} */ ([
  'unknown',
  'maxRank',
  'noPoints',
  'tierLocked',
  'needsAttribute',
  'needsPaths',
]);

/**
 * Runs a change that may raise a maximum, and gives the hero what it raised.
 * A skill that adds hit points adds them to the hero's own, not only to the
 * ceiling above them.
 */
function grow(hero, change) {
  const before = { hp: hero.maxHp ?? 0, fp: hero.maxFp ?? 0 };
  change();
  hero.hp = Math.min(hero.maxHp, (hero.hp ?? 0) + Math.max(0, hero.maxHp - before.hp));
  hero.fp = Math.min(hero.maxFp, (hero.fp ?? 0) + Math.max(0, hero.maxFp - before.fp));
  return hero;
}

/** The hero's skill list, whatever shape they arrived in. */
function learned(hero) {
  return hero?.skills ?? [];
}

/** One learned skill's entry, or null. */
export function entryOf(hero, id) {
  return learned(hero).find((row) => row.id === id) ?? null;
}

/** What rank the hero has in a skill, free ranks included. */
export function rankOf(hero, id) {
  return entryOf(hero, id)?.rank ?? 0;
}

/** How many ranks of a skill an origin gave, which are never paid for. */
export function freeRanksOf(hero, id) {
  return entryOf(hero, id)?.free ?? 0;
}

/**
 * Points **spent** in one Path (`01` section 6). A free skill does not count,
 * which is exactly what an origin's grant promises.
 * @param {object} hero @param {string} path
 */
export function spentIn(hero, path) {
  return learned(hero)
    .filter((row) => skill(row.id).path === path)
    .reduce((total, row) => total + Math.max(0, row.rank - (row.free ?? 0)) * COST_PER_RANK, 0);
}

/** Every point the hero has spent, the Crossroads included. */
export function spentTotal(hero) {
  return learned(hero).reduce(
    (total, row) => total + Math.max(0, row.rank - (row.free ?? 0)) * COST_PER_RANK,
    0,
  );
}

/** Points the hero has earned and not spent. */
export function unspent(hero) {
  return (hero?.skillPoints ?? 0) - spentTotal(hero);
}

/** True when a Path's tier has enough points in it to open. */
export function tierOpenIn(hero, path, tier) {
  return spentIn(hero, path) >= gateFor(tier);
}

/** True when the hero meets a capstone's attribute requirement. */
export function meetsRequirement(hero, id) {
  const needs = skill(id).requires;
  if (!needs?.attribute) return true;
  return (hero?.attributes?.[needs.attribute] ?? 0) >= needs.score;
}

/** True when both of a Crossroads skill's Paths have the points it wants. */
export function meetsPaths(hero, id) {
  const entry = skill(id);
  if (!isCrossroads(id)) return true;
  return (entry.paths ?? []).every((path) => spentIn(hero, path) >= CROSSROADS.pointsInEachPath);
}

/**
 * Why the hero cannot learn the next rank of a skill, or null when they can.
 *
 * The structural reasons come before the purse: a tier that is not open says
 * so whether or not there is a point to spend, because that is the fact a
 * player is planning around. "No skill points left" is only ever shown on a
 * skill they could otherwise take.
 *
 * @param {object} hero
 * @param {string} id
 * @returns {string | null} one of `REASONS`
 */
export function whyNot(hero, id) {
  if (!skillIds().includes(id)) return 'unknown';
  const entry = skill(id);

  if (rankOf(hero, id) >= entry.ranks) return 'maxRank';

  if (isCrossroads(id)) {
    if (!meetsPaths(hero, id)) return 'needsPaths';
  } else {
    if (!tierOpenIn(hero, entry.path, entry.tier)) return 'tierLocked';
    if (!meetsRequirement(hero, id)) return 'needsAttribute';
  }

  if (unspent(hero) < COST_PER_RANK) return 'noPoints';
  return null;
}

/** True when the next rank of a skill can be learned right now. */
export function canLearn(hero, id) {
  return whyNot(hero, id) === null;
}

/**
 * Learns the next rank, paying for it. Changes the hero in place and
 * re-derives their sheet.
 * @returns {{ learned: boolean, why?: string, rank?: number }}
 */
/**
 * Whether a hero's skills give them one of the dungeon systems' `explore`
 * flags — Lore's `identify`, Trapfinding's `trap`, Lockpicking's `pick`
 * (`01` section 6). The items that also grant these are the pack's, and the
 * systems that read both are `03`'s.
 * @param {object} hero
 * @param {string} key
 */
export function hasExplore(hero, key) {
  return (hero?.skills ?? []).some(({ id, rank = 1 }) =>
    exploreEffects(id, rank).some((effect) => effect.explore === key),
  );
}

export function learn(hero, id) {
  const why = whyNot(hero, id);
  if (why) return { learned: false, why };

  hero.skills ??= [];
  const entry = entryOf(hero, id);
  if (entry) entry.rank += 1;
  else hero.skills.push({ id, rank: 1 });

  // A rank that raises a maximum hands the difference over at once: learning
  // Toughness makes the hero tougher, not more wounded.
  grow(hero, () => applySkillSheet(hero));
  return { learned: true, rank: rankOf(hero, id) };
}

/**
 * Grants the free rank an origin comes with (`01` section 3). It costs
 * nothing and counts towards nothing, but it is learned: the hero has it, and
 * its effects apply.
 * @param {object} hero
 * @param {{ id: string, rank?: number }} grant
 */
export function grantFree(hero, grant) {
  if (!grant?.id || !skillIds().includes(grant.id)) return hero;
  const ranks = grant.rank ?? 1;
  hero.skills ??= [];

  const entry = entryOf(hero, grant.id);
  if (entry) {
    entry.rank = Math.max(entry.rank, ranks);
    entry.free = Math.max(entry.free ?? 0, ranks);
  } else {
    hero.skills.push({ id: grant.id, rank: ranks, free: ranks });
  }
  grow(hero, () => applySkillSheet(hero));
  return hero;
}

/**
 * What a temple charges to give every spent point back: 100 gp a level
 * (`01` section 5, Respec).
 */
export function respecCost(hero) {
  return LEVELING.respecCostPerLevel * (hero?.level ?? 1);
}

/**
 * Forgets everything the hero paid for, keeping what an origin gave. The
 * points come back; the free skill stays.
 */
export function respec(hero) {
  const kept = [];
  for (const row of learned(hero)) {
    if (!row.free) continue;
    kept.push({ id: row.id, rank: row.free, free: row.free });
  }
  hero.skills = kept;
  applySkillSheet(hero);
  return hero;
}

/**
 * Every skill with what the Skill Tree screen needs to draw it: the rank the
 * hero has, whether the next one can be learned, and why not.
 * @param {object} hero
 */
export function treeFor(hero) {
  return skillIds().map((id) => {
    const entry = skill(id);
    return {
      id,
      path: entry.path,
      tier: entry.tier,
      ranks: entry.ranks,
      rank: rankOf(hero, id),
      free: freeRanksOf(hero, id),
      why: whyNot(hero, id),
    };
  });
}
