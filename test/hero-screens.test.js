/**
 * @vitest-environment happy-dom
 *
 * Hero: Stats and Hero: Skill Tree (`00-build-outline.md`, "Hero and Items").
 *
 * The rules behind these screens are tested in `creation.test.js`,
 * `levelling.test.js` and `skill-tree.test.js`; this is about the screens:
 * that they place what the outline's tables say in both frames, that every
 * number shown is the one the hero carries, and that a skill can be learned
 * from the tree.
 */
import { describe, it, expect, vi } from 'vitest';
import { hero as heroScreen, REGIONS as HERO_REGIONS, pathSummary, signed } from '../src/ui/screens/hero.js';
import {
  skillTree,
  REGIONS as TREE_REGIONS,
  HERO_POINTS,
  PATH_TABS,
  crossroadsNote,
  shortPathName,
  tierNote,
} from '../src/ui/screens/skill-tree.js';
import { HERO_TABS } from '../src/ui/parts/hero-header.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { rankOf, spentIn, unspent } from '../src/systems/skill-tree.js';
import { awardXp, progress } from '../src/systems/levelling.js';
import { ATTRIBUTE_ORDER, LEVELING, abbr } from '../src/data/attributes.js';
import { CROSSROADS, PATHS, TIERS, gateFor, skillsOfPath, skillsOfTier } from '../src/data/skills.js';
import { t } from '../src/data/strings.js';

/** A hero good enough to read every line of both screens. */
function makeHero({ scores, origin = 'sellsword', points } = {}) {
  const made = finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: scores ?? { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 },
        },
        origin,
      ),
      'Harrow',
    ),
  );
  if (points !== undefined) made.skillPoints = points;
  return made;
}

/** Builds a screen into a detached tree, the way the router would. */
function mount(screen, { frame = 'tall', run } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = screen.build({ router, params: {}, frame, run, settings: { all: {} } });
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
  it('shares rows 1-4 between them', () => {
    // 00: "The three Hero screens share rows 1-4: a top bar and tabs."
    for (const regions of [HERO_REGIONS, TREE_REGIONS]) {
      expect(regions.topBar.tall).toEqual([1, 9, 1, 2]);
      expect(regions.tabs.tall).toEqual([1, 9, 3, 4]);
    }
  });

  it("follows the outline's Hero: Stats table", () => {
    // Tiles 5-10, derived list 11-16 (scrolls), XP bar 17-18.
    expect(HERO_REGIONS.attributes.tall).toEqual([1, 9, 5, 10]);
    expect(HERO_REGIONS.derived.tall).toEqual([1, 9, 11, 16]);
    expect(HERO_REGIONS.xp.tall).toEqual([1, 9, 17, 18]);
  });

  it("follows the outline's Hero: Skill Tree table", () => {
    // Path chips 5-6, tiers 7-14, selected skill 15-16, LEARN 17-18.
    expect(TREE_REGIONS.paths.tall).toEqual([1, 9, 5, 6]);
    expect(TREE_REGIONS.tiers.tall).toEqual([1, 9, 7, 14]);
    expect(TREE_REGIONS.selected.tall).toEqual([1, 9, 15, 16]);
    expect(TREE_REGIONS.learn.tall).toEqual([1, 9, 17, 18]);
  });

  it('folds the Stats screen left and right when wide', () => {
    // 00: "Attribute tiles left; derived list and XP bar right."
    expect(heroScreen.pattern).toBe('fold');
    expect(HERO_REGIONS.attributes.wide[1]).toBeLessThanOrEqual(9);
    expect(HERO_REGIONS.derived.wide[0]).toBe(10);
    expect(HERO_REGIONS.xp.wide[0]).toBe(10);
  });

  it('gives the wide Skill Tree cols 1-12 and 13-18', () => {
    // 00: "Tiers cols 1-12; selected skill and LEARN cols 13-18."
    expect(skillTree.pattern).toBe('list-detail');
    expect(TREE_REGIONS.tiers.wide.slice(0, 2)).toEqual([1, 12]);
    expect(TREE_REGIONS.selected.wide.slice(0, 2)).toEqual([13, 18]);
    expect(TREE_REGIONS.learn.wide.slice(0, 2)).toEqual([13, 18]);
  });

  it('places cleanly in both frames', () => {
    const run = { hero: makeHero() };
    for (const screen of [heroScreen, skillTree]) {
      expect([screen.id, validateScreen(screen, 'tall')]).toEqual([screen.id, []]);
      expect([screen.id, validateScreen(screen, 'wide')]).toEqual([screen.id, []]);
      for (const frame of ['tall', 'wide']) {
        const { placed } = mount(screen, { frame, run });
        expect([screen.id, frame, placed.size]).toEqual([
          screen.id,
          frame,
          Object.keys(screen.regions).length,
        ]);
      }
    }
  });

  it('renders the same things in both frames', () => {
    const run = { hero: makeHero() };
    for (const screen of [heroScreen, skillTree]) {
      const text = (frame) =>
        Object.values(mount(screen, { frame, run }).built)
          .map((node) => node.textContent)
          .join(' ');
      expect([screen.id, text('wide')]).toEqual([screen.id, text('tall')]);
    }
  });
});

describe('the shared header', () => {
  it('names the hero, their level and their origin', () => {
    const who = makeHero({ origin: 'apprentice' });
    const { built } = mount(heroScreen, { run: { hero: who } });
    expect(built.topBar.textContent).toContain('HARROW');
    expect(built.topBar.textContent).toContain(
      t('hero.sub', { level: 1, origin: t('origins.apprentice.name') }),
    );
  });

  it('carries the points left to spend as a chip', () => {
    const who = makeHero();
    const { built } = mount(heroScreen, { run: { hero: who } });
    expect(built.topBar.textContent).toContain(t('hero.points', { n: unspent(who) }));
  });

  it('offers all three tabs, with this screen selected', () => {
    const who = makeHero();
    const pressed = (screen, label) =>
      buttons(mount(screen, { run: { hero: who } }).built).get(label)?.getAttribute('aria-pressed');
    for (const tab of HERO_TABS) expect(buttons(mount(heroScreen, { run: { hero: who } }).built).has(t(`hero.tabs.${tab.id}`))).toBe(true);
    expect(pressed(heroScreen, t('hero.tabs.stats'))).toBe('true');
    expect(pressed(skillTree, t('hero.tabs.skills'))).toBe('true');
  });

  it('opens another tab when it is tapped', () => {
    const { built, router } = mount(heroScreen, { run: { hero: makeHero() } });
    buttons(built).get(t('hero.tabs.skills')).click();
    expect(router.go).toHaveBeenCalledWith('skillTree');
  });
});

describe('Hero: Stats', () => {
  it('shows all six attributes, with a score and a modifier', () => {
    const who = makeHero();
    const { built } = mount(heroScreen, { run: { hero: who } });
    const tiles = [...built.attributes.querySelectorAll('.stattile')];
    expect(tiles).toHaveLength(ATTRIBUTE_ORDER.length);
    for (const [i, id] of ATTRIBUTE_ORDER.entries()) {
      expect(tiles[i].querySelector('.stattile__abbr').textContent).toBe(abbr(id));
      expect(tiles[i].querySelector('.stattile__score').textContent).toBe(String(who.attributes[id]));
      expect(tiles[i].querySelector('.stattile__mod').textContent).toMatch(/^[+−]\d+$/);
    }
  });

  it('lists every derived statistic the table names', () => {
    const { built } = mount(heroScreen, { run: { hero: makeHero() } });
    const lines = [
      'melee', 'ranged', 'spell', 'def', 'init',
      'body', 'reflex', 'mind', 'slots', 'crit', 'origin', 'paths',
    ];
    for (const key of lines) {
      expect([key, built.derived.textContent.includes(t(`hero.derived.${key}`))]).toEqual([key, true]);
    }
  });

  it('reads the numbers off the hero rather than working them out', () => {
    const who = makeHero();
    const { built } = mount(heroScreen, { run: { hero: who } });
    const value = (label) =>
      [...built.derived.querySelectorAll('.statline')]
        .find((line) => line.querySelector('.statline__label').textContent === label)
        ?.querySelector('.statline__value').textContent;
    expect(value(t('hero.derived.melee'))).toBe(signed(who.attacks.melee));
    expect(value(t('hero.derived.def'))).toBe(String(who.def));
    expect(value(t('hero.derived.body'))).toBe(signed(who.saves.body));
    expect(value(t('hero.derived.slots'))).toBe(String(who.slots));
    expect(value(t('hero.derived.origin'))).toBe(t(`origins.${who.origin}.name`));
  });

  it('is the only scrolling part of the screen', () => {
    const { built } = mount(heroScreen, { run: { hero: makeHero() } });
    const scrolls = Object.values(built).filter((node) => node.classList?.contains('scroll'));
    expect(scrolls).toEqual([built.derived]);
  });

  it('shows how far the next level is', () => {
    const who = makeHero();
    awardXp(who, 30);
    const climb = progress(who);
    const { built } = mount(heroScreen, { run: { hero: who } });
    expect(built.xp.textContent).toContain(t('hero.nextLevel'));
    expect(built.xp.textContent).toContain(t('hero.xp', { into: climb.into, needed: climb.needed }));
  });

  describe('the Path summary', () => {
    it('says nothing has been spent on a new hero', () => {
      // The origin's free skill cost nothing, so no Path has points in it.
      expect(pathSummary(makeHero())).toBe(t('hero.noPaths'));
    });

    it('names each Path the hero has spent in', () => {
      const who = makeHero({ points: 2 });
      const { built } = mount(skillTree, { run: { hero: who } });
      buttons(built).get(`${shortPathName('blade')} 0`).click();
      const first = 'power_strike';
      built.tiers.querySelector(`[aria-label^="${t(`skills.${first}.name`)}"]`).click();
      buttons(built).get(t('skillTree.learnOne', { skill: t(`skills.${first}.name`) })).click();
      expect(spentIn(who, 'blade')).toBe(1);
      expect(pathSummary(who)).toBe(`${shortPathName('blade')} 1`);
    });
  });
});

describe('Hero: Skill Tree', () => {
  it('offers the four Paths and the Crossroads, with what is spent in each', () => {
    const who = makeHero();
    const { built } = mount(skillTree, { run: { hero: who } });
    expect(PATH_TABS).toEqual([...Object.keys(PATHS), 'crossroads']);
    const labels = [...buttons(built).keys()];
    for (const path of Object.keys(PATHS)) {
      expect(labels).toContain(`${shortPathName(path)} ${spentIn(who, path)}`);
    }
    expect(labels).toContain(t('skillTree.crossroadsTitle'));
  });

  it('promises the points a lifetime holds', () => {
    const { built } = mount(skillTree, { run: { hero: makeHero() } });
    expect(HERO_POINTS).toBe(LEVELING.skillPointsAtCap);
    expect(built.topBar.textContent).toContain(t('skillTree.sub', { n: HERO_POINTS }));
  });

  it('shows the chosen Path’s four tiers, each with its skills and pips', () => {
    const { built } = mount(skillTree, { run: { hero: makeHero() } });
    const tiers = [...built.tiers.querySelectorAll('.tier')];
    expect(tiers).toHaveLength(TIERS.length);
    for (const row of TIERS) {
      const ids = skillsOfTier('blade', row.tier);
      expect([row.tier, [...tiers[row.tier - 1].querySelectorAll('.skilltile')].length]).toEqual([
        row.tier,
        ids.length,
      ]);
    }
    // The only filled pip is the rank the Sellsword's origin gave.
    expect(built.tiers.querySelectorAll('.pip--filled')).toHaveLength(1);
    expect(rankOf(makeHero(), 'weapon_training')).toBe(1);
  });

  it('writes each tier’s requirement in its header', () => {
    const who = makeHero();
    const { built } = mount(skillTree, { run: { hero: who } });
    const heads = [...built.tiers.querySelectorAll('.tier__head')];
    expect(heads[0].textContent).toContain(t('skillTree.tierOpen'));
    expect(heads[1].textContent).toContain(tierNote(who, 'blade', 2));
    expect(heads[3].textContent).toContain(t('skillTree.capstone'));
  });

  it('counts the points a tier still wants', () => {
    const who = makeHero();
    const gate = gateFor(2);
    expect(tierNote(who, 'blade', 2)).toBe(t('skillTree.tierMore', { n: gate, m: gate }));
  });

  it('names the capstone’s attribute requirement', () => {
    const who = makeHero();
    expect(tierNote(who, 'blade', 4)).toMatch(/^\d+ points · [A-Z]{3} \d+$/u);
  });

  it('shows a skill’s name, type and effect when it is picked', () => {
    const { built } = mount(skillTree, { run: { hero: makeHero() } });
    expect(built.selected.textContent).toBe(t('skillTree.pick'));
    const id = 'power_strike';
    built.tiers.querySelector(`[aria-label^="${t(`skills.${id}.name`)}"]`).click();
    expect(built.selected.textContent).toContain(t(`skills.${id}.name`));
    expect(built.selected.textContent).toContain(t(`skills.${id}.effect`));
  });

  it('shows both Path requirements as progress on a Crossroads skill', () => {
    const who = makeHero();
    const id = skillsOfPath('crossroads')[0];
    const note = crossroadsNote(who, id);
    expect(note).toContain(`0/${CROSSROADS.pointsInEachPath}`);
    const { built } = mount(skillTree, { run: { hero: who } });
    buttons(built).get(t('skillTree.crossroadsTitle')).click();
    built.tiers.querySelector(`[aria-label^="${t(`skills.${id}.name`)}"]`).click();
    expect(built.selected.textContent).toContain(note);
  });

  it('learns a skill, spends the point, and fills a pip', () => {
    const who = makeHero({ points: 1 });
    const { built } = mount(skillTree, { run: { hero: who } });
    const id = 'power_strike';
    const tile = () => built.tiers.querySelector(`[aria-label^="${t(`skills.${id}.name`)}"]`);
    tile().click();
    buttons(built).get(t('skillTree.learnOne', { skill: t(`skills.${id}.name`) })).click();

    expect(rankOf(who, id)).toBe(1);
    expect(unspent(who)).toBe(0);
    expect(tile().querySelectorAll('.pip--filled')).toHaveLength(1);
    // The chips and the header carry the new count without a re-mount.
    expect(built.paths.textContent).toContain(`${shortPathName('blade')} 1`);
  });

  it('says what is missing instead of learning it', () => {
    const who = makeHero({ points: 1 });
    const { built } = mount(skillTree, { run: { hero: who } });
    const locked = skillsOfTier('blade', 2)[0];
    built.tiers.querySelector(`[aria-label^="${t(`skills.${locked}.name`)}"]`).click();
    const learn = buttons(built).get(t('skillTree.learnOne', { skill: t(`skills.${locked}.name`) }));
    expect(learn.disabled).toBe(true);
    expect(built.learn.textContent).toContain(t('skillTree.locked.tierLocked', { n: gateFor(2) }));
    expect(rankOf(who, locked)).toBe(0);
  });

  it('asks for a skill before it offers to learn one', () => {
    const { built } = mount(skillTree, { run: { hero: makeHero() } });
    const learn = buttons(built).get(t('skillTree.learn'));
    expect(learn.disabled).toBe(true);
    expect(built.learn.textContent).toContain(t('skillTree.pick'));
  });
});
