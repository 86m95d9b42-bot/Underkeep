/**
 * The Town Stash (`00-build-outline.md`, "Town"; `04` section 1).
 *
 * Two lists, one over the other: what the hero is carrying and what they have
 * left in town, each with its slot count. Tapping picks a side as well as an
 * item, so the two buttons under them are always about the same thing — the
 * one that applies is the primary, the other says why it does not.
 *
 * Wide is "list + detail (two lists)": pack left, stash right, the buttons
 * under each.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { listRow, scrollPanel, topBar } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { summaryOf } from '../parts/item-line.js';
import { describe } from '../../systems/identification.js';
import { isEquipped, slotsUsed } from '../../systems/inventory.js';
import { rarityColor } from './pack.js';
import { stashOf, store, whyNotStore, whyNotWithdraw, withdraw } from '../../systems/stash.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 18, 1, 2] },
  pack: { tall: [1, 9, 3, 9], wide: [1, 9, 3, 7] },
  stash: { tall: [1, 9, 10, 16], wide: [10, 18, 3, 7] },
  toStash: { tall: [1, 5, 17, 18], wide: [1, 9, 8, 9], tap: true },
  toPack: { tall: [6, 9, 17, 18], wide: [10, 18, 8, 9], tap: true },
};

/** Which list a pick came from, and its id — the two packs number separately. */
export function pickOf(side, instance) {
  return `${side}:${instance.instanceId}`;
}

/** @type {import('../../shell/router.js').Screen} */
export const stash = {
  id: 'stash',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, run }) {
    const hero = run.hero;
    const held = hero.pack;
    const kept = stashOf(hero);
    /** @type {string | null} */
    let chosen = null;

    const packBox = el('div', { class: 'region block' });
    const stashBox = el('div', { class: 'region block' });
    const toStash = el('div', { class: 'region keyslot' });
    const toPack = el('div', { class: 'region keyslot' });

    const side = () => chosen?.split(':')[0] ?? null;
    const idOf = () => chosen?.split(':')[1] ?? null;

    /** One of the two lists, with its label and slot count. */
    const paintList = (box, from, name, rows, empty) => {
      box.replaceChildren(
        el('span', {
          class: 'block__label',
          text: t(`stash.${name}`, { used: slotsUsed(from), total: from.capacity }),
        }),
        scrollPanel({
          ariaLabel: t(`stash.${name}`, { used: slotsUsed(from), total: from.capacity }),
          children: rows.length
            ? rows.map((entry) => {
                const card = describe(entry, hero.identification);
                const worn = name === 'pack' && isEquipped(held, entry.instanceId);
                return listRow({
                  name: card.count > 1 ? t('items.count', { name: card.name, n: card.count }) : card.name,
                  sub: summaryOf(entry, { known: card.identified }),
                  color: rarityColor(card.rarity),
                  side: worn ? t('pack.equipped') : undefined,
                  selected: chosen === pickOf(name, entry),
                  onTap: () => {
                    chosen = pickOf(name, entry);
                    paint();
                  },
                });
              })
            : [el('span', { class: 'hint', text: t(empty) })],
        }),
      );
    };

    const paintButtons = () => {
      const id = idOf();
      const from = side();
      const instance = id
        ? (from === 'pack' ? held : kept).items.find((entry) => entry.instanceId === id)
        : null;
      const moving = instance ? describe(instance, hero.identification).name : null;

      const whyStore = from === 'pack' && id ? whyNotStore(hero, id, instance?.count ?? 1) : 'pick';
      const whyTake = from === 'stash' && id ? whyNotWithdraw(hero, id, instance?.count ?? 1) : 'pick';

      toStash.replaceChildren(
        button({
          label: t('stash.toStash'),
          kind: whyStore ? undefined : 'primary',
          hint: whyStore ? undefined : t('stash.moves', { name: moving }),
          reason: whyStore ? t(`stash.why.${whyStore}`) : undefined,
          onTap: () => {
            store(hero, id, instance?.count ?? 1);
            chosen = null;
            paint();
          },
        }),
      );

      toPack.replaceChildren(
        button({
          label: t('stash.toPack'),
          kind: whyTake ? undefined : 'primary',
          hint: whyTake ? undefined : t('stash.moves', { name: moving }),
          reason: whyTake ? t(`stash.why.${whyTake}`) : undefined,
          onTap: () => {
            withdraw(hero, id, instance?.count ?? 1);
            chosen = null;
            paint();
          },
        }),
      );
    };

    function paint() {
      paintList(packBox, held, 'pack', held.items, 'stash.emptyPack');
      paintList(stashBox, kept, 'stash', kept.items, 'stash.emptyStash');
      paintButtons();
    }
    paint();

    return {
      topBar: topBar({
        title: t('stash.title'),
        sub: t('stash.sub'),
        onBack: () => router.back(),
      }),
      pack: packBox,
      stash: stashBox,
      toStash,
      toPack,
    };
  },
};
