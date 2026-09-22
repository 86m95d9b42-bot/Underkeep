/**
 * Using what is in the pack (`04` sections 8, 9 and 10).
 *
 * The pack knows what the hero is carrying and the database knows what each
 * thing does; this joins the two into the Item action `06` section 4 lists,
 * and takes one off the stack afterwards. What the action *does* is
 * `item-actions.js`, which never sees an item id.
 *
 * Some uses belong to systems that are not built yet — a Scroll of Mapping
 * has no map to reveal until the town and the Chest screens exist — so each
 * is listed in `NOT_YET` with what it waits for, and its button says so.
 */
import { ITEM_RULES, item, itemOf } from '../data/items.js';
import { entryOf, isConsumable, quickItems, removeItem } from './inventory.js';
import { isIdentified, nameOf, onUse } from './identification.js';
import { actionForSkill } from '../engine/skill-actions.js';

/** Uses whose systems arrive with a later phase. */
export const NOT_YET = {
  light: 'Light and torches are Phase 7.',
  revealFloor: 'The automap has nothing to reveal from a scroll yet (Phase 7).',
  teleportOnFloor: 'Moving the hero on the floor from a fight is Phase 7.',
  safeCamp: 'Camp from the Pause Menu.',
  camp: 'Camp from the Pause Menu.',
  reveal: 'Dust of Revealing needs the traps and secret doors of Phase 7.',
  opensLock: 'Doors and chests open from the Chest / Door screen (Phase 7).',
  removeCurses: 'The scroll is read from the pack, which the Pack screen adds.',
  identifyPack: 'The scroll is read from the pack, which the Pack screen adds.',
  scrambleMapSteps: 'The automap has nothing to scramble yet (Phase 7).',
};

/** What a use asks for that this phase cannot answer yet. */
export function waitingOn(use = {}) {
  return Object.keys(NOT_YET).find((key) => use[key] !== undefined) ?? null;
}

/** True for something the hero can use at all: a potion, a scroll, a bomb. */
export function isUsable(baseId) {
  const entry = item(baseId);
  return isConsumable(baseId) && Boolean(entry.use || entry.casts);
}

/**
 * Why this item cannot be used now, or null.
 * @param {object} hero
 * @param {object} instance
 * @param {{ inCombat?: boolean }} [where]
 */
export function whyNotUse(hero, instance, { inCombat = true } = {}) {
  if (!instance) return 'notCarried';
  const entry = itemOf(instance.baseId);
  if (!isUsable(instance.baseId)) return 'notUsable';

  // A scroll takes a mind that can read it (`04` section 9).
  if (entry.category === 'scroll') {
    const needs = item(instance.baseId).school === 'spirit' ? 'wits' : 'intellect';
    const score = hero?.attributes?.[needs] ?? 0;
    const wanted = entry.school === 'spirit' ? 11 : 11;
    if (score < wanted) return needs === 'wits' ? 'needsWits' : 'needsIntellect';
  }
  // A torch in a fight is fire, not light (`02` section 2, Torches as Tools).
  if (inCombat && entry.fireSource) return null;
  if (waitingOn(entry.use)) return 'notHere';
  if (!inCombat && entry.use?.thrown) return 'notInAFight';
  return null;
}

/**
 * The items the hero can reach for, quick slots first, each with the reason
 * it is dimmed if it is (`04` section 1, `04` section 16).
 */
export function usableItems(hero, { inCombat = true } = {}) {
  const pack = hero?.pack;
  if (!pack) return [];
  const pinned = quickItems(pack).filter(Boolean);
  const rest = pack.items.filter(
    (entry) => isUsable(entry.baseId) && !pinned.some((one) => one.instanceId === entry.instanceId),
  );
  return [...pinned, ...rest]
    .filter((entry) => isUsable(entry.baseId))
    .map((entry) => {
      const why = whyNotUse(hero, entry, { inCombat });
      return {
        id: entry.instanceId,
        instanceId: entry.instanceId,
        baseId: entry.baseId,
        name: nameOf(entry, hero.identification),
        count: entry.count ?? 1,
        known: isIdentified(hero.identification, entry),
        quick: pinned.some((one) => one.instanceId === entry.instanceId),
        why,
      };
    });
}

/**
 * Turns one carried item into an Item action.
 *
 * A scroll that casts a skill is that skill's action, cast at the reader's own
 * level and modifiers and for no Focus (`04` section 9).
 *
 * @param {object} hero
 * @param {string} instanceId
 * @param {{ target?: string, inCombat?: boolean, floor?: number }} [options]
 * @returns {{ action?: object, why?: string }}
 */
export function actionForItem(hero, instanceId, { target, inCombat = true, floor = 1 } = {}) {
  const instance = entryOf(hero.pack ?? {}, instanceId);
  const why = whyNotUse(hero, instance, { inCombat });
  if (why) return { why };

  const entry = itemOf(instance.baseId);
  const name = nameOf(instance, hero.identification);

  if (entry.casts) {
    const built = actionForSkill(hero, entry.casts, { target, fromItem: true });
    if (!built.action) return { why: built.why };
    return {
      action: {
        ...built.action,
        id: 'item',
        item: instanceId,
        baseId: instance.baseId,
        name,
        // A scroll spends no Focus (`04` section 9).
        fp: 0,
        casts: entry.casts,
        tags: [...(built.action.tags ?? []), 'scroll'],
      },
    };
  }

  // Torches as Tools: it sears a Hydra stump or burns a Fallen troll, and
  // is used up doing it (`02` section 2).
  if (inCombat && entry.fireSource) {
    return {
      action: { id: 'item', item: instanceId, baseId: instance.baseId, name, use: { sear: true }, fp: 0, tags: ['item', entry.category] },
    };
  }

  const use = entry.use ?? {};
  return {
    action: {
      id: 'item',
      item: instanceId,
      baseId: instance.baseId,
      name,
      use,
      target,
      // Nothing in the pack costs Focus to use (`04` sections 8 to 11), and
      // saying so keeps every item action the same shape as a scroll's.
      fp: 0,
      // Save DCs for bombs are 10 + the floor (`04` section 10).
      dc: ITEM_RULES.bombSaveDc.base + ITEM_RULES.bombSaveDc.perFloor * floor,
      needsTarget: Boolean(use.thrown && use.target !== 'row'),
      tags: ['item', entry.category],
    },
  };
}

/**
 * Takes one off the stack and learns what it was: drinking and reading are
 * two of `04` section 5's ways to identify.
 * @returns {{ learned: boolean, left: number }}
 */
export function consumeItem(hero, instanceId) {
  const instance = entryOf(hero.pack ?? {}, instanceId);
  if (!instance) return { learned: false, left: 0 };
  const taught = onUse(hero.identification, instance);
  const before = instance.count ?? 1;
  removeItem(hero.pack, instanceId, 1);
  return { learned: (taught.revealed ?? []).length > 0, left: before - 1 };
}
