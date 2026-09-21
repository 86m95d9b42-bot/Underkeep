/**
 * What a hero walks in carrying (`01` section 3's kits), and what their gear
 * does to their sheet.
 *
 * The kit is now the real thing: `04`'s items, in the pack `inventory.js`
 * keeps. The origin's lines say what to hand over and which two pieces to
 * equip; everything else goes in the pack, where it takes slots.
 *
 * `refreshGear` is the one place that reads the equipped items and writes what
 * the rest of the game looks at — `hero.weapon`, `hero.armor`, `hero.attack`
 * and the `hero.gear` summary the sheet folds in. Nothing else reaches into
 * the pack to ask what is worn.
 */
import { itemOf } from '../data/items.js';
import { origin as originOf } from '../data/origins.js';
import {
  addItem,
  attackWith,
  capacityFor,
  createPack,
  equipNew,
  equippedItem,
  gearSummary,
} from './inventory.js';

/**
 * The means the hero has of getting through something shut (`03` section 6).
 *
 * A tool in the pack, a skill on the tree or a scroll they can read all count
 * the same to a locked door, so this is one answer from all three — and it is
 * what `locks.js` asks before it offers a way.
 *
 * @param {object} hero
 * @returns {Record<string, boolean>}
 */
export function meansOf(hero) {
  const carries = (baseId) => (hero.pack?.items ?? []).some((entry) => entry.baseId === baseId);
  const knows = (id) => (hero.skills ?? []).some((row) => row.id === id);

  return {
    lockpicks: carries('lockpicks') || carries('masterwork_lockpicks'),
    crowbar: carries('crowbar'),
    pole: carries('ten_foot_pole'),
    skeletonKey: carries('skeleton_key'),
    // A scroll is as good as the skill, where the hero can read it
    // (`04` section 9's requirement is checked when it is used).
    knock: knows('knock') || carries('scroll_of_knock'),
    dispelWard: knows('dispel_ward') || carries('scroll_of_dispel'),
    lore: knows('lore'),
    // Fire, for a web curtain: a torch, a flask of oil, or a spell
    // (`03` section 8).
    fire: carries('torch') || carries('oil_flask') || knows('fireball'),
  };
}

/** The weapon and armour an origin's kit equips, resolved from `04`. */
export function kitOf(origin) {
  const entries = originOf(origin)?.kit ?? [];
  const find = (slot) => {
    const line = entries.find((entry) => entry.equip === slot);
    return line ? { id: line.item, ...itemOf(line.item) } : null;
  };
  return { weapon: find('weapon'), armor: find('armor') };
}

/** What the hero's worn gear adds to DEF (`01` section 4: 10 + AGI mod + armor). */
export function gearDef(hero) {
  return hero?.gear?.def ?? (hero?.pack ? gearSummary(hero.pack, hero).def : 0);
}

/** The cap the worn armour puts on the AGI mod that counts towards DEF. */
export function maxAgiFor(hero) {
  return hero?.gear?.maxAgi ?? (hero?.pack ? gearSummary(hero.pack, hero).maxAgi : null);
}

/**
 * The hero's scores with whatever their gear adds (`04` section 7: the Lucky
 * Coin's "+1 to LCK score, max 20"). The hero's own attributes are left alone:
 * taking the charm off takes the point with it.
 * @param {object} hero
 */
export function wornScores(hero) {
  const shift = hero?.gear?.attributes;
  if (!shift) return hero?.attributes ?? {};
  const out = { ...hero.attributes };
  for (const [attribute, amount] of Object.entries(shift)) {
    out[attribute] = (out[attribute] ?? 0) + amount;
  }
  return out;
}

/**
 * Reads the pack and writes what the rest of the game looks at. Called
 * whenever the gear changes and at every sheet rebuild, so these are never
 * stale and never counted twice.
 * @param {object} hero
 */
export function refreshGear(hero) {
  if (!hero.pack) return hero;
  hero.gear = gearSummary(hero.pack, hero);
  // What the hero could try on a shut door, from the pack and the tree
  // together (`03` section 6).
  hero.has = meansOf(hero);
  hero.weapon = equippedItem(hero.pack, 'weapon');
  hero.armor = equippedItem(hero.pack, 'armor');
  hero.offHand = equippedItem(hero.pack, 'offHand');
  hero.charm = equippedItem(hero.pack, 'charm');
  hero.attack = attackWith(hero.pack);
  hero.pack.capacity = capacityFor(hero);
  return hero;
}

/**
 * Puts the origin's kit on a new hero (`01` section 3).
 *
 * The two equipped pieces go straight into their slots, because equipped gear
 * costs no slots (`04` section 1) and a hero should never start undressed.
 * The rest goes in the pack; anything that will not fit — a hero with a very
 * low Might has few slots — is handed back rather than silently lost.
 *
 * @param {object} hero
 * @returns {object} the same hero
 */
export function equipKit(hero) {
  const lines = originOf(hero.origin)?.kit ?? [];
  hero.pack = createPack({ capacity: capacityFor(hero) });

  for (const line of lines.filter((entry) => entry.equip)) {
    equipNew(hero.pack, line.item, { identified: true });
  }

  const leftBehind = [];
  for (const line of lines.filter((entry) => !entry.equip)) {
    const { left } = addItem(hero.pack, line.item, { count: line.count ?? 1, identified: true });
    if (left > 0) leftBehind.push({ item: line.item, count: left });
  }
  if (leftBehind.length > 0) hero.kitLeftBehind = leftBehind;

  return refreshGear(hero);
}
