/**
 * The Shop (`00-build-outline.md`, "Town"; `04` sections 1 and 15).
 *
 * Three tabs over one list: what the shop sells, what it will buy, and what
 * it can mend. The row under the list is the selected item with the chips
 * that compare it against what the hero is wearing, and the last row is the
 * price and the one primary button.
 *
 * Tall is the outline's table; wide is "list + detail" — tabs and list left,
 * detail, cost and the button right.
 *
 * The screen decides nothing. `systems/shop.js` knows the stock, the prices
 * and whether a deal can be struck; this draws them and taps.
 */
import { el } from '../parts/el.js';
import { button, segmented } from '../parts/button.js';
import { chip, listRow, scrollPanel, topBar } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { MAGIC, itemOf } from '../../data/items.js';
import { summaryOf, magicLine } from '../parts/item-line.js';
import { describe, isIdentified } from '../../systems/identification.js';
import { equipSlotFor, equippedItem } from '../../systems/inventory.js';
import { rarityColor } from './pack.js';
import {
  SHOP_RULES,
  TABS,
  buy,
  offerFor,
  priceOf,
  repair,
  repairCost,
  repairable,
  sell,
  sellable,
  whyNotBuy,
  whyNotSell,
} from '../../systems/shop.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  tabs: { tall: [1, 9, 3, 4], wide: [1, 9, 3, 4], tap: true },
  list: { tall: [1, 9, 5, 13], wide: [1, 9, 5, 9] },
  detail: { tall: [1, 9, 14, 16], wide: [10, 18, 1, 5] },
  price: { tall: [1, 4, 17, 18], wide: [10, 13, 6, 9] },
  deal: { tall: [5, 9, 17, 18], wide: [14, 18, 6, 9], tap: true },
};

/** What the hero would pay, or be paid, for the row that is selected. */
export function amountFor(tab, hero, row) {
  if (!row) return null;
  if (tab === 'buy') return priceOf(hero, row);
  if (tab === 'sell') return offerFor(hero, row);
  return repairCost();
}

/**
 * The chips that compare a piece of gear with what is worn (`00`, Shop:
 * "green/red compare chips against what's equipped").
 */
export function compareChips(hero, entry) {
  const slot = equipSlotFor(entry.baseId);
  if (!slot) return { against: null, chips: [] };
  const worn = equippedItem(hero.pack, slot);
  if (!worn) return { against: null, chips: [] };

  const base = itemOf(entry.baseId);
  const chips = [];
  const add = (label, delta) => {
    if (delta === 0) return;
    chips.push({ label: `${label} ${delta > 0 ? '+' : ''}${delta}`, better: delta > 0 });
  };

  if (base.category === 'weapon') {
    add('HIT', (base.toHit ?? 0) + (entry.bonus ?? 0) - ((worn.toHit ?? 0) + (worn.bonus ?? 0)));
    add('DMG', average(base.damage) + (entry.bonus ?? 0) - (average(worn.damage) + (worn.bonus ?? 0)));
  } else {
    add('DEF', (base.def ?? 0) + (entry.bonus ?? 0) - ((worn.def ?? 0) + (worn.bonus ?? 0)));
    add('SLOTS', (base.slots ?? 1) - (worn.slots ?? 1));
  }
  return { against: worn, chips };
}

/** The average of a damage die, for the mockup's "DMG +2 AVG" chip. */
export function average(damage) {
  const match = /^(\d+)d(\d+)(?:\+(\d+))?/.exec(damage ?? '');
  if (!match) return 0;
  const [, count, sides, flat] = match;
  return (Number(count) * (Number(sides) + 1)) / 2 + Number(flat ?? 0);
}

/** @type {import('../../shell/router.js').Screen} */
export const shop = {
  id: 'shop',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, run, shop: open, params = {} }) {
    const hero = run.hero;
    let tab = TABS.includes(params.tab) ? params.tab : 'buy';
    let chosen = null;

    const list = el('div', { class: 'region block' });
    const detail = el('div', { class: 'region block' });
    const price = el('div', { class: 'region note' });
    const deal = el('div', { class: 'region keyslot' });
    const tabs = el('div', { class: 'region' });

    /** What this tab lists: the shelves, the pack, or what is corroded. */
    const rowsFor = () => {
      if (tab === 'buy') return open.stock;
      if (tab === 'sell') return sellable(hero);
      return repairable(hero);
    };

    const rowId = (row) => row.id ?? row.instanceId;

    const paintTabs = () => {
      tabs.replaceChildren(
        segmented({
          options: TABS.map((id) => ({ value: id, label: t(`shop.tabs.${id}`) })),
          value: tab,
          ariaLabel: t('shop.title'),
          onPick: (value) => {
            tab = value;
            chosen = null;
            paint();
          },
        }),
      );
    };

    const paintList = () => {
      const rows = rowsFor();
      list.replaceChildren(
        scrollPanel({
          ariaLabel: t(`shop.tabs.${tab}`),
          children: rows.length
            ? rows.map((row) => {
                const known = tab === 'buy' || isIdentified(hero.identification, row);
                const card = tab === 'buy'
                  ? { name: nameOfStock(row), rarity: rarityOfStock(row) }
                  : describe(row, hero.identification);
                const line = summaryOf(row, { known });
                const amount = amountFor(tab, hero, row);
                return listRow({
                  name: card.name,
                  sub: row.rotating ? t('items.line.rotating', { line }) : line,
                  color: rarityColor(card.rarity),
                  side: t('shop.price', { n: amount }),
                  selected: rowId(row) === chosen,
                  reason: reasonFor(row),
                  onTap: () => {
                    chosen = rowId(row);
                    paint();
                  },
                });
              })
            : [el('span', { class: 'hint', text: t(`shop.empty.${tab}`) })],
        }),
      );
    };

    /** Why a row cannot be dealt with, if it cannot. */
    const reasonFor = (row) => {
      const why = tab === 'buy' ? whyNotBuy(hero, row) : tab === 'sell' ? whyNotSell(hero, row) : null;
      return why ? t(`shop.why.${why}`) : undefined;
    };

    const paintDetail = () => {
      const row = rowsFor().find((one) => rowId(one) === chosen);
      if (!row) {
        detail.replaceChildren(el('span', { class: 'hint', text: t('shop.pick') }));
        return;
      }
      const known = tab === 'buy' || isIdentified(hero.identification, row);
      const name = tab === 'buy' ? nameOfStock(row) : describe(row, hero.identification).name;
      const { against, chips } = compareChips(hero, row);
      const magic = magicLine(row);

      detail.replaceChildren(
        el('p', {
          class: 'itemname',
          text: name,
          style: { color: rarityColor(tab === 'buy' ? rarityOfStock(row) : describe(row, hero.identification).rarity) },
        }),
        el('p', { class: 'hint', text: [summaryOf(row, { known }), magic].filter(Boolean).join(' · ') }),
        chips.length || against
          ? el('div', { class: 'topbar__chips' }, [
              ...chips.map((entry) =>
                chip(`${entry.label} ${entry.better ? t('shop.better') : t('shop.worse')}`, {
                  tone: entry.better ? 'success' : 'danger',
                }),
              ),
              against ? chip(t('shop.compare', { name: itemOf(against.baseId).name })) : null,
            ])
          : null,
      );
    };

    const paintDeal = () => {
      const row = rowsFor().find((one) => rowId(one) === chosen);
      const amount = amountFor(tab, hero, row);
      price.replaceChildren(
        el('span', { class: 'reward__value', text: row ? t('shop.price', { n: amount }) : '' }),
        el('span', { class: 'hint', text: t('shop.youHave', { n: hero.gold ?? 0 }) }),
      );

      const why = row ? reasonFor(row) : t('shop.pick');
      deal.replaceChildren(
        button({
          label: t(`shop.${tab}Label`),
          kind: 'primary',
          reason: why,
          onTap: () => {
            if (tab === 'buy') buy(open, hero, row.id);
            else if (tab === 'sell') sell(hero, row.instanceId);
            else repair(hero, row.instanceId);
            chosen = null;
            paint();
          },
        }),
      );
    };

    function paint() {
      paintTabs();
      paintList();
      paintDetail();
      paintDeal();
    }
    paint();

    return {
      topBar: topBar({
        title: t('shop.title'),
        sub: t('shop.sub', { n: Math.round(SHOP_RULES.sellRate * 100) }),
        onBack: () => router.back(),
        chips: [chip(t('shop.gold', { n: hero.gold ?? 0 }), { tone: 'accent' })],
      }),
      tabs,
      list,
      detail,
      price,
      deal,
    };
  },
};

/**
 * What a shelf entry is called. Nothing in a shop is a mystery: it is named
 * with its property and its bonus, the way `04` section 4 writes one
 * ("Flaming Long Sword +2").
 */
export function nameOfStock(entry) {
  const base = itemOf(entry.baseId);
  let name = base.name;
  if (entry.property) {
    const table = ['armor', 'shield'].includes(base.category)
      ? MAGIC.armorProperties
      : MAGIC.weaponProperties;
    const property = table.properties[entry.property];
    if (property) name = t('items.property', { property: property.name, name });
  }
  if (entry.bonus) name = t('items.bonus', { name, bonus: `+${entry.bonus}` });
  return name;
}

/** A shelf entry's rarity: what it would be once it is in the pack. */
export function rarityOfStock(entry) {
  if (entry.property || (entry.bonus ?? 0) >= 2) return 'rare';
  if (entry.bonus === 1 || itemOf(entry.baseId).magic) return 'uncommon';
  return itemOf(entry.baseId).rarity;
}
