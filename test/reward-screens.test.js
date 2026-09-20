/**
 * @vitest-environment happy-dom
 *
 * Victory and Loot, and Level Up (`00-build-outline.md`, "Combat and
 * Rewards").
 *
 * Neither screen decides anything: `06` section 15 pays the XP, the gold and
 * the levels as combat ends, and these report them. The one exception is the
 * attribute point at levels 4, 8, 12, 16 and 20, which is picked here.
 */
import { describe, it, expect, vi } from 'vitest';
import { loot, REGIONS as LOOT_REGIONS, rewardOf } from '../src/ui/screens/loot.js';
import {
  levelUp as levelUpScreen,
  REGIONS as LEVEL_REGIONS,
  levelsFrom,
  nextPointLevel,
  pointLevels,
} from '../src/ui/screens/levelup.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { LEVELING, abbr, modFor } from '../src/data/attributes.js';
import { t } from '../src/data/strings.js';

/** A hero to show the rewards to. */
function makeHero() {
  return finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 },
        },
        'sellsword',
      ),
      'Harrow',
    ),
  );
}

/** What a fight hands over, without running one. */
function fightPaying({ xp = 15, gold = 4, levels = [], loot: drops = [] } = {}) {
  return { summary: { outcome: 'victory', xp, gold, loot: drops, levels } };
}

/** One level's gains, as `levelUp` returns them. */
function gain({ level = 4, hp = 3, fp = 1, maxHp = 25, maxFp = 9, attributePoint = true } = {}) {
  return { level, hp, fp, maxHp, maxFp, skillPoints: 1, attributePoint };
}

function mount(screen, { frame = 'tall', run, fight, params = {} } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = screen.build({ router, params, frame, run, fight, settings: { all: {} } });
  const placed = placeRegions(screen, frame);
  return { built, placed, router };
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

describe('where the two screens put things', () => {
  it("follows the outline's Victory and Loot table", () => {
    // VICTORY 1-3, XP 4-5, gold 6-7, drops 8-15, warning 16, keys 17-18.
    expect(LOOT_REGIONS.title.tall).toEqual([1, 9, 1, 3]);
    expect(LOOT_REGIONS.xp.tall).toEqual([1, 9, 4, 5]);
    expect(LOOT_REGIONS.gold.tall).toEqual([1, 9, 6, 7]);
    expect(LOOT_REGIONS.drops.tall).toEqual([1, 9, 8, 15]);
    expect(LOOT_REGIONS.warning.tall).toEqual([1, 9, 16, 16]);
    expect(LOOT_REGIONS.takeAll.tall).toEqual([1, 4, 17, 18]);
    expect(LOOT_REGIONS.next.tall).toEqual([5, 9, 17, 18]);
  });

  it("follows the outline's Level Up table", () => {
    // LEVEL N 1-4, gain tiles 5-8, picker 9-15, reminder 16, keys 17-18.
    expect(LEVEL_REGIONS.title.tall).toEqual([1, 9, 1, 4]);
    expect(LEVEL_REGIONS.gains.tall).toEqual([1, 9, 5, 8]);
    expect(LEVEL_REGIONS.picker.tall).toEqual([1, 9, 9, 15]);
    expect(LEVEL_REGIONS.note.tall).toEqual([1, 9, 16, 16]);
    expect(LEVEL_REGIONS.tree.tall).toEqual([1, 4, 17, 18]);
    expect(LEVEL_REGIONS.confirm.tall).toEqual([5, 9, 17, 18]);
  });

  it('puts the drops on the left and the rest on the right when wide', () => {
    // 00: "Drop list left; XP, gold, warnings, TAKE ALL and CONTINUE right."
    expect(loot.pattern).toBe('list-detail');
    expect(LOOT_REGIONS.drops.wide[1]).toBeLessThanOrEqual(9);
    for (const name of ['xp', 'gold', 'warning']) {
      expect([name, LOOT_REGIONS[name].wide[0]]).toEqual([name, 10]);
    }
    expect(LOOT_REGIONS.next.wide[1]).toBe(18);
  });

  it('folds the level and its tiles away from the picker when wide', () => {
    // 00: "LEVEL N and the four gain tiles left; attribute picker and buttons right."
    expect(levelUpScreen.pattern).toBe('fold');
    expect(LEVEL_REGIONS.gains.wide[1]).toBeLessThanOrEqual(9);
    expect(LEVEL_REGIONS.picker.wide[0]).toBe(10);
    expect(LEVEL_REGIONS.confirm.wide[0]).toBeGreaterThanOrEqual(10);
  });

  it('places cleanly in both frames, and draws the same things', () => {
    const run = { hero: makeHero() };
    const fight = fightPaying({ levels: [gain()] });
    const params = { levels: [gain()] };
    for (const screen of [loot, levelUpScreen]) {
      expect([screen.id, validateScreen(screen, 'tall')]).toEqual([screen.id, []]);
      expect([screen.id, validateScreen(screen, 'wide')]).toEqual([screen.id, []]);
      const text = (frame) =>
        Object.values(mount(screen, { frame, run, fight, params }).built)
          .map((node) => node.textContent)
          .join(' ');
      for (const frame of ['tall', 'wide']) {
        const { placed } = mount(screen, { frame, run, fight, params });
        expect([screen.id, frame, placed.size]).toEqual([
          screen.id,
          frame,
          Object.keys(screen.regions).length,
        ]);
      }
      expect([screen.id, text('wide')]).toEqual([screen.id, text('tall')]);
    }
  });
});

describe('Victory and Loot', () => {
  const run = () => ({ hero: makeHero() });

  it('reads what the fight banked, and nothing else', () => {
    expect(rewardOf(fightPaying({ xp: 30, gold: 7 }))).toEqual({
      xp: 30,
      gold: 7,
      loot: [],
      levels: [],
    });
    // Opened without a fight behind it, it claims nothing.
    expect(rewardOf(null)).toEqual({ xp: 0, gold: 0, loot: [], levels: [] });
  });

  it('shows the XP and the gold the fight paid', () => {
    const { built } = mount(loot, { run: run(), fight: fightPaying({ xp: 30, gold: 7 }) });
    expect(built.title.textContent).toBe(t('loot.title'));
    expect(built.xp.textContent).toContain(t('loot.xp', { n: 30 }));
    expect(built.gold.textContent).toContain(t('loot.goldGain', { n: 7 }));
  });

  it('carries the LEVEL UP chip only when a level was earned', () => {
    const without = mount(loot, { run: run(), fight: fightPaying() });
    expect(without.built.xp.textContent).not.toContain(t('loot.levelUp'));
    const with_ = mount(loot, { run: run(), fight: fightPaying({ levels: [gain()] }) });
    expect(with_.built.xp.textContent).toContain(t('loot.levelUp'));
  });

  it('says there is nothing to carry while items are still to come', () => {
    const { built } = mount(loot, { run: run(), fight: fightPaying() });
    expect(built.drops.textContent).toContain(t('loot.noDrops'));
    expect(buttons(built).get(t('loot.takeAll')).disabled).toBe(true);
    expect(built.takeAll.textContent).toContain(t('loot.nothingToTake'));
  });

  it('lists a drop with its own TAKE when there is one', () => {
    const drops = [{ name: 'Spear', note: 'Polearm' }];
    const { built } = mount(loot, { run: run(), fight: fightPaying({ loot: drops }) });
    expect(built.drops.textContent).toContain('Spear');
    expect(built.drops.textContent).toContain(t('loot.take'));
    expect(buttons(built).get(t('loot.takeAll')).disabled).toBe(false);
  });

  it('lets only the drop list scroll', () => {
    const { built } = mount(loot, { run: run(), fight: fightPaying() });
    const scrolls = Object.values(built).filter((node) => node.querySelector?.('.scroll'));
    expect(scrolls).toEqual([built.drops]);
  });

  it('goes to Level Up with the levels the fight earned', () => {
    const levels = [gain()];
    const { built, router } = mount(loot, { run: run(), fight: fightPaying({ levels }) });
    buttons(built).get(t('loot.continue')).click();
    expect(router.go).toHaveBeenCalledWith('levelUp', { levels });
  });

  it('goes back to the dungeon when no level was earned', () => {
    const { built, router } = mount(loot, { run: run(), fight: fightPaying() });
    buttons(built).get(t('loot.continue')).click();
    expect(router.go).toHaveBeenCalledWith('explore');
  });
});

describe('Level Up', () => {
  it('shows the level, and what each part of it came to', () => {
    const run = { hero: makeHero() };
    const { built } = mount(levelUpScreen, { run, params: { levels: [gain()] } });
    expect(built.title.textContent).toContain(t('level.title', { n: 4 }));
    const tiles = [...built.gains.querySelectorAll('.gaintile')];
    expect(tiles).toHaveLength(4);
    expect(tiles[0].textContent).toContain(t('level.gain', { n: 3 }));
    expect(tiles[0].textContent).toContain(t('level.from', { before: 22, after: 25 }));
    expect(tiles[1].textContent).toContain(t('level.from', { before: 8, after: 9 }));
    expect(tiles[2].textContent).toContain(t('level.spendOnTree'));
  });

  it('offers the picker only on a level that pays an attribute point', () => {
    const run = { hero: makeHero() };
    run.hero.attributePoints = 1;
    const paying = mount(levelUpScreen, { run, params: { levels: [gain()] } });
    expect(paying.built.picker.querySelectorAll('.picktile')).toHaveLength(6);

    const plain = mount(levelUpScreen, {
      run: { hero: makeHero() },
      params: { levels: [gain({ level: 5, attributePoint: false })] },
    });
    expect(plain.built.picker.querySelectorAll('.picktile')).toHaveLength(0);
    expect(plain.built.picker.textContent).toContain(t('level.nextPoint', { n: 8 }));
  });

  it('names the levels that pay one, as the outline does', () => {
    expect(pointLevels()).toBe(LEVELING.attributePointLevels.join(', '));
    expect(nextPointLevel(5)).toBe(8);
    expect(nextPointLevel(20)).toBe(null);
  });

  it('will not confirm until the point is picked', () => {
    const run = { hero: makeHero() };
    run.hero.attributePoints = 1;
    const { built } = mount(levelUpScreen, { run, params: { levels: [gain()] } });
    expect(buttons(built).get(t('level.confirm')).disabled).toBe(true);
    expect(built.confirm.textContent).toContain(t('level.needPick'));
  });

  it('shows what the point would buy before it is spent, and spends it on CONFIRM', () => {
    const run = { hero: makeHero() };
    run.hero.attributePoints = 1;
    const might = run.hero.attributes.might;
    const { built, router } = mount(levelUpScreen, { run, params: { levels: [gain()] } });

    buttons(built).get(`${abbr('might')} ${might}`).click();
    const mod = `+${modFor(might + 1)}`;
    expect(built.picker.textContent).toContain(t('level.raised', { score: might + 1, mod }));
    // Picking changes nothing yet: the hero still has the point.
    expect(run.hero.attributes.might).toBe(might);

    buttons(built).get(t('level.confirm')).click();
    expect(run.hero.attributes.might).toBe(might + 1);
    expect(run.hero.attributePoints).toBe(0);
    expect(router.go).toHaveBeenCalledWith('explore');
  });

  it('walks one card per level when a fight earned more than one', () => {
    const run = { hero: makeHero() };
    const levels = [gain({ level: 2, attributePoint: false }), gain({ level: 3, attributePoint: false })];
    const { built, router } = mount(levelUpScreen, { run, params: { levels } });
    expect(built.title.textContent).toContain(t('level.title', { n: 2 }));
    expect(built.title.textContent).toContain(t('level.more', { n: 1 }));

    buttons(built).get(t('level.confirm')).click();
    expect(built.title.textContent).toContain(t('level.title', { n: 3 }));
    expect(router.go).not.toHaveBeenCalled();

    buttons(built).get(t('level.confirm')).click();
    expect(router.go).toHaveBeenCalledWith('explore');
  });

  it('opens the Skill Tree, where the skill point is spent', () => {
    const run = { hero: makeHero() };
    const { built, router } = mount(levelUpScreen, { run, params: { levels: [gain()] } });
    expect(built.note.textContent).toBe(t('level.note'));
    buttons(built).get(t('level.tree')).click();
    expect(router.go).toHaveBeenCalledWith('skillTree');
  });

  it('falls back to the hero on the screen when it is opened without a fight', () => {
    const who = makeHero();
    who.attributePoints = 1;
    const cards = levelsFrom({}, who);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ level: who.level, hp: 0, attributePoint: true });
  });
});
