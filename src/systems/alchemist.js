/**
 * The Alchemist (`04` section 12).
 *
 * Nine recipes that turn what a monster left behind into something useful.
 * The shop opens after the floor 2 boss, which is `items.json`'s own
 * `alchemy.unlockedBy`, and the town is what remembers whether it has fallen.
 *
 * A recipe is read the way the mockup draws it — *"Spider Silk 2 / 1"*: what
 * the hero has, over what the recipe wants — and brewing spends the parts,
 * the fee, and nothing else.
 *
 * No DOM. Nothing here rolls.
 */
import { ALCHEMY, item, slotsFor } from '../data/items.js';
import { identify } from './identification.js';
import { addItem, removeItem, slotsUsed } from './inventory.js';
import { isOpen } from './town.js';

/** Every recipe, in the order `04` section 12 lists them. */
export const RECIPES = ALCHEMY.recipes;

/** The floor whose boss opens the door. */
export const UNLOCK_FLOOR = ALCHEMY.unlockedBy?.boss ?? 2;

/** How many of one part the hero is carrying. */
export function carried(hero, baseId) {
  return (hero.pack?.items ?? [])
    .filter((entry) => entry.baseId === baseId)
    .reduce((total, entry) => total + (entry.count ?? 1), 0);
}

/** One recipe's ingredients, as "have / need" (`04` section 12). */
export function ingredientsOf(hero, recipe) {
  return recipe.ingredients.map((line) => ({
    baseId: line.item,
    name: item(line.item).name,
    have: carried(hero, line.item),
    need: line.count,
    enough: carried(hero, line.item) >= line.count,
  }));
}

/** Why the hero cannot brew this, or null. */
export function whyNotBrew(town, hero, recipe) {
  if (!isOpen(town, 'alchemist')) return 'locked';
  if (!ingredientsOf(hero, recipe).every((line) => line.enough)) return 'missingParts';
  if ((hero.gold ?? 0) < recipe.fee) return 'notEnoughGold';
  const made = recipe.result;
  if (slotsUsed(hero.pack) + slotsFor(made.item, made.count) > hero.pack.capacity) return 'packFull';
  return null;
}

/**
 * The list the screen draws: every recipe with what it wants, what it costs
 * and whether it can be made. `00`'s Alchemist table sorts the brewable ones
 * first, which is the order a player reads.
 */
export function recipesFor(town, hero) {
  return RECIPES.map((recipe, index) => ({
    id: `rec_${index}`,
    recipe,
    result: recipe.result,
    fee: recipe.fee,
    ingredients: ingredientsOf(hero, recipe),
    why: whyNotBrew(town, hero, recipe),
  })).sort((a, b) => Number(Boolean(a.why)) - Number(Boolean(b.why)));
}

/**
 * Brews one: the parts go, the fee goes, and what comes out is known — the
 * hero watched it being made (`04` section 5, "anything bought in a shop is
 * identified", and this is the same counter).
 *
 * @returns {{ ok: boolean, why?: string, paid?: number, made?: object }}
 */
export function brew(town, hero, recipe) {
  const why = whyNotBrew(town, hero, recipe);
  if (why) return { ok: false, why };

  for (const line of recipe.ingredients) {
    let left = line.count;
    for (const entry of [...hero.pack.items]) {
      if (left <= 0) break;
      if (entry.baseId !== line.item) continue;
      const taken = Math.min(entry.count ?? 1, left);
      removeItem(hero.pack, entry.instanceId, taken);
      left -= taken;
    }
  }

  hero.gold -= recipe.fee;
  const { entry } = addItem(hero.pack, recipe.result.item, {
    count: recipe.result.count,
    identified: true,
  });
  if (entry) identify(hero.identification, entry);
  return { ok: true, paid: recipe.fee, made: entry };
}
