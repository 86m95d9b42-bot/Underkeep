/**
 * Hero: Pack (`00-build-outline.md`, "Hero and Items"; `04` sections 1 and 16).
 *
 * The four equipped slots, a filter, and what the hero is carrying with the
 * slot counter over it. Tapping anything opens the Item Detail sheet, which
 * the wide frame shows as a right-hand panel.
 *
 * Nothing here decides anything: `inventory.js` owns the slots and the
 * equipment rules, `identification.js` owns what an item is called, and this
 * draws the answers.
 */
import { itemDetailBody } from './item-detail.js';
import { el } from '../parts/el.js';
import { button, segmented } from '../parts/button.js';
import { chip, listRow, scrollPanel } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { heroHeaderRegions, heroTabs, heroTopBar } from '../parts/hero-header.js';
import { item, slotsFor } from '../../data/items.js';
import { describe } from '../../systems/identification.js';
import {
  EQUIP_SLOTS,
  entryOf,
  equippedItem,
  isConsumable,
  isEquipped,
  pin,
  slotsUsed,
  unpin,
} from '../../systems/inventory.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  ...heroHeaderRegions([1, 12]),
  equipped: { tall: [1, 9, 5, 6], wide: [1, 12, 3, 4] },
  // Wide: the filters share their row with SORT and QUICK SLOTS, so the
  // detail panel can have the whole right side under the tabs.
  filters: { tall: [1, 9, 7, 8], wide: [1, 8, 5, 6], tap: true },
  list: { tall: [1, 9, 9, 16], wide: [1, 12, 7, 9] },
  // Wide only: the selected item's detail as a panel beside the list, not a
  // sheet over it (`00`, Hero: Pack). In tall the Item Detail sheet does this.
  detail: { tall: [1, 9, 9, 16], wide: [13, 18, 3, 9] },
  sort: { tall: [1, 4, 17, 18], wide: [9, 10, 5, 6], tap: true },
  quick: { tall: [5, 9, 17, 18], wide: [11, 12, 5, 6], tap: true },
};

/** The four filters of the outline's table, and what each keeps. */
export const FILTERS = /** @type {const} */ (['all', 'gear', 'use', 'loot']);

/** Which filter an item answers to. */
export function filterOf(baseId) {
  const category = item(baseId).category;
  if (['weapon', 'armor', 'shield', 'charm'].includes(category)) return 'gear';
  if (['valuable', 'part'].includes(category)) return 'loot';
  return isConsumable(baseId) ? 'use' : 'gear';
}

/** The rarity colour an entry is drawn in (`04` section 1). */
export function rarityColor(rarity) {
  return `var(--rarity-${rarity ?? 'common'})`;
}

/** How many slots a row takes, in words. */
function slotNote(entry) {
  const slots = slotsFor(entry.baseId, entry.count ?? 1);
  return slots === 1 ? t('pack.slotCount', { n: slots }) : t('pack.slotCountMany', { n: slots });
}

/**
 * The rows the list shows under one filter, equipped items last: what is worn
 * is already on the strip above.
 */
export function rowsFor(hero, filter = 'all') {
  const pack = hero?.pack;
  if (!pack) return [];
  return pack.items
    .filter((entry) => filter === 'all' || filterOf(entry.baseId) === filter)
    .map((entry) => ({
      entry,
      card: describe(entry, hero.identification),
      worn: isEquipped(pack, entry.instanceId),
      pinned: pack.quick.includes(entry.instanceId),
    }))
    .sort((a, b) => Number(a.worn) - Number(b.worn));
}

/** @type {import('../../shell/router.js').Screen} */
export const pack = {
  id: 'pack',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, run, params = {}, frame, leaveDungeon }) {
    const hero = run.hero;
    const held = hero.pack;
    let filter = FILTERS.includes(params.filter) ? params.filter : 'all';
    let pinning = false;
    const wide = frame === 'wide';

    // Tall opens the Item Detail sheet; wide selects the item and shows it in
    // the panel beside the list, keeping the choice in the params so turning
    // the device keeps it.
    const openDetail = (instanceId) =>
      wide
        ? router.replace('pack', { filter, selected: instanceId })
        : router.openSheet('itemDetail', { item: instanceId, from: 'pack', filter });

    /* -- rows 5-6: what is worn ---------------------------------------- */

    const equipped = el('div', { class: 'region equipstrip' });
    const paintEquipped = () => {
      equipped.replaceChildren(
        ...EQUIP_SLOTS.map((slot) => {
          const gear = held ? equippedItem(held, slot) : null;
          const card = gear ? describe(gear, hero.identification) : null;
          // An empty slot is a dimmed button that says it is empty, the way
          // every other disabled button says why.
          return button({
            label: t(`pack.slots.${slot}`),
            hint: card ? card.name : undefined,
            onTap: gear ? () => openDetail(gear.instanceId) : undefined,
            reason: gear ? undefined : t('pack.none'),
          });
        }),
      );
    };

    /* -- rows 7-8: the filter ------------------------------------------ */

    const filters = el('div', { class: 'region' });
    const paintFilters = () => {
      filters.replaceChildren(
        segmented({
          options: FILTERS.map((id) => ({ value: id, label: t(`pack.filters.${id}`) })),
          value: filter,
          ariaLabel: t('pack.title'),
          onPick: (value) => {
            filter = value;
            paint();
          },
        }),
      );
    };

    /* -- rows 9-16: what is carried ------------------------------------ */

    const list = el('div', { class: 'region block' });
    const paintList = () => {
      const rows = rowsFor(hero, filter);
      const used = held ? slotsUsed(held) : 0;
      list.replaceChildren(
        el('div', { class: 'block__head' }, [
          el('span', { class: 'block__label', text: t('pack.title') }),
          chip(t('pack.slotsUsed', { used, total: held?.capacity ?? 0 }), {
            tone: used >= (held?.capacity ?? 0) ? 'danger' : undefined,
          }),
        ]),
        scrollPanel({
          ariaLabel: t('pack.title'),
          children: rows.length
            ? rows.map(({ entry, card, worn, pinned }) =>
                listRow({
                  name: card.count > 1 ? t('items.count', { name: card.name, n: card.count }) : card.name,
                  sub: slotNote(entry),
                  color: rarityColor(card.rarity),
                  side: worn ? t('pack.equipped') : card.badge ?? (pinned ? t('pack.qs') : undefined),
                  chips: pinned && !worn ? [chip(t('pack.qs'), { tone: 'accent' })] : [],
                  reason:
                    pinning && !isConsumable(entry.baseId) ? t('pack.why.notConsumable') : undefined,
                  onTap: () => {
                    if (!pinning) return openDetail(entry.instanceId);
                    if (held.quick.includes(entry.instanceId)) {
                      unpin(held, held.quick.indexOf(entry.instanceId));
                    } else {
                      pin(held, entry.instanceId);
                    }
                    paint();
                  },
                }),
              )
            : [el('span', { class: 'hint', text: t('pack.empty') })],
        }),
      );
    };

    /* -- rows 17-18: sort, and the quick bar --------------------------- */

    const sort = el('div', { class: 'region keyslot' });
    const quick = el('div', { class: 'region keyslot' });
    const paintButtons = () => {
      sort.replaceChildren(
        button({
          label: t('pack.sort'),
          reason: held?.items.length ? undefined : t('pack.empty'),
          onTap: () => {
            held.items.sort(
              (a, b) =>
                filterOf(a.baseId).localeCompare(filterOf(b.baseId)) ||
                item(a.baseId).category.localeCompare(item(b.baseId).category) ||
                item(a.baseId).name.localeCompare(item(b.baseId).name),
            );
            paint();
          },
        }),
      );
      quick.replaceChildren(
        button({
          label: pinning ? t('pack.done') : t('pack.quickSlots'),
          kind: pinning ? 'primary' : undefined,
          hint: pinning ? t('pack.pinning') : held?.quick.filter(Boolean).length
            ? t('pack.slotsUsed', { used: held.quick.filter(Boolean).length, total: held.quick.length })
            : undefined,
          onTap: () => {
            pinning = !pinning;
            paint();
          },
        }),
      );
    };

    function paint() {
      paintEquipped();
      paintFilters();
      paintList();
      paintButtons();
    }
    paint();

    const detail = wide
      ? el('div', { class: 'region panel packdetail' }, [
          params.selected && held && entryOf(held, params.selected)
            ? itemDetailBody({
                router,
                run,
                instanceId: params.selected,
                leaveDungeon,
                done: () => router.replace('pack', { filter, selected: held && entryOf(held, params.selected) ? params.selected : null }),
              }).body
            : el('p', { class: 'hint packdetail__empty', text: t('pack.detail.pick') }),
        ])
      : null;

    return {
      topBar: heroTopBar({ hero, router }),
      tabs: heroTabs({ router, current: 'pack' }),
      equipped,
      filters,
      list,
      ...(detail ? { detail } : {}),
      sort,
      quick,
    };
  },
};
