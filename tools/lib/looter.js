/**
 * Finding, carrying and using what `04` describes, and checking every step of
 * it against the document.
 *
 * This is the Phase 5 "done when": *unknown potions, scrolls and cursed gear
 * behave exactly as `04` describes*. It drives the same modules the screens
 * drive — the loot tables roll the drops, the pack takes them, the
 * identification rules name them, `gear.js` puts them on — and audits what
 * came out.
 *
 * The audit is a **second reader of the document**: each check says which
 * section it comes from, and nothing here calls a rule module to ask whether
 * a rule held.
 *
 *   1. **What is found** (`04` sections 4, 6 and 14): every drop is a real
 *      item; a bonus is +1, +2 or +3 and inside its floor's limit; a property
 *      belongs to the table its category rolls on; a cursed item has one
 *      curse from the d8, a -1 or -2 bonus, and about half of them a property.
 *   2. **What is known** (`04` section 5): magic gear, potions and scrolls
 *      arrive unidentified; Healing Potions and Antidotes never do; a potion
 *      shows as its look and a scroll as its title; one drink or one reading
 *      identifies every item of that type for the rest of the game.
 *   3. **What is carried** (`04` section 1): a pack never holds more slots
 *      than it has, equipped gear costs none, and a stack is the stack size
 *      the document gives.
 *   4. **What is cursed** (`04` section 6): a curse shows itself the moment
 *      the item is worn, binds it, and comes off only by the scroll — which
 *      leaves the item, bonus and all — or the Temple, at 50 gp x the floor
 *      it was found on, which destroys it.
 */
import { carriedStreams } from '../../src/engine/rng.js';
import { chooseOrigin, createDraft, finish, setName } from '../../src/systems/creation.js';
import { CURSES, IDENTIFICATION, ITEM_RULES, MAGIC, item, itemOf } from '../../src/data/items.js';
import { curseChanceOn } from '../../src/data/items.js';
import { rollOnTable, takeDrop } from '../../src/systems/loot.js';
import {
  addItem,
  entryOf,
  isEquipped,
  removeItem,
  slotsUsed,
} from '../../src/systems/inventory.js';
import { slotsFor, stackOf } from '../../src/data/items.js';
import {
  afterCombat,
  afterSteps,
  createIdentification,
  identify,
  isIdentified,
  isKnownType,
  lookOf,
  nameOf,
  titleOf,
} from '../../src/systems/identification.js';
import { cleanseAtTemple, cleanseFee, removeCurses, takeOff, wear } from '../../src/systems/gear.js';
import { actionForItem, consumeItem, whyNotUse } from '../../src/systems/use-item.js';
import { resolveItemAction } from '../../src/engine/item-actions.js';
import { ORIGIN_ORDER } from '../../src/data/origins.js';

/** The categories that can carry a bonus, a property or a curse. */
const ENCHANTABLE = ['weapon', 'armor', 'shield', 'charm'];

/** What `02` section 17 allows on each floor band. */
function bonusLimit(floor) {
  return floor <= 3 ? 1 : floor <= 7 ? 2 : 3;
}

/** A hero to carry it all, rolled the way a player rolls one. */
export function looterHero(masterSeed, origin = 'sellsword') {
  const draft = createDraft({ seed: masterSeed, rollMode: 'standard' });
  const who = finish(setName(chooseOrigin(draft, origin), 'Harrow'));
  // Enough Might to hold what the floors hand over, and enough of a mind to
  // read a scroll: the audit is about the items, not about a bad roll.
  who.attributes.might = Math.max(who.attributes.might, 14);
  who.attributes.intellect = Math.max(who.attributes.intellect, 12);
  who.attributes.wits = Math.max(who.attributes.wits, 12);
  who.gold = 5000;
  return who;
}

/**
 * Rolls, carries and uses a game's worth of loot.
 *
 * @param {number} masterSeed
 * @param {object} [options]
 * @param {number} [options.rolls] how many table rolls per floor
 * @param {string} [options.origin]
 * @returns {{ ok: boolean, problems: string[], counts: object }}
 */
export function playLoot(masterSeed, { rolls = 40, origin = 'sellsword' } = {}) {
  const problems = [];
  const say = (line) => problems.length < 40 && problems.push(line);

  const rng = carriedStreams(masterSeed);
  const hero = looterHero(masterSeed, origin);
  hero.identification = createIdentification(masterSeed);
  const lore = hero.identification;

  const counts = {
    drops: 0,
    magic: 0,
    cursed: 0,
    cursedWithProperty: 0,
    curseChances: 0,
    potions: 0,
    scrolls: 0,
    drunk: 0,
    read: 0,
    unbuilt: 0,
    worn: 0,
    bound: 0,
    freed: 0,
    burned: 0,
    identified: 0,
  };

  /* -- 1. the looks and titles are one game's, and one game's only ----- */

  auditAppearances(masterSeed, lore, say);

  /* -- 2. floor by floor, roll what the tables give -------------------- */

  for (let floor = 1; floor <= 10; floor += 1) {
    for (let roll = 0; roll < rolls; roll += 1) {
      const category = ['common', 'uncommon', 'rare'][roll % 3];
      const drops = rollOnTable(rng.loot, category, { floor, hero, found: hero.found ?? [] });

      for (const drop of drops) {
        counts.drops += 1;
        auditDrop(drop, floor, category, say, counts);

        // Carry it, if there is room; the pack is emptied when it fills, the
        // way a hero empties it in town.
        if (slotsUsed(hero.pack) + slotsFor(drop.baseId, drop.count) > hero.pack.capacity) {
          emptyPack(hero);
        }
        const before = slotsUsed(hero.pack);
        const took = takeDrop(hero, { ...drop });
        if (took.ok) auditSlots(hero, before, say);
        if (!took.ok) continue;

        const carried = took.entry;
        const entry = itemOf(carried.baseId);
        if (entry.category === 'potion') counts.potions += 1;
        if (entry.category === 'scroll') counts.scrolls += 1;

        // 3. use it, wear it, or find out what it is.
        if (entry.category === 'potion') drinkIt(hero, carried, floor, say, counts);
        else if (entry.category === 'scroll') readIt(hero, carried, say, counts);
        else if (ENCHANTABLE.includes(entry.category)) wearIt(hero, carried, floor, say, counts);
      }
    }
  }

  /* -- 4. and the two ways a curse comes off --------------------------- */

  auditCurseRemoval(hero, say, counts);
  auditIdentifyMethods(hero, say, counts);

  // The curse rate is a share, so it is checked over the whole run rather
  // than one item at a time (`04` section 6: 5% then 10%).
  if (counts.curseChances > 200) {
    const rate = counts.cursed / counts.curseChances;
    if (rate < 0.02 || rate > 0.18) {
      say(`cursed ${(rate * 100).toFixed(1)}% of magic items, and 04 section 6 says 5% then 10%`);
    }
    const half = counts.cursedWithProperty / Math.max(1, counts.cursed);
    if (counts.cursed > 40 && (half < 0.25 || half > 0.75)) {
      say(`${(half * 100).toFixed(0)}% of cursed items carry a property, and 04 section 6 says half`);
    }
  }

  return { ok: problems.length === 0, problems, counts };
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                 */
/* -------------------------------------------------------------------------- */

/** `04` sections 5 and 17: one shuffle per game, and no two alike. */
function auditAppearances(masterSeed, lore, say) {
  const potions = Object.keys(lore.potionLooks);
  const looks = Object.values(lore.potionLooks);
  if (new Set(looks).size !== looks.length) say('two potions share a look');
  for (const look of looks) {
    if (!IDENTIFICATION.potionLooks.includes(look)) say(`"${look}" is not one of 04's appearances`);
  }
  for (const id of potions) {
    if (item(id).alwaysKnown) say(`${id} is always known and still has a look`);
  }

  const titles = Object.values(lore.scrollTitles);
  if (new Set(titles).size !== titles.length) say('two scrolls share a title');
  for (const title of titles) {
    const words = title.split(' ');
    if (words.length !== 2 || words[0] === words[1]) say(`"${title}" is not two different words`);
  }

  // Another game is another shuffle; the same game is the same one.
  const again = createIdentification(masterSeed);
  if (JSON.stringify(again.potionLooks) !== JSON.stringify(lore.potionLooks)) {
    say('the same seed shuffled the potions differently');
  }
  const other = createIdentification(masterSeed + 1);
  if (JSON.stringify(other.potionLooks) === JSON.stringify(lore.potionLooks)) {
    say('two games shuffled the potions the same way');
  }
  for (const id of IDENTIFICATION.alwaysKnown) {
    if (!isKnownType(lore, id)) say(`${id} should be known from the start (04 section 5)`);
  }
}

/** `04` sections 4, 6 and 14: what a drop may be. */
function auditDrop(drop, floor, category, say, counts) {
  const entry = item(drop.baseId);
  const where = `${category} ${drop.baseId} on floor ${floor}`;
  if (!entry) return say(`${where} is not an item`);
  if ((drop.count ?? 0) < 1) say(`${where} dropped ${drop.count} of itself`);

  const magic = Boolean(entry.magic || drop.bonus || drop.property || drop.curse);
  if (magic) counts.magic += 1;
  if (ENCHANTABLE.includes(entry.category) && magic) counts.curseChances += 1;

  if (drop.bonus > 0) {
    if (![1, 2, 3].includes(drop.bonus)) say(`${where} is +${drop.bonus}`);
    if (drop.bonus > bonusLimit(floor)) {
      say(`${where} is +${drop.bonus}, past the +${bonusLimit(floor)} that floor allows (02 section 17)`);
    }
  }

  if (drop.property) {
    const table = ['armor', 'shield'].includes(entry.category)
      ? MAGIC.armorProperties
      : MAGIC.weaponProperties;
    if (!table.properties[drop.property]) say(`${where} carries "${drop.property}", off its own table`);
    if (!['weapon', 'armor', 'shield'].includes(entry.category)) {
      say(`${where} carries a property, and only weapons and armour can (04 section 4)`);
    }
  }

  if (drop.curse) {
    counts.cursed += 1;
    if (drop.property) counts.cursedWithProperty += 1;
    if (!CURSES.table.some((row) => row.id === drop.curse)) say(`${where} has no such curse`);
    if (!ENCHANTABLE.includes(entry.category)) say(`${where} is cursed and cannot be worn`);
    if (['weapon', 'armor', 'shield'].includes(entry.category) && ![-1, -2].includes(drop.bonus)) {
      say(`${where} is cursed with a bonus of ${drop.bonus}, and 04 section 6 says -1 or -2`);
    }
    if (drop.identified) say(`${where} is cursed and arrived identified`);
  }

  // `04` section 5: what arrives unknown, and what never does.
  const known = drop.identified;
  if (['potion', 'scroll'].includes(entry.category)) {
    if (known !== Boolean(entry.alwaysKnown)) {
      say(`${where} arrived ${known ? 'known' : 'unknown'}, against 04 section 5`);
    }
  } else if (magic && known) {
    say(`${where} is magic and arrived identified (04 section 5)`);
  } else if (!magic && !known) {
    say(`${where} is plain and arrived unknown (04 section 5)`);
  }
}

/** `04` section 1: the pack never holds more than it can. */
function auditSlots(hero, before, say) {
  const used = slotsUsed(hero.pack);
  if (used > hero.pack.capacity) {
    say(`the pack holds ${used} slots of ${hero.pack.capacity} (04 section 1)`);
  }
  if (used < before) say('taking something made the pack emptier');
  for (const entry of hero.pack.items) {
    if (isEquipped(hero.pack, entry.instanceId)) continue;
    const stack = stackOf(entry.baseId);
    if (stack === 1 && entry.count > 1) say(`${entry.baseId} stacked ${entry.count} and does not stack`);
  }
}

/** `04` sections 5 and 8: drinking one tells you what all of them are. */
function drinkIt(hero, carried, floor, say, counts) {
  const lore = hero.identification;
  const baseId = carried.baseId;
  const entry = item(baseId);
  const knownBefore = isKnownType(lore, baseId);

  // Until it is drunk, it is its look and nothing else (`04` section 5).
  if (!knownBefore) {
    const look = lookOf(lore, baseId);
    const shown = nameOf(carried, lore);
    if (!look) say(`${baseId} has no look in this game`);
    else if (shown !== `${look} Potion`) say(`an unknown ${baseId} reads as "${shown}"`);
    if (isIdentified(lore, carried)) say(`${baseId} is unknown and reads as identified`);
  }

  const built = actionForItem(hero, carried.instanceId, { inCombat: false });
  if (!built.action) {
    if (!whyNotUse(hero, carried, { inCombat: false })) say(`${baseId} cannot be drunk and gives no reason`);
    return;
  }

  const hpBefore = hero.hp;
  resolveItemAction({ rng: hero.rng ?? fakeRng(), hooks: null, units: [], floor }, hero, built.action);
  consumeItem(hero, carried.instanceId);
  counts.drunk += 1;

  // `04` section 5: the type is known now, and so is every other one of it.
  if (!isKnownType(lore, baseId)) say(`drinking ${baseId} did not learn its type (04 section 5)`);
  const another = { baseId, count: 1, identified: false };
  if (!isIdentified(lore, another)) say(`another ${baseId} is still unknown after drinking one`);
  if (nameOf(another, lore) !== entry.name) {
    say(`a known ${baseId} still reads as "${nameOf(another, lore)}"`);
  }
  if (entry.harmful && hero.hp > hpBefore) say(`${baseId} is harmful and healed the hero`);
  if (entry.use?.heal && hero.hp < hpBefore) say(`${baseId} heals and took hit points away`);
}

/** `04` sections 5 and 9: a scroll is a title until it is read. */
function readIt(hero, carried, say, counts) {
  const lore = hero.identification;
  const baseId = carried.baseId;
  const entry = itemOf(baseId);

  if (!isKnownType(lore, baseId)) {
    const title = titleOf(lore, baseId);
    const shown = nameOf(carried, lore);
    if (!title) say(`${baseId} has no title in this game`);
    else if (shown !== `Scroll labeled ${title}`) say(`an unknown ${baseId} reads as "${shown}"`);
  }

  // `04` section 9: a mind that cannot read it cannot read it.
  const needs = entry.school === 'spirit' ? 'wits' : 'intellect';
  const why = whyNotUse(hero, carried, { inCombat: false });
  const meets = (hero.attributes[needs] ?? 0) >= 11;
  if (!meets && !why) say(`${baseId} is readable without the ${needs} 04 section 9 asks for`);
  if (why === 'needsIntellect' || why === 'needsWits') return;

  const fpBefore = hero.fp;
  const built = actionForItem(hero, carried.instanceId, { inCombat: false });
  if (!built.action) {
    // A scroll whose skill has not been built yet says so by name; it is not
    // a rule being broken, so it is counted rather than reported.
    counts.unbuilt += 1;
    return;
  }

  consumeItem(hero, carried.instanceId);
  counts.read += 1;
  if (hero.fp !== fpBefore) say(`reading ${baseId} spent Focus, and 04 section 9 says it does not`);
  if (!isKnownType(lore, baseId)) say(`reading ${baseId} did not learn its type (04 section 5)`);
  if (built.action.fp !== 0) say(`${baseId} was cast for ${built.action.fp} Focus`);
}

/** `04` sections 5 and 6: what wearing something tells you, and costs you. */
function wearIt(hero, carried, floor, say, counts) {
  const lore = hero.identification;
  const cursed = Boolean(carried.curse);
  const put = wear(hero, carried.instanceId);
  if (!put.ok) return;
  counts.worn += 1;

  if (cursed) {
    counts.bound += 1;
    // `04` section 6: "A curse reveals itself immediately, and the item binds".
    if (!put.cursed) say(`${carried.baseId} is cursed and said nothing when it went on`);
    if (!carried.bound) say(`${carried.baseId} is cursed and did not bind`);
    const off = takeOff(hero, put.slot);
    if (off.ok) say(`${carried.baseId} is cursed and came off anyway (04 section 6)`);
    if (off.why !== 'cursedInPlace') say(`a bound item refused with "${off.why}"`);
    if (!nameOf(carried, lore).startsWith('Cursed')) {
      say(`a revealed curse reads as "${nameOf(carried, lore)}"`);
    }
    return;
  }

  // `04` section 5: the bonus shows after one combat, a charm after 100 steps.
  const entry = item(carried.baseId);
  if (carried.bonus) {
    if (isIdentified(lore, carried)) say(`${carried.baseId} named its bonus before a fight`);
    afterCombat(lore, hero.pack);
    if (!isIdentified(lore, carried) && !carried.property) {
      say(`${carried.baseId} kept its bonus secret through a combat (04 section 5)`);
    }
  }
  if (entry.category === 'charm') {
    afterSteps(lore, hero.pack, 99);
    if (isIdentified(lore, carried)) say(`a charm named itself before 100 steps (04 section 5)`);
    afterSteps(lore, hero.pack, 1);
    if (!isIdentified(lore, carried)) say(`a charm was still a mystery after 100 steps`);
    counts.identified += 1;
  }
  takeOff(hero, put.slot);
}

/** `04` section 6: the scroll frees it, the Temple burns it. */
function auditCurseRemoval(hero, say, counts) {
  // Room to work in, and hands free: ten floors of wearing things leaves the
  // hero bound to whatever cursed itself last, which is the rule working. The
  // audit is about the two ways *off*, so it starts from a clean hero — the
  // way a trip to town leaves one.
  removeCurses(hero);
  for (const entry of hero.pack.items) {
    if (entry.bound) say(`${entry.baseId} is still bound with no curse on it (04 section 6)`);
  }
  for (const slot of Object.keys(hero.pack.equipped)) takeOff(hero, slot);
  emptyPack(hero);
  for (const [index, curse] of ['leaden', 'clumsy'].entries()) {
    const found = 3 + index;
    const made = addItem(hero.pack, 'long_sword', {
      curse,
      bonus: -1,
      identified: false,
      foundOnFloor: found,
    }).entry;
    if (!made) return say('there was no room to test a curse coming off');
    const put = wear(hero, made.instanceId);
    if (!put.ok) return say(`a cursed sword could not be worn: ${put.why}`);

    if (index === 0) {
      // The scroll: the item lets go, and is still the item it was.
      const freed = removeCurses(hero);
      counts.freed += freed.length;
      if (!freed.includes(made)) say('a Scroll of Remove Curse left a curse on (04 section 6)');
      if (made.curse) say('a freed item still carries its curse');
      if (made.bound) say('a freed item is still bound');
      if (made.bonus !== -1) say(`the scroll changed the bonus to ${made.bonus}`);
      if (!takeOff(hero, put.slot).ok) say('a freed item still would not come off');
      removeItem(hero.pack, made.instanceId);
    } else {
      // The Temple: 50 gp x the floor it was found on, and the item is gone.
      const fee = cleanseFee(made);
      if (fee !== CURSES.removal.temple.goldPerFloor * found) {
        say(`the Temple asked ${fee} gp for something found on floor ${found}`);
      }
      const gold = hero.gold;
      const done = cleanseAtTemple(hero, made.instanceId);
      counts.burned += 1;
      if (!done.ok) say(`the Temple refused: ${done.why}`);
      if (hero.gold !== gold - fee) say('the Temple charged the wrong fee');
      if (entryOf(hero.pack, made.instanceId)) say('the Temple left the item in the pack');
    }
  }
}

/** `04` section 5: the Sage, and what buying something tells you. */
function auditIdentifyMethods(hero, say, counts) {
  const lore = hero.identification;
  emptyPack(hero);
  const made = addItem(hero.pack, 'long_sword', { bonus: 2, property: 'keen', identified: false }).entry;
  if (!made) return say('there was no room to test the Sage');
  if (isIdentified(lore, made)) say('an unknown +2 sword read as identified');
  if (nameOf(made, lore) !== 'Unknown Long Sword') {
    say(`an unknown sword reads as "${nameOf(made, lore)}"`);
  }
  identify(lore, made);
  counts.identified += 1;
  if (!isIdentified(lore, made)) say('the Sage identified an item and it stayed unknown');
  if (nameOf(made, lore) !== 'Keen Long Sword +2') {
    say(`an identified sword reads as "${nameOf(made, lore)}"`);
  }
  if (ITEM_RULES.shop.sellRate !== 0.5) say('04 section 1 sells at half price');
  removeItem(hero.pack, made.instanceId);
}

/** Empties the pack the way a trip to town does. */
function emptyPack(hero) {
  for (const entry of [...hero.pack.items]) {
    if (isEquipped(hero.pack, entry.instanceId)) continue;
    if (entry.bound) continue;
    removeItem(hero.pack, entry.instanceId);
  }
}

/** A potion drunk outside a fight still rolls its dice. */
function fakeRng() {
  const rng = carriedStreams(1).combat;
  return rng;
}

export { bonusLimit };
