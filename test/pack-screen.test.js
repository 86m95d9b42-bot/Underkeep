/**
 * @vitest-environment happy-dom
 *
 * Hero: Pack and Item Detail (`00-build-outline.md`, "Hero and Items";
 * `04` section 16).
 *
 * The screens draw what the pack and the identification rules answer: rarity
 * colours, a **?** on what is unknown, the slot counter, and the three things
 * that can be done with an item. Nothing here decides a rule.
 */
import { describe, it, expect, vi } from 'vitest';
import { pack as packScreen, REGIONS as PACK_REGIONS, filterOf, rarityColor, rowsFor } from '../src/ui/screens/pack.js';
import { itemDetail, REGIONS as DETAIL_REGIONS, notesFor, statOf, statsFor } from '../src/ui/screens/item-detail.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem, equipNew, slotsUsed } from '../src/systems/inventory.js';
import { t } from '../src/data/strings.js';

function makeHero() {
  return finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 13, luck: 8 },
        },
        'sellsword',
      ),
      'Harrow',
    ),
  );
}

function mount(screen, { frame = 'tall', run, params = {}, leaveDungeon } = {}) {
  const router = {
    has: () => true,
    go: vi.fn(),
    back: vi.fn(),
    openSheet: vi.fn(),
    closeSheet: vi.fn(),
    replace: vi.fn(),
  };
  const built = screen.build({ router, params, frame, run, leaveDungeon, settings: { all: {} } });
  return { built, router, placed: placeRegions(screen, frame) };
}

/** Every button in a built screen, by its visible label. */
function buttons(built) {
  const found = new Map();
  for (const node of Object.values(built)) {
    const nodes = [
      ...(node.tagName === 'BUTTON' ? [node] : []),
      ...(node.querySelectorAll?.('button') ?? []),
    ];
    for (const btn of nodes) {
      const label = (btn.querySelector('.label')?.textContent ?? btn.textContent).trim();
      if (label && !found.has(label)) found.set(label, btn);
    }
  }
  return found;
}

describe('where the Pack puts things', () => {
  it("follows the outline's Hero: Pack table", () => {
    // Header 1-4, equipped 5-6, filters 7-8, list 9-16, keys 17-18.
    expect(PACK_REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(PACK_REGIONS.tabs.tall).toEqual([1, 9, 3, 4]);
    expect(PACK_REGIONS.equipped.tall).toEqual([1, 9, 5, 6]);
    expect(PACK_REGIONS.filters.tall).toEqual([1, 9, 7, 8]);
    expect(PACK_REGIONS.list.tall).toEqual([1, 9, 9, 16]);
    expect(PACK_REGIONS.sort.tall).toEqual([1, 4, 17, 18]);
    expect(PACK_REGIONS.quick.tall).toEqual([5, 9, 17, 18]);
  });

  it('keeps the list in cols 1-12 when wide, with the detail beside it', () => {
    // 00: "Equipped strip and item list cols 1-12; item detail cols 13-18."
    expect(packScreen.pattern).toBe('list-detail');
    expect(PACK_REGIONS.list.wide[1]).toBeLessThanOrEqual(12);
    expect(PACK_REGIONS.equipped.wide[1]).toBeLessThanOrEqual(12);
    expect(DETAIL_REGIONS.sheet.wide[0]).toBe(13);
    expect(DETAIL_REGIONS.sheet.wide[1]).toBe(18);
  });

  it('places cleanly in both frames and draws the same things', () => {
    const run = { hero: makeHero() };
    expect(validateScreen(packScreen, 'tall')).toEqual([]);
    expect(validateScreen(packScreen, 'wide')).toEqual([]);
    // Everything but the wide frame's detail panel, which is what tall shows
    // as the Item Detail sheet instead (`00`, Hero: Pack).
    const text = (frame) =>
      Object.entries(mount(packScreen, { frame, run }).built)
        .filter(([name]) => name !== 'detail')
        .map(([, node]) => node.textContent)
        .join(' ');
    expect(text('wide')).toBe(text('tall'));
  });

  it('shows the chosen item beside the list when wide, not in a sheet', () => {
    const run = { hero: makeHero() };
    const { built, router } = mount(packScreen, { frame: 'wide', run });
    expect(built.detail.textContent).toMatch(/Pick an item/);
    [...built.list.querySelectorAll('.listrow')][0].click();
    expect(router.openSheet).not.toHaveBeenCalled();
    const [, chosenParams] = router.replace.mock.calls[0];
    expect(chosenParams.selected).toEqual(expect.any(String));

    const chosen = mount(packScreen, { frame: 'wide', run, params: { selected: chosenParams.selected } });
    expect(chosen.built.detail.textContent).toMatch(/DROP/);
    // Tall still opens the sheet.
    const tall = mount(packScreen, { frame: 'tall', run });
    expect(tall.built.detail).toBeUndefined();
    [...tall.built.list.querySelectorAll('.listrow')][0].click();
    expect(tall.router.openSheet).toHaveBeenCalledWith('itemDetail', expect.objectContaining({ item: chosenParams.selected }));
  });

  it('lets only the item list scroll', () => {
    const { built } = mount(packScreen, { run: { hero: makeHero() } });
    const scrolls = Object.values(built).filter((node) => node.querySelector?.('.scroll'));
    expect(scrolls).toEqual([built.list]);
  });
});

describe('what the Pack shows', () => {
  const run = () => ({ hero: makeHero() });

  it('shows the four equipped slots, and what is in them', () => {
    const where = run();
    const { built } = mount(packScreen, { run: where });
    for (const slot of ['weapon', 'offHand', 'armor', 'charm']) {
      expect(built.equipped.textContent).toContain(t(`pack.slots.${slot}`));
    }
    // The Sellsword walks in with a long sword and leather.
    expect(built.equipped.textContent).toContain('Long Sword');
    expect(built.equipped.textContent).toContain('Leather Armor');
    // And nothing in the off-hand.
    expect(built.equipped.textContent).toContain(t('pack.none'));
  });

  it('counts the slots the way 04 section 16 asks', () => {
    const where = run();
    const { built } = mount(packScreen, { run: where });
    const used = slotsUsed(where.hero.pack);
    expect(built.list.textContent).toContain(
      t('pack.slotsUsed', { used, total: where.hero.pack.capacity }),
    );
  });

  it('filters the list four ways', () => {
    expect(filterOf('long_sword')).toBe('gear');
    expect(filterOf('ring_of_protection')).toBe('gear');
    expect(filterOf('healing_potion')).toBe('use');
    expect(filterOf('torch')).toBe('use');
    expect(filterOf('ruby')).toBe('loot');
    expect(filterOf('rat_tail')).toBe('loot');

    const where = run();
    addItem(where.hero.pack, 'ruby');
    addItem(where.hero.pack, 'healing_potion');
    expect(rowsFor(where.hero, 'loot').map((row) => row.entry.baseId)).toEqual(['ruby']);
    expect(rowsFor(where.hero, 'use').map((row) => row.entry.baseId)).toContain('healing_potion');
    expect(rowsFor(where.hero, 'all').length).toBeGreaterThan(2);
  });

  it('marks an unknown item with a badge and no rarity colour', () => {
    const where = run();
    addItem(where.hero.pack, 'focus_tonic', { identified: false, rarity: 'uncommon' });
    const row = rowsFor(where.hero, 'use').find((entry) => entry.entry.baseId === 'focus_tonic');
    expect(row.card.badge).toBe('?');
    expect(row.card.rarity).toBe('unknown');
    expect(rarityColor(row.card.rarity)).toBe('var(--rarity-unknown)');
    const { built } = mount(packScreen, { run: where });
    expect(built.list.textContent).not.toContain('Focus Tonic');
  });

  it('opens the Item Detail sheet when a row is tapped', () => {
    const where = run();
    const entry = addItem(where.hero.pack, 'healing_potion').entry;
    const { built, router } = mount(packScreen, { run: where });
    const row = [...built.list.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Healing Potion'),
    );
    row.click();
    expect(router.openSheet).toHaveBeenCalledWith('itemDetail', {
      item: entry.instanceId,
      from: 'pack',
      filter: 'all',
    });
  });

  it('pins a consumable to the quick bar', () => {
    const where = run();
    const entry = addItem(where.hero.pack, 'healing_potion').entry;
    const { built } = mount(packScreen, { run: where });
    buttons(built).get(t('pack.quickSlots')).click();
    const row = [...built.list.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Healing Potion'),
    );
    row.click();
    expect(where.hero.pack.quick[0]).toBe(entry.instanceId);
  });

  it('sorts what is carried, and says so when there is nothing to sort', () => {
    const where = run();
    addItem(where.hero.pack, 'ruby');
    addItem(where.hero.pack, 'healing_potion');
    const { built } = mount(packScreen, { run: where });
    buttons(built).get(t('pack.sort')).click();
    const order = where.hero.pack.items.map((entry) => entry.baseId);
    expect(order.indexOf('leather_armor')).toBeLessThan(order.indexOf('ruby'));
  });
});

describe('the Item Detail sheet', () => {
  const run = () => ({ hero: makeHero(), rng: { combat: { roll: () => 7 } }, floor: { floor: 1 } });

  it('names the item, its type and its compare table', () => {
    const where = run();
    const entry = addItem(where.hero.pack, 'chain_mail').entry;
    const { built } = mount(itemDetail, { run: where, params: { item: entry.instanceId } });
    const text = built.sheet.textContent;
    expect(text).toContain('Chain Mail');
    expect(text).toContain(t('pack.type.armor'));
    // Armour compares DEF, the AGI cap, Stealth and slots against what is on.
    expect(statsFor('chain_mail')).toEqual(['def', 'maxAgi', 'stealth', 'slots']);
    expect(text).toContain(t('pack.detail.stats.def'));
    expect(statOf(entry, 'def')).toBe('4');
    // The leather that is worn shows in the other column.
    expect(text).toContain('2');
  });

  it('shows ? for an unknown item instead of its numbers', () => {
    const where = run();
    const entry = addItem(where.hero.pack, 'long_sword', {
      identified: false,
      bonus: 2,
      rarity: 'rare',
    }).entry;
    const { built } = mount(itemDetail, { run: where, params: { item: entry.instanceId } });
    expect(built.sheet.textContent).toContain(t('pack.detail.unknownValue'));
    expect(built.sheet.textContent).toContain('Unknown Long Sword');
    expect(notesFor(where.hero, entry)).toContain(t('pack.detail.note.unknown'));
    expect(notesFor(where.hero, entry)).toContain(t('pack.detail.note.curseRisk'));
  });

  it('warns about a curse once it has shown itself', () => {
    const where = run();
    const entry = addItem(where.hero.pack, 'long_sword', {
      curse: 'leaden',
      bonus: -1,
      identified: true,
      revealed: ['curse', 'bonus'],
      bound: true,
    }).entry;
    const notes = notesFor(where.hero, entry);
    expect(notes.some((line) => line.includes('Leaden'))).toBe(true);
    expect(notes).toContain(t('pack.detail.note.bound'));
  });

  it('equips what can be equipped, and refuses what cannot', () => {
    const where = run();
    const entry = addItem(where.hero.pack, 'chain_mail').entry;
    const { built } = mount(itemDetail, { run: where, params: { item: entry.instanceId } });
    buttons(built).get(t('pack.detail.equip')).click();
    expect(where.hero.pack.equipped.armor).toBe(entry.instanceId);

    // A shield cannot go on while both hands are on a two-handed weapon.
    const other = run();
    equipNew(other.hero.pack, 'great_sword');
    const shield = addItem(other.hero.pack, 'shield').entry;
    const second = mount(itemDetail, { run: other, params: { item: shield.instanceId } });
    const equip = buttons(second.built).get(t('pack.detail.equip'));
    expect(equip.disabled).toBe(true);
    expect(second.built.sheet.textContent).toContain(t('pack.why.bothHands'));
  });

  it('drinks a potion from the pack and takes it off the stack', () => {
    const where = run();
    where.hero.hp = where.hero.maxHp - 10;
    const entry = addItem(where.hero.pack, 'healing_potion', { count: 2 }).entry;
    const { built } = mount(itemDetail, { run: where, params: { item: entry.instanceId } });
    buttons(built).get(t('pack.detail.use')).click();
    expect(where.hero.hp).toBeGreaterThan(where.hero.maxHp - 10);
    expect(entry.count).toBe(1);
  });

  it('reads a Scroll of Return by leaving the dungeon (05 section 9)', () => {
    const where = run();
    const scroll = addItem(where.hero.pack, 'scroll_of_return').entry;
    const leaveDungeon = vi.fn();
    const { built } = mount(itemDetail, {
      run: where,
      params: { item: scroll.instanceId },
      leaveDungeon,
    });
    buttons(built).get(t('pack.detail.use')).click();
    expect(leaveDungeon).toHaveBeenCalledWith({ leaveMark: true });
    // And the scroll is spent by reading it.
    expect(where.hero.pack.items.some((entry) => entry.baseId === 'scroll_of_return')).toBe(false);
  });

  it('will not drop what is bound to the hero', () => {
    const where = run();
    const entry = addItem(where.hero.pack, 'long_sword', { curse: 'clumsy', bound: true }).entry;
    const { built } = mount(itemDetail, { run: where, params: { item: entry.instanceId } });
    expect(buttons(built).get(t('pack.detail.drop')).disabled).toBe(true);
  });

  it('says so when the item is not there at all', () => {
    const { built } = mount(itemDetail, { run: run(), params: { item: 'itm_9999' } });
    expect(built.sheet.textContent).toContain(t('pack.why.notCarried'));
  });
});
