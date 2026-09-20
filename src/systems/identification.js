/**
 * What the hero knows about what they are carrying (`04` section 5).
 *
 * Three things are unknown when they are found: magic gear, most potions and
 * every scroll. They are learned in different ways, and the document's table
 * is the whole of it — the Sage, the Lore skill, a Scroll of Identify, buying,
 * drinking, reading, equipping and wearing.
 *
 * **Per game.** Potion appearances and scroll titles are shuffled once per
 * save and kept with it (`04` section 17), so the Murky Potion is a different
 * thing in every game. The shuffle comes from the **appearance** stream, which
 * is derived from the master seed: the save stores it, and it can always be
 * rebuilt.
 *
 * **Per type, then per item.** A potion or a scroll is known by *type*: drink
 * one Focus Tonic and every Focus Tonic is a Focus Tonic for the rest of the
 * game. A piece of gear is known one secret at a time — the bonus shows after
 * a combat, the property when it first triggers, the curse the moment it is
 * put on — so an item is only fully identified once it has no secrets left.
 *
 * No DOM: the words come from `strings.json`, and the screens ask for them.
 */
import { CURSES, IDENTIFICATION, MAGIC, item, itemOf, itemsOfCategory } from '../data/items.js';
import { appearanceStream } from '../engine/rng.js';
import { hasExplore } from './skill-tree.js';
import { t } from '../data/strings.js';

/** Categories whose knowledge is shared by every item of the type. */
const BY_TYPE = ['potion', 'scroll'];

/** How many steps a worn charm takes to give itself away (`04` section 5). */
export const CHARM_STEPS = IDENTIFICATION.methods.wearingCharm.afterSteps;

/** How many combats an equipped item's bonus takes to show. */
export const BONUS_COMBATS = IDENTIFICATION.methods.equipping.bonusAfterCombats;

/* -------------------------------------------------------------------------- */
/* The per-game shuffle                                                       */
/* -------------------------------------------------------------------------- */

/** Every potion that is found unknown, in database order. */
export function unknownPotions() {
  return itemsOfCategory('potion').filter((id) => !item(id).alwaysKnown);
}

/** Every scroll: all of them are found unknown (`04` section 5). */
export function scrollTypes() {
  return itemsOfCategory('scroll');
}

/**
 * The looks and titles one game uses, and what is known from the start.
 * @param {number | string} masterSeed
 * @returns {{ potionLooks: Record<string, string>, scrollTitles: Record<string, string>,
 *   knownTypes: string[] }}
 */
export function createIdentification(masterSeed) {
  const rng = appearanceStream(masterSeed);

  const potions = unknownPotions();
  const looks = rng.shuffle(IDENTIFICATION.potionLooks);
  const potionLooks = Object.fromEntries(potions.map((id, index) => [id, looks[index]]));

  // Two words, never the same pair twice: every ordered pair is made, shuffled
  // and dealt out, so no two scrolls share a title.
  const words = IDENTIFICATION.scrollWords;
  const pairs = [];
  for (const first of words) {
    for (const second of words) {
      if (first !== second) pairs.push(`${first} ${second}`);
    }
  }
  const titles = rng.shuffle(pairs);
  const scrollTitles = Object.fromEntries(scrollTypes().map((id, index) => [id, titles[index]]));

  return {
    potionLooks,
    scrollTitles,
    knownTypes: [...IDENTIFICATION.alwaysKnown],
  };
}

/** What an unknown potion looks like in this game. */
export function lookOf(state, baseId) {
  return state?.potionLooks?.[baseId] ?? null;
}

/** What an unknown scroll is labelled in this game. */
export function titleOf(state, baseId) {
  return state?.scrollTitles?.[baseId] ?? null;
}

/* -------------------------------------------------------------------------- */
/* What is known                                                              */
/* -------------------------------------------------------------------------- */

/** True for a type the hero has met before (`04` section 5, "once one…"). */
export function isKnownType(state, baseId) {
  return Boolean(state?.knownTypes?.includes(baseId));
}

/** Learns a whole type, which is what drinking, reading or a Sage does. */
export function learnType(state, baseId) {
  if (!state) return false;
  state.knownTypes ??= [];
  if (state.knownTypes.includes(baseId)) return false;
  state.knownTypes.push(baseId);
  return true;
}

/**
 * The secrets an item is keeping. Gear keeps up to three — its bonus, its
 * property and its curse; a charm keeps what it does; a potion or a scroll
 * keeps its type, and that one is shared by every item like it.
 * @param {object} instance a drop or a pack entry
 * @returns {string[]}
 */
export function secretsOf(instance) {
  const entry = item(instance.baseId);
  if (BY_TYPE.includes(entry.category)) return entry.alwaysKnown ? [] : ['type'];

  const secrets = [];
  if (instance.bonus) secrets.push('bonus');
  if (instance.property) secrets.push('property');
  if (instance.curse) secrets.push('curse');
  // A charm or a magic robe carries its magic in its name rather than in a
  // bonus: what it does is the secret.
  if (entry.magic && !instance.bonus && !instance.property) secrets.push('effect');
  return secrets;
}

/** True once this one secret is out. */
export function isRevealed(instance, secret) {
  return Boolean(instance?.revealed?.includes(secret));
}

/**
 * Whether the hero knows what this item is: every secret out, or — for a
 * potion or a scroll — the type met before.
 */
export function isIdentified(state, instance) {
  if (!instance) return false;
  const entry = item(instance.baseId);
  if (BY_TYPE.includes(entry.category)) {
    return entry.alwaysKnown || isKnownType(state, instance.baseId) || Boolean(instance.identified);
  }
  const secrets = secretsOf(instance);
  if (secrets.length === 0) return true;
  return secrets.every((secret) => isRevealed(instance, secret));
}

/**
 * Lets one secret out. Returns what changed, so the caller can log it.
 * @returns {{ revealed: string[], identified: boolean }}
 */
export function reveal(state, instance, secret) {
  const secrets = secretsOf(instance);
  const out = [];
  if (secret === 'type' || BY_TYPE.includes(item(instance.baseId).category)) {
    if (learnType(state, instance.baseId)) out.push('type');
    instance.identified = true;
    return { revealed: out, identified: true };
  }
  if (secrets.includes(secret) && !isRevealed(instance, secret)) {
    instance.revealed = [...(instance.revealed ?? []), secret];
    out.push(secret);
  }
  const identified = isIdentified(state, instance);
  instance.identified = identified;
  return { revealed: out, identified };
}

/** Lets every secret out at once: the Sage, Lore, a Scroll of Identify, buying. */
export function identify(state, instance) {
  const secrets = secretsOf(instance);
  const before = secrets.filter((secret) => !isRevealed(instance, secret));
  for (const secret of secrets) reveal(state, instance, secret);
  instance.identified = true;
  if (BY_TYPE.includes(item(instance.baseId).category)) learnType(state, instance.baseId);
  return { revealed: before, identified: true };
}

/* -------------------------------------------------------------------------- */
/* The ways to identify (`04` section 5)                                      */
/* -------------------------------------------------------------------------- */

/** What the Sage charges for one item, and for a pack of them. */
export function sageFee(count = 1) {
  return IDENTIFICATION.methods.sage.cost * count;
}

/** Every item in the pack the Sage would charge for, unknown ones only. */
export function unknownIn(state, pack) {
  return (pack?.items ?? []).filter((entry) => !isIdentified(state, entry));
}

/**
 * A Scroll of Identify, or the Sage taking the lot: everything in the pack.
 * @returns {object[]} the entries that were learned
 */
export function identifyPack(state, pack) {
  const learned = unknownIn(state, pack);
  for (const entry of learned) identify(state, entry);
  return learned;
}

/**
 * Picking something up. A hero with **Lore** knows it at once; everyone else
 * carries it unknown.
 * @param {object} hero
 * @param {object} instance
 */
export function onPickUp(hero, instance) {
  if (!hasExplore(hero, 'identify')) return { revealed: [], identified: false, by: null };
  return { ...identify(hero.identification, instance), by: 'lore' };
}

/** Anything bought in a shop is identified (`04` section 5). */
export function onBuy(state, instance) {
  return { ...identify(state, instance), by: 'bought' };
}

/** Drinking a potion, or reading a scroll: the type is learned either way. */
export function onUse(state, instance) {
  const category = item(instance.baseId).category;
  const by = category === 'scroll' ? 'read' : 'drunk';
  return { ...reveal(state, instance, 'type'), by };
}

/**
 * Putting something on. A curse gives itself away at once; everything else
 * waits — the bonus for a combat, the property for the moment it works, a
 * charm for a hundred steps.
 */
export function onEquip(state, instance) {
  if (instance.curse && !isRevealed(instance, 'curse')) {
    return { ...reveal(state, instance, 'curse'), by: 'curse', cursed: true };
  }
  instance.wornCombats ??= 0;
  instance.wornSteps ??= 0;
  return { revealed: [], identified: isIdentified(state, instance), by: null };
}

/**
 * A combat has ended with this gear on: an unknown bonus shows itself
 * (`04` section 5, Equipping).
 */
export function afterCombat(state, pack) {
  const learned = [];
  for (const instance of equippedOf(pack)) {
    instance.wornCombats = (instance.wornCombats ?? 0) + 1;
    if (instance.wornCombats < BONUS_COMBATS) continue;
    if (instance.bonus && !isRevealed(instance, 'bonus')) {
      reveal(state, instance, 'bonus');
      learned.push(instance);
    }
  }
  return learned;
}

/**
 * Steps taken with a charm on: after a hundred, it shows what it does
 * (`04` section 5, Wearing).
 */
export function afterSteps(state, pack, steps = 1) {
  const learned = [];
  for (const instance of equippedOf(pack)) {
    if (item(instance.baseId).category !== 'charm') continue;
    instance.wornSteps = (instance.wornSteps ?? 0) + steps;
    if (instance.wornSteps < CHARM_STEPS) continue;
    if (!isIdentified(state, instance)) {
      identify(state, instance);
      learned.push(instance);
    }
  }
  return learned;
}

/**
 * A property or a charm doing its thing for the first time gives it away
 * (`04` section 5, Equipping and Wearing).
 */
export function onTrigger(state, instance) {
  if (item(instance.baseId).category === 'charm') {
    return { ...identify(state, instance), by: 'triggered' };
  }
  return { ...reveal(state, instance, 'property'), by: 'triggered' };
}

/** The equipped entries of a pack, as instances. */
function equippedOf(pack) {
  const ids = Object.values(pack?.equipped ?? {}).filter(Boolean);
  return (pack?.items ?? []).filter((entry) => ids.includes(entry.instanceId));
}

/* -------------------------------------------------------------------------- */
/* What the player reads                                                      */
/* -------------------------------------------------------------------------- */

/** The name shown for an unknown item: its base type, and nothing more. */
function unknownName(instance, state) {
  const entry = itemOf(instance.baseId);
  if (entry.category === 'potion') {
    return t('items.potion', { look: lookOf(state, instance.baseId) ?? entry.name });
  }
  if (entry.category === 'scroll') {
    return t('items.scroll', { title: titleOf(state, instance.baseId) ?? entry.name });
  }
  // Gear shows its base type only. A charm is disguised further: `04` writes
  // it as "Plain Ring", so every ring reads alike until one is known.
  const plain = item(instance.baseId).plain;
  if (plain) return t('items.plain', { name: plain });
  const base = item(instance.baseId).base;
  return t('items.unknown', { name: base ? item(base).name : entry.name });
}

/** A signed bonus, the way an item's name carries it: "+2", "-1". */
function signed(bonus) {
  return bonus > 0 ? `+${bonus}` : `${bonus}`;
}

/**
 * What to call an item on screen (`04` sections 5 and 16).
 *
 * Known: "Flaming Long Sword +2". Half known: "Long Sword +2", until the
 * property shows itself. Unknown: "Unknown Long Sword", "Plain Ring",
 * "Murky Potion", "Scroll labeled VORN ESKEL".
 *
 * @param {object} instance
 * @param {object} [state] the game's looks and titles
 */
export function nameOf(instance, state = null) {
  if (!instance) return '';
  const entry = itemOf(instance.baseId);
  const known = isIdentified(state, instance);
  if (!known && !isRevealed(instance, 'bonus') && !isRevealed(instance, 'curse')) {
    return unknownName(instance, state);
  }

  let name = entry.name;
  if (isRevealed(instance, 'property') || (known && instance.property)) {
    const table = ['armor', 'shield'].includes(entry.category)
      ? MAGIC.armorProperties
      : MAGIC.weaponProperties;
    const property = table.properties[instance.property];
    if (property) name = t('items.property', { property: property.name, name });
  }
  if (instance.bonus && (known || isRevealed(instance, 'bonus'))) {
    name = t('items.bonus', { name, bonus: signed(instance.bonus) });
  }
  if (instance.curse && (known || isRevealed(instance, 'curse'))) {
    name = t('items.cursed', { name });
  }
  return name;
}

/**
 * Everything a screen needs to draw one entry: what to call it, what colour
 * the border is, and which badge it wears (`04` section 16).
 *
 * An unknown item never shows its real rarity — that would give a curse away
 * before it is revealed.
 */
export function describe(instance, state = null) {
  const known = isIdentified(state, instance);
  const cursed = Boolean(instance.curse) && (known || isRevealed(instance, 'curse'));
  return {
    id: instance.instanceId ?? null,
    baseId: instance.baseId,
    name: nameOf(instance, state),
    count: instance.count ?? 1,
    identified: known,
    cursed,
    rarity: cursed ? 'cursed' : known ? (instance.rarity ?? item(instance.baseId).rarity) : 'unknown',
    badge: cursed ? t('items.badge.cursed') : known ? null : t('items.badge.unknown'),
  };
}

/** The name of a curse, for the Item Detail sheet. */
export function curseName(id) {
  return CURSES.table.find((row) => row.id === id)?.name ?? null;
}
