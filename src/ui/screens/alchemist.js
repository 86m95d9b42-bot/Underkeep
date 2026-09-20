/**
 * The Alchemist (`00-build-outline.md`, "Town"; `04` section 12).
 *
 * Nine recipes, each showing what it makes, what it wants as "have / need",
 * and the fee. Brewable ones sort first, which is the order a player reads.
 * Under the list is what the result does, and then the fee and one button.
 *
 * The shop is shut until the floor 2 boss has fallen; the rows say so rather
 * than the door being locked, because a recipe is worth knowing about before
 * you can use it.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { chip, listRow, scrollPanel, topBar } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { item } from '../../data/items.js';
import { summaryOf } from '../parts/item-line.js';
import { rarityColor } from './pack.js';
import { UNLOCK_FLOOR, brew, recipesFor } from '../../systems/alchemist.js';

/**
 * Rows 1-2 the bar, 3-14 the recipes under their label, 15-16 what the
 * result does, 17-18 the fee and BREW. Wide is "list + detail".
 * @type {Record<string, import('../../shell/layout.js').RegionDef>}
 */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  list: { tall: [1, 9, 3, 14], wide: [1, 9, 3, 9] },
  detail: { tall: [1, 9, 15, 16], wide: [10, 18, 1, 5] },
  fee: { tall: [1, 4, 17, 18], wide: [10, 13, 6, 9] },
  brew: { tall: [5, 9, 17, 18], wide: [14, 18, 6, 9], tap: true },
};

/** What a recipe makes, named the way the mockup names it ("Fire Pot ×2"). */
export function resultName(result) {
  const name = item(result.item).name;
  return result.count > 1 ? t('alchemist.resultMany', { name, n: result.count }) : name;
}

/** The ingredient line: "Spider Silk 2 / 1", one part per phrase. */
export function ingredientLine(row) {
  return row.ingredients
    .map((line) => t('alchemist.ingredient', { name: line.name, have: line.have, need: line.need }))
    .join(' · ');
}

/** The words for why a recipe cannot be brewed. */
export function reasonFor(why) {
  if (!why) return undefined;
  return why === 'locked' ? t('alchemist.why.locked', { n: UNLOCK_FLOOR }) : t(`alchemist.why.${why}`);
}

/** @type {import('../../shell/router.js').Screen} */
export const alchemist = {
  id: 'alchemist',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, run, town }) {
    const hero = run.hero;
    let chosen = null;

    const bar = el('div', { class: 'region topbar' });
    const list = el('div', { class: 'region block' });
    const detail = el('div', { class: 'region note' });
    const fee = el('div', { class: 'region note' });
    const brewKey = el('div', { class: 'region keyslot' });

    const paint = () => {
      const rows = recipesFor(town, hero);
      const picked = rows.find((row) => row.id === chosen) ?? null;

      const painted = topBar({
        title: t('alchemist.title'),
        onBack: () => router.back(),
        chips: [chip(t('alchemist.gold', { n: hero.gold ?? 0 }), { tone: 'accent' })],
      });
      bar.replaceChildren(...painted.childNodes);

      list.replaceChildren(
        el('span', { class: 'block__label', text: t('alchemist.label') }),
        scrollPanel({
          ariaLabel: t('alchemist.label'),
          children: rows.map((row) =>
            listRow({
              name: resultName(row.result),
              sub: ingredientLine(row),
              color: rarityColor(item(row.result.item).rarity),
              side: t('alchemist.fee', { n: row.fee }),
              selected: row.id === chosen,
              // The row keeps its "have / need" rather than swapping it for a
              // refusal: that line *is* the reason, and it says which part is
              // short. What cannot be brewed is said on the button.
              onTap: () => {
                chosen = row.id;
                paint();
              },
            }),
          ),
        }),
      );

      detail.replaceChildren(
        el('span', {
          class: 'hint',
          text: picked ? summaryOf({ baseId: picked.result.item }) : t('alchemist.pick'),
        }),
      );

      fee.replaceChildren(
        el('span', {
          class: 'reward__value',
          text: picked ? t('alchemist.fee', { n: picked.fee }) : '',
        }),
      );

      brewKey.replaceChildren(
        button({
          label: t('alchemist.brew'),
          kind: 'primary',
          reason: picked ? reasonFor(picked.why) : t('alchemist.why.pick'),
          onTap: () => {
            brew(town, hero, picked.recipe);
            chosen = null;
            paint();
          },
        }),
      );
    };
    paint();

    return { topBar: bar, list, detail, fee, brew: brewKey };
  },
};
