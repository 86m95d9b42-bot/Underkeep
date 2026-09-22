/**
 * Item Detail (`00-build-outline.md`, "Hero and Items"; `04` section 16).
 *
 * The item's name in its rarity colour, a compare table against what is
 * already worn, the notes that matter — a curse, a requirement, how to find
 * out what it is — and the three things that can be done with it.
 *
 * A bottom sheet over the Pack; in the wide frame the panel pattern puts it in
 * the right-hand columns, which is what the outline asks for.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { sheet } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { CURSES, MAGIC, item, itemOf, sellFor, slotsFor } from '../../data/items.js';
import { describe, isIdentified, isRevealed } from '../../systems/identification.js';
import {
  entryOf,
  equipSlotFor,
  equippedItem,
  isConsumable,
  isEquipped,
  isTwoHanded,
  pin,
  removeItem,
  slotOf,
  unpin,
  whyNotEquip,
  whyNotPin,
} from '../../systems/inventory.js';
import { takeOff, wear } from '../../systems/gear.js';
import { actionForItem, consumeItem, whyNotUse } from '../../systems/use-item.js';
import { resolveItemAction } from '../../engine/item-actions.js';
import { rarityColor } from './pack.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  sheet: { tall: [1, 9, 6, 18], wide: [13, 18, 1, 9], side: 'right' },
};

/** The stats a compare table shows for this kind of item (`04` section 16). */
export function statsFor(baseId) {
  const entry = itemOf(baseId);
  switch (entry.category) {
    case 'weapon':
      return ['damage', 'toHit', 'slots'];
    case 'armor':
    case 'shield':
      return ['def', 'maxAgi', 'stealth', 'slots'];
    case 'valuable':
    case 'part':
      return ['value'];
    default:
      return ['slots', 'cost'];
  }
}

/** One stat's value on one item, as the table prints it. */
export function statOf(instance, key, { known = true } = {}) {
  if (!instance) return t('pack.none');
  const entry = itemOf(instance.baseId);
  const bonus = known ? (instance.bonus ?? 0) : 0;
  switch (key) {
    case 'damage': {
      if (!entry.damage) return t('pack.none');
      const sign = bonus ? (bonus > 0 ? ` +${bonus}` : ` ${bonus}`) : '';
      return `${entry.damage} ${entry.damageType}${sign}`;
    }
    case 'def':
      return String((entry.def ?? 0) + bonus);
    case 'toHit': {
      const total = (entry.toHit ?? 0) + bonus;
      return total > 0 ? `+${total}` : String(total);
    }
    case 'maxAgi':
      return entry.maxAgi === undefined ? t('pack.none') : `+${entry.maxAgi}`;
    case 'stealth':
      return String(entry.stealth ?? 0);
    case 'slots':
      return String(slotsFor(instance.baseId, 1));
    case 'value':
      return String(entry.value ?? 0);
    case 'cost':
      return String(sellFor(instance.baseId, { identified: known, bonus }));
    default:
      return t('pack.none');
  }
}

/** The lines under the compare table: what the player needs to be told. */
export function notesFor(hero, instance) {
  const entry = itemOf(instance.baseId);
  const known = isIdentified(hero.identification, instance);
  const notes = [];

  if (!known) {
    notes.push(t('pack.detail.note.unknown'));
    if (entry.magic || instance.bonus || instance.property) {
      notes.push(t('pack.detail.note.curseRisk'));
    }
  }
  if (instance.curse && (known || isRevealed(instance, 'curse'))) {
    const curse = CURSES.table.find((row) => row.id === instance.curse);
    notes.push(t('pack.detail.note.cursed', { curse: curse?.name ?? instance.curse }));
  }
  if (instance.bound) notes.push(t('pack.detail.note.bound'));
  if (known && instance.property) {
    const table = ['armor', 'shield'].includes(entry.category)
      ? MAGIC.armorProperties
      : MAGIC.weaponProperties;
    const property = table.properties[instance.property];
    if (property) {
      notes.push(
        t('pack.detail.note.property', {
          property: property.name,
          effect: t(`items.propertyEffect.${instance.property}`),
        }),
      );
    }
  }
  for (const [attribute, score] of Object.entries(item(instance.baseId).requires ?? {})) {
    notes.push(t('pack.detail.note.requires', { attribute: t(`attributes.${attribute}.name`), score }));
  }
  if (isTwoHanded(instance.baseId)) notes.push(t('pack.detail.note.twoHanded'));
  if (entry.category === 'scroll') {
    notes.push(
      t('pack.detail.note.school', {
        school: entry.school,
        attribute: entry.school === 'spirit' ? t('attributes.wits.name') : t('attributes.intellect.name'),
      }),
    );
  }
  return notes;
}

/** @type {import('../../shell/router.js').Screen} */
export const itemDetail = {
  id: 'itemDetail',
  pattern: 'panel',
  regions: REGIONS,

  build({ router, run, params = {}, leaveDungeon }) {
    const close = () => router.closeSheet();
    const shown = itemDetailBody({
      router,
      run,
      instanceId: params.item,
      leaveDungeon,
      done: () => {
        close();
        router.go('pack', { filter: params.filter });
      },
      leave: close,
    });
    return {
      sheet: sheet({
        title: t('pack.detail.title'),
        sideNote: shown.badge,
        onClose: close,
        children: [shown.body],
      }),
    };
  },
};

/**
 * What an item is and what can be done with it: the name and type line, the
 * compare table, the notes, and DROP / QUICK SLOT / EQUIP or USE (`00`, Item
 * Detail). The sheet shows it over the pack; the wide Pack screen shows it as
 * its own panel, cols 13–18 (`00`, "item detail cols 13–18 as a panel, not a
 * sheet").
 *
 * @param {object} options
 * @param {object} options.router
 * @param {object} options.run
 * @param {string | null} options.instanceId
 * @param {Function} [options.leaveDungeon]
 * @param {() => void} options.done after an action changed the pack
 * @param {() => void} [options.leave] before a scroll takes the hero home
 * @returns {{ body: HTMLElement, badge?: string }}
 */
export function itemDetailBody({ router, run, instanceId, leaveDungeon, done, leave = () => {} }) {
  const hero = run.hero;
  const held = hero.pack;
  const instance = held ? entryOf(held, instanceId) : null;

  if (!instance) {
    return {
      body: el('div', { class: 'sheet__body', style: { gridColumn: '1 / -1', gridRow: '2' } }, [
        el('p', { class: 'sheet__empty', text: t('pack.why.notCarried') }),
      ]),
    };
  }
  const card = describe(instance, hero.identification);
  const known = card.identified;
  const worn = isEquipped(held, instance.instanceId);
  const slot = equipSlotFor(instance.baseId);
  const against = slot && !worn ? equippedItem(held, slot) : null;

  /* -- rows 8-12: the compare table ---------------------------------- */

  const rows = statsFor(instance.baseId).map((key) =>
    el('div', { class: 'statline' }, [
      el('span', { class: 'statline__label', text: t(`pack.detail.stats.${key}`) }),
      el('span', {
        class: 'statline__value',
        text: against ? statOf(against, key) : '',
      }),
      el('span', {
        class: 'statline__value',
        text: known ? statOf(instance, key, { known }) : t('pack.detail.unknownValue'),
      }),
    ]),
  );

  const compare = el('div', { class: 'block' }, [
    el('div', { class: 'statline statline--head' }, [
      el('span', { class: 'statline__label', text: t('pack.detail.compare') }),
      el('span', { class: 'statline__value', text: against ? t('pack.detail.equipped') : '' }),
      el('span', { class: 'statline__value', text: t('pack.detail.thisItem') }),
    ]),
    ...rows,
  ]);

  /* -- rows 13-15: the notes ----------------------------------------- */

  const notes = notesFor(hero, instance);
  const noteBox = el('div', { class: 'block' }, [
    el('span', { class: 'block__label', text: t('pack.detail.notes') }),
    ...(notes.length
      ? notes.map((line) => el('p', { class: 'hint', text: line }))
      : [el('p', { class: 'hint', text: t(worn ? 'pack.detail.note.equipped' : 'pack.detail.note.none') })]),
  ]);

  /* -- rows 16-18: what can be done with it -------------------------- */

  const refresh = () => done();

  const pinned = held.quick.includes(instance.instanceId);
  const pinWhy = whyNotPin(held, instance.instanceId);
  const useWhy = whyNotUse(hero, instance, { inCombat: false });
  const equipWhy = worn ? null : whyNotEquip(held, instance.instanceId);

  const actions = el('div', { class: 'sheet__footer' }, [
    button({
      label: t('pack.detail.drop'),
      kind: 'risky',
      reason: instance.bound ? t('pack.why.cursedInPlace') : undefined,
      onTap: () => {
        removeItem(held, instance.instanceId, 1);
        refresh();
      },
    }),
    isConsumable(instance.baseId)
      ? button({
          label: pinned ? t('pack.detail.unpin') : t('pack.detail.quick'),
          reason: pinned || !pinWhy ? undefined : t(`pack.why.${pinWhy}`),
          onTap: () => {
            if (pinned) unpin(held, held.quick.indexOf(instance.instanceId));
            else pin(held, instance.instanceId);
            refresh();
          },
        })
      : null,
    // A consumable is used; anything that can be worn is worn or taken off.
    isConsumable(instance.baseId)
      ? button({
          label: t('pack.detail.use'),
          kind: 'primary',
          reason: useWhy ? t(`combat.illegal.${useWhy}`) : undefined,
          onTap: () => {
            const built = actionForItem(hero, instance.instanceId, { inCombat: false });
            if (!built.action) return;
            const used = resolveItemAction(
              { rng: run.rng.combat, hooks: null, units: [], floor: run.floor?.floor ?? 1 },
              hero,
              built.action,
            );
            consumeItem(hero, instance.instanceId);
            // A Scroll of Return ends the trip where it is read
            // (`04` section 9, `05` section 9).
            if (used?.returnToTown && leaveDungeon) {
              leave();
              leaveDungeon({ leaveMark: used.leavesMark });
              return;
            }
            refresh();
          },
        })
      : button({
          label: worn ? t('pack.detail.takeOff') : t('pack.detail.equip'),
          kind: 'primary',
          reason: worn
            ? instance.bound
              ? t('pack.why.cursedInPlace')
              : undefined
            : equipWhy
              ? t(`pack.why.${equipWhy}`)
              : undefined,
          onTap: () => {
            if (worn) takeOff(hero, slotOf(held, instance.instanceId));
            else wear(hero, instance.instanceId);
            refresh();
          },
        }),
  ]);

  const body = el(
    'div',
    { class: 'sheet__body', style: { gridColumn: '1 / -1', gridRow: '2' } },
    [
      el('div', { class: 'scroll' }, [
        el('p', { class: 'itemname', text: card.name, style: { color: rarityColor(card.rarity) } }),
        el('p', { class: 'hint', text: typeLine(instance) }),
        compare,
        noteBox,
      ]),
      actions,
    ],
  );

  return { body, badge: card.badge ?? undefined };
}

/** "Weapon · Blade · 1 slot", the line under the name. */
function typeLine(instance) {
  const entry = itemOf(instance.baseId);
  const parts = [t(`pack.type.${entry.category}`)];
  if (entry.group) parts.push(entry.group);
  parts.push(
    slotsFor(instance.baseId, 1) === 1
      ? t('pack.slotCount', { n: 1 })
      : t('pack.slotCountMany', { n: slotsFor(instance.baseId, 1) }),
  );
  return parts.join(' · ');
}
