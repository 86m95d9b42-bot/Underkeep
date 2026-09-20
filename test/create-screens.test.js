/**
 * @vitest-environment happy-dom
 *
 * New Game, Create: Attributes and Create: Origin
 * (`00-build-outline.md`, "Start and Hero Creation").
 *
 * The rules are tested in `creation.test.js`; this is about the three screens:
 * that they place what the outline's tables say in both frames, that the
 * choices reach the draft, and that the primary button says why it is off.
 */
import { describe, it, expect, vi } from 'vitest';
import { newGame, REGIONS as NEW_GAME_REGIONS } from '../src/ui/screens/newgame.js';
import { createStats, REGIONS as STATS_REGIONS } from '../src/ui/screens/create-stats.js';
import { createOrigin, REGIONS as ORIGIN_REGIONS } from '../src/ui/screens/create-origin.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, setName } from '../src/systems/creation.js';
import { ATTRIBUTE_ORDER } from '../src/data/attributes.js';
import { t } from '../src/data/strings.js';

const SEED = 20260918;

/** Builds a screen into a detached tree, the way the router would. */
function mount(screen, { frame = 'tall', params = {}, startRun } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = screen.build({ router, params, frame, startRun, settings: { all: {} } });
  const placed = placeRegions({ ...screen, regions: screen.regions }, frame);
  return { built, placed, router };
}

/** Every button in a built screen, by its visible label. */
function buttons(built) {
  const found = new Map();
  for (const node of Object.values(built)) {
    // A region may be a button itself, as BEGIN is.
    const nodes = [...(node.tagName === 'BUTTON' ? [node] : []), ...(node.querySelectorAll?.('button') ?? [])];
    for (const btn of nodes) {
      const label = (btn.querySelector('.label')?.textContent ?? btn.textContent).trim();
      if (label && !found.has(label)) found.set(label, btn);
    }
  }
  return found;
}

describe('where the three screens put things', () => {
  it("follows the outline's New Game table", () => {
    // Mode 3/4-7, difficulty 8/9-10, rolls 11/12-13, seed 14/15-16, BEGIN 17-18.
    expect(NEW_GAME_REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(NEW_GAME_REGIONS.mode.tall).toEqual([1, 9, 3, 7]);
    expect(NEW_GAME_REGIONS.difficulty.tall).toEqual([1, 9, 8, 10]);
    expect(NEW_GAME_REGIONS.rolls.tall).toEqual([1, 9, 11, 13]);
    expect(NEW_GAME_REGIONS.seed.tall).toEqual([1, 9, 14, 16]);
    expect(NEW_GAME_REGIONS.begin.tall).toEqual([1, 9, 17, 18]);
  });

  it("follows the outline's Create: Attributes table", () => {
    // Six rows of two, rows 3-14; preview 15-16; REROLL and NEXT 17-18.
    expect(STATS_REGIONS.first.tall).toEqual([1, 9, 3, 8]);
    expect(STATS_REGIONS.second.tall).toEqual([1, 9, 9, 14]);
    expect(STATS_REGIONS.preview.tall).toEqual([1, 9, 15, 16]);
    expect(STATS_REGIONS.reroll.tall).toEqual([1, 4, 17, 18]);
    expect(STATS_REGIONS.next.tall).toEqual([5, 9, 17, 18]);
  });

  it("follows the outline's Create: Origin table", () => {
    // Name 3/4-5, cards 6/7-14, kit 15-16 (scrolls), primary 17-18.
    expect(ORIGIN_REGIONS.name.tall).toEqual([1, 9, 3, 5]);
    expect(ORIGIN_REGIONS.origins.tall).toEqual([1, 9, 6, 14]);
    expect(ORIGIN_REGIONS.kit.tall).toEqual([1, 9, 15, 16]);
    expect(ORIGIN_REGIONS.enter.tall).toEqual([1, 9, 17, 18]);
  });

  it('places cleanly in both frames', () => {
    for (const screen of [newGame, createStats, createOrigin]) {
      expect([screen.id, validateScreen(screen, 'tall')]).toEqual([screen.id, []]);
      expect([screen.id, validateScreen(screen, 'wide')]).toEqual([screen.id, []]);
      for (const frame of ['tall', 'wide']) {
        const { placed } = mount(screen, { frame, params: { seed: SEED } });
        expect([screen.id, frame, placed.size]).toEqual([
          screen.id,
          frame,
          Object.keys(screen.regions).length,
        ]);
      }
    }
  });

  it('puts the mode cards and the three settings on opposite sides when wide', () => {
    // 00: "Mode cards left; difficulty, roll style, seed, and BEGIN right."
    expect(NEW_GAME_REGIONS.mode.wide[1]).toBeLessThanOrEqual(9);
    for (const name of ['difficulty', 'rolls', 'seed']) {
      expect([name, NEW_GAME_REGIONS[name].wide[0]]).toEqual([name, 10]);
    }
  });

  it('splits the six attributes three and three when wide', () => {
    expect(STATS_REGIONS.first.wide[1]).toBeLessThanOrEqual(9);
    expect(STATS_REGIONS.second.wide[0]).toBe(10);
  });
});

describe('New Game', () => {
  it('offers the modes, difficulties and roll styles the document names', () => {
    const { built } = mount(newGame);
    const labels = [...buttons(built).keys()];
    for (const key of ['modes.adventurer', 'modes.ironman']) {
      expect(labels).toContain(t(`newGame.${key}`));
    }
    for (const id of ['easy', 'normal', 'hard']) {
      expect(labels).toContain(t(`newGame.difficulties.${id}`));
    }
    for (const id of ['classic', 'standard']) {
      expect(labels).toContain(t(`newGame.rollModes.${id}`));
    }
  });

  it('starts on Adventurer, Normal and Standard', () => {
    const { built } = mount(newGame);
    const pressed = (label) => buttons(built).get(label)?.getAttribute('aria-pressed');
    expect(pressed(t('newGame.modes.adventurer'))).toBe('true');
    expect(pressed(t('newGame.difficulties.normal'))).toBe('true');
    expect(pressed(t('newGame.rollModes.standard'))).toBe('true');
  });

  it('carries the choices to Create: Attributes, with the seed that was typed', () => {
    const { built, router } = mount(newGame);
    buttons(built).get(t('newGame.modes.ironman')).click();
    buttons(built).get(t('newGame.difficulties.hard')).click();
    buttons(built).get(t('newGame.rollModes.classic')).click();

    const input = built.seed.querySelector('input');
    input.value = '4242';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    buttons(built).get(t('newGame.begin')).click();
    expect(router.go).toHaveBeenCalledWith('createStats', {
      seed: 4242,
      mode: 'ironman',
      difficulty: 'hard',
      rollMode: 'classic',
    });
  });

  it('makes a seed up when the player leaves it blank', () => {
    const { built, router } = mount(newGame);
    buttons(built).get(t('newGame.begin')).click();
    const [, params] = router.go.mock.calls[0];
    expect(typeof params.seed).toBe('number');
  });

  it('fills the box when the new-seed key is tapped', () => {
    const { built } = mount(newGame);
    const input = built.seed.querySelector('input');
    expect(input.value).toBe('');
    buttons(built).get(t('newGame.seedRandom')).click();
    expect(input.value).toMatch(/^\d+$/);
  });
});

describe('Create: Attributes', () => {
  const params = { seed: SEED, rollMode: 'standard' };

  it('shows all six, with a score and a modifier each', () => {
    const { built } = mount(createStats, { params });
    const rows = [...built.first.querySelectorAll('.statrow'), ...built.second.querySelectorAll('.statrow')];
    expect(rows).toHaveLength(ATTRIBUTE_ORDER.length);
    for (const row of rows) {
      expect(row.querySelector('.statrow__score').textContent).toMatch(/^\d+$/);
      expect(row.querySelector('.statrow__mod').textContent).toMatch(/^[+−]\d+$/);
    }
  });

  it('shows the live preview of HP, Focus and Defense', () => {
    const { built } = mount(createStats, { params });
    const text = built.preview.textContent;
    for (const key of ['hp', 'fp', 'def']) expect(text).toContain(t(`create.${key}`));
  });

  it('rerolls every score in place', () => {
    const { built } = mount(createStats, { params });
    const scores = () =>
      [...built.first.querySelectorAll('.statrow__score')].map((node) => node.textContent);
    const before = scores();
    buttons(built).get(t('create.reroll')).click();
    expect(scores()).not.toEqual(before);
  });

  it('swaps two scores in Standard, on two taps', () => {
    const { built } = mount(createStats, { params });
    const rows = () => [...built.first.querySelectorAll('.statrow')];
    const scoreOf = (i) => rows()[i].querySelector('.statrow__score').textContent;
    const [first, second] = [scoreOf(0), scoreOf(1)];

    rows()[0].click();
    expect(rows()[0].classList.contains('statrow--picked')).toBe(true);
    rows()[1].click();
    expect([scoreOf(0), scoreOf(1)]).toEqual([second, first]);
  });

  it('offers no swapping in Classic, and says so', () => {
    const { built } = mount(createStats, { params: { seed: SEED, rollMode: 'classic' } });
    const row = built.first.querySelector('.statrow');
    expect(row.disabled).toBe(true);
    expect(row.querySelector('.statrow__swap')).toBe(null);
    expect(built.topBar.textContent).toContain(t('create.classicHint'));
  });

  it('hands the draft on to Create: Origin', () => {
    const { built, router } = mount(createStats, { params });
    buttons(built).get(t('create.next')).click();
    const [id, sent] = router.go.mock.calls[0];
    expect(id).toBe('createOrigin');
    expect(sent.draft.scores).toBeTruthy();
  });
});

describe('Create: Origin', () => {
  const draftFor = () => createDraft({ seed: SEED, rollMode: 'standard' });

  it('shows the four origins with their bonus', () => {
    const { built } = mount(createOrigin, { params: { draft: draftFor() } });
    const labels = [...buttons(built).keys()];
    for (const id of ['sellsword', 'cutpurse', 'apprentice', 'pilgrim']) {
      expect(labels).toContain(t(`origins.${id}.name`));
    }
    expect(built.origins.textContent).toContain('+1 MIG');
  });

  it('shows the chosen origin’s kit, and nothing before one is chosen', () => {
    const { built } = mount(createOrigin, { params: { draft: draftFor() } });
    expect(built.kit.textContent).toContain(t('create.chooseOne'));
    buttons(built).get(t('origins.cutpurse.name')).click();
    // The items are named from `04` now, not spelled out from their ids.
    expect(built.kit.textContent).toContain('Lockpicks');
    expect(built.kit.textContent).toContain('Dagger x3');
    expect(built.kit.textContent).toContain('25 gp');
  });

  it('keeps the primary button off until there is an origin and a name', () => {
    const { built } = mount(createOrigin, { params: { draft: draftFor() } });
    const enter = () => buttons(built).get(t('create.enter'));
    expect(enter().disabled).toBe(true);
    expect(enter().textContent).toContain(t('create.noOrigin'));

    buttons(built).get(t('origins.pilgrim.name')).click();
    expect(enter().disabled).toBe(true);
    expect(enter().textContent).toContain(t('create.noName'));

    const input = built.name.querySelector('input');
    input.value = 'Brannoc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(enter().disabled).toBe(false);
  });

  it('starts the run with the finished hero', () => {
    const startRun = vi.fn();
    const draft = setName(chooseOrigin(draftFor(), 'pilgrim'), 'Brannoc');
    const { built, router } = mount(createOrigin, { params: { draft }, startRun });
    buttons(built).get(t('create.enter')).click();

    expect(startRun).toHaveBeenCalledOnce();
    const hero = startRun.mock.calls[0][0];
    expect(hero).toMatchObject({ name: 'Brannoc', origin: 'pilgrim', level: 1 });
    expect(hero.maxHp).toBeGreaterThan(0);
    // `00`'s screen flow ends creation in the Town, not underground.
    expect(router.go).toHaveBeenCalledWith('town');
  });
});
