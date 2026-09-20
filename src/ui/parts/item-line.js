/**
 * The one line a screen shows under an item's name — the Shop's list, the
 * Pack's rows, the loot card (`04` section 16, and the Shop mockup's
 * *"Heal 2d6+2"*, *"Thrown · 2d6 fire"*, *"+3 max FP"*).
 *
 * Most of it is worked out from the item's own numbers, so a new item gets a
 * line by existing: a weapon reads as its dice, armour as its DEF, a potion
 * as what it heals, a scroll as what it casts, a charm as what its effects
 * say. Where no table can say it — a crowbar, a lantern, a Scroll of Return —
 * the words are in `strings.json` under `items.summary`.
 */
import { CURSES, MAGIC, item, itemOf } from '../../data/items.js';
import { t } from '../../data/strings.js';

/** "+2" and "-1", the way a name carries a bonus. */
function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

/** What a charm, a robe or a property does, in as few words as it takes. */
export function effectLine(effect) {
  const n = effect.value ?? effect.perRank ?? 1;
  if (effect.grants) {
    return t('items.effect.grants', { skill: lower(t(`skills.${effect.grants}.name`)) });
  }
  if (effect.hook) return t('items.effect.hook');
  if (effect.explore) return t('items.effect.explore', { n, what: effect.explore });
  if (effect.shop) return t('items.effect.shop');
  switch (effect.sheet) {
    case 'saves':
      return effect.save
        ? t('items.effect.savesOne', { n, save: effect.save })
        : t('items.effect.saves', { n });
    case 'resist':
      return t('items.effect.resist', { type: effect.damageType });
    case 'immune':
      return t('items.effect.immune', {
        what: (effect.conditions ?? effect.tags ?? [effect.damageType]).join(', '),
      });
    case 'attribute':
      return t('items.effect.attribute', { n, attribute: effect.attribute });
    default:
      return t(`items.effect.${effect.sheet}`, { n });
  }
}

/** What a `use` block does, in one line (`04` sections 8 to 11). */
function useLine(use) {
  if (use.heal) return t('items.line.heal', { dice: use.heal });
  if (use.fullHp) return t('items.line.fullHp');
  if (use.restoreFp) return t('items.line.restoreFp', { dice: use.restoreFp });
  if (use.fullFp) return t('items.line.fullFp');
  if (use.removeDrained) return null;
  if (use.cure) return t('items.line.cures', { what: use.cure.map(conditionName).join(', ') });
  if (use.thrown && use.damage) {
    return t('items.line.thrown', { damage: use.damage, type: use.damageType ?? '' }).trim();
  }
  if (use.thrown && use.save) {
    return t('items.line.thrownSave', { save: use.save, what: conditionName(use.condition) });
  }
  if (use.resist) return t('items.line.resist', { type: use.resist });
  if (use.attack || use.def || use.attributeMod || use.actFirst) return t('items.line.buff');
  if (use.condition) return t('items.line.applies', { what: conditionName(use.condition) });
  return null;
}

/** A condition by the name the player reads. */
function conditionName(id) {
  return id ? lower(t(`conditions.${id}.name`)) : '';
}

/**
 * A name a tile shouts reads badly inside a sentence: the skill and condition
 * strings are labels, and a line like "Casts magic missile" is prose.
 */
function lower(text) {
  return text === text.toUpperCase() ? text.toLowerCase() : text;
}

/**
 * One item's line.
 *
 * @param {object} entry a drop, a pack entry or a shelf entry
 * @param {{ known?: boolean }} [options] an unknown item says nothing it
 *   should not: only its base type shows (`04` section 5)
 */
export function summaryOf(entry, { known = true } = {}) {
  const base = itemOf(entry.baseId);
  const written = t(`items.summary.${entry.baseId}`);
  const bonus = known ? (entry.bonus ?? base.bonus ?? 0) : 0;

  switch (base.category) {
    case 'weapon': {
      const damage = bonus ? `${base.damage}${signed(bonus)}` : base.damage;
      return t('items.line.damage', { damage, type: base.damageType });
    }
    case 'armor':
    case 'shield': {
      const def = (base.def ?? 0) + bonus;
      // A Mage's Robe is armour that is not about DEF: it says what it is for.
      const own = (base.effects ?? []).map(effectLine).filter(Boolean);
      if (def === 0 && own.length > 0) return own.slice(0, 2).join(' · ');
      return t('items.line.def', { n: def });
    }
    case 'valuable':
    case 'part':
      return t('items.line.worth', { n: base.value ?? 0 });
    default:
      break;
  }

  if (!written.startsWith('items.summary.')) return written;
  if (base.casts) return t('items.line.casts', { skill: lower(t(`skills.${base.casts}.name`)) });
  if (base.use) {
    const line = useLine(base.use);
    if (line) return line;
  }
  // A charm says what it does, which is what its effects say.
  const effects = (base.effects ?? []).map(effectLine).filter(Boolean);
  if (effects.length > 0) return effects.slice(0, 2).join(' · ');
  return t(`pack.type.${base.category}`);
}

/** What a magic item's property or curse adds to the line, if anything. */
export function magicLine(entry) {
  const parts = [];
  if (entry.property) {
    const table = ['armor', 'shield'].includes(item(entry.baseId).category)
      ? MAGIC.armorProperties
      : MAGIC.weaponProperties;
    const property = table.properties[entry.property];
    if (property) parts.push(t(`items.propertyEffect.${entry.property}`));
  }
  if (entry.curse) {
    const curse = CURSES.table.find((row) => row.id === entry.curse);
    if (curse) parts.push(curse.name);
  }
  return parts.join(' · ');
}
