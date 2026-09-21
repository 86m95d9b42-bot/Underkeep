/**
 * @vitest-environment happy-dom
 *
 * Chest / Door (`00-build-outline.md`, "Chest / Door"; `03` section 7).
 *
 * The sequence is tested in `chests.test.js`; this is about the screen: that
 * it places what the outline's table says in both frames, that the nine keys
 * say what they cost or why they are off, that the two which can set off a
 * live trap are marked, and that pressing one reaches the run.
 */
import { describe, it, expect, vi } from 'vitest';
import { chest as chestScreen, KEYS, REGIONS, keysFor, tipFor } from '../src/ui/screens/chest.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { createRun } from '../src/systems/run.js';
import { isWalkable } from '../src/dungeon/floor-builder.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { costOf } from '../src/dungeon/step-clock.js';
import { t } from '../src/data/strings.js';

const SEED = 20260918;

/** A hero with the tools the sequence asks for. */
function makeHero() {
  const who = finish(setName(chooseOrigin(createDraft({ seed: SEED }), 'cutpurse'), 'Vex'));
  who.has = { ...who.has, lockpicks: true, pole: true };
  return who;
}

/** A run standing in front of an unopened chest, with the chest it faces. */
function runAtChest({ floor = 5, seeds = 40 } = {}) {
  for (let seed = 1; seed < seeds; seed += 1) {
    const run = createRun({ masterSeed: SEED + seed * 613, floor, hero: makeHero() });
    for (const [at, chest] of Object.entries(run.floor.chests)) {
      const [cx, cy] = at.split(',').map(Number);
      for (const [ox, oy, facing] of [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]]) {
        const [x, y] = [cx + ox, cy + oy];
        if (!isWalkable(run.floor.map?.[y]?.[x])) continue;
        run.ex.pos = [x, y];
        run.ex.facing = facing;
        if (run.chestAhead === chest) return { run, chest };
      }
    }
  }
  throw new Error('no reachable chest found');
}

/** Builds the screen into a detached tree, the way the router would. */
function mount(run, { frame = 'tall' } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = chestScreen.build({ router, run, frame, params: {}, settings: { all: {} } });
  return { built, router };
}

/** The nine keys of the grid, by their visible label. */
function keys(built) {
  const found = new Map();
  for (const btn of built.grid.querySelectorAll('button')) {
    found.set(btn.querySelector('.label').textContent.trim(), btn);
  }
  return found;
}

const hintOf = (btn) => btn.querySelector('.hint')?.textContent ?? '';

describe('where the screen puts things', () => {
  it("follows the outline's Chest / Door table", () => {
    // Status bar 1-2, view 3-7, info card 8-12, the 3 x 3 grid 13-18.
    expect(REGIONS.bars.tall).toEqual([1, 7, 1, 2]);
    expect(REGIONS.menu.tall).toEqual([8, 9, 1, 2]);
    expect(REGIONS.view.tall).toEqual([1, 9, 3, 7]);
    expect(REGIONS.info.tall).toEqual([1, 9, 8, 12]);
    expect(REGIONS.grid.tall).toEqual([1, 9, 13, 18]);
  });

  it('puts the grid in columns 10-18 when wide, with the view and card left', () => {
    // 00: "View and info card left; the 3 x 3 action grid cols 10-18."
    expect(REGIONS.grid.wide[0]).toBe(10);
    expect(REGIONS.view.wide[1]).toBeLessThanOrEqual(9);
    expect(REGIONS.info.wide[1]).toBeLessThanOrEqual(9);
  });

  it('places cleanly in both frames', () => {
    const { run } = runAtChest();
    for (const frame of ['tall', 'wide']) {
      expect([frame, validateScreen(chestScreen, frame)]).toEqual([frame, []]);
      mount(run, { frame });
      const placed = placeRegions(chestScreen, frame);
      expect(placed.size).toBe(Object.keys(REGIONS).length);
    }
  });
});

describe('the info card', () => {
  it('shows the lock from the first look and keeps the trap hidden', () => {
    const { run, chest } = runAtChest();
    chest.lock = 'good';
    chest.tier = 'standard';
    chest.trap = { kind: 'poison_needle', tier: 'standard', found: false, searches: {} };
    const { built } = mount(run);
    const text = built.info.textContent;
    expect(text).toContain(t('chest.locks.good'));
    expect(text).toContain('TN');
    // `03` section 7: the trap is Unknown until it has been searched for.
    expect(text).toContain(t('chest.trapStates.unknown'));
    expect(text).not.toContain(t('traps.poison_needle.name'));
  });

  it('names the trap once the search named it', () => {
    const { run, chest } = runAtChest();
    chest.searches = { normal: true, careful: false };
    chest.trap = { kind: 'poison_needle', tier: 'standard', found: true, typeKnown: true, searches: { normal: true } };
    const { built } = mount(run);
    expect(built.info.textContent).toContain(t('traps.poison_needle.name'));
    expect(built.info.textContent).toContain(t('chest.searched'));
    expect(tipFor(chest)).toBe(t('chest.tips.armed'));
  });
});

describe('the 3 x 3 grid', () => {
  it('has the nine keys the outline lists', () => {
    const { run } = runAtChest();
    const { built } = mount(run);
    expect([...keys(built).keys()]).toEqual(KEYS.map((id) => t(`chest.actions.${id}`)));
  });

  it('shows what each open key costs, and why a closed one is off', () => {
    const { run, chest } = runAtChest();
    chest.lock = 'good';
    chest.tier = 'standard';
    chest.trap = null;
    const { built } = mount(run);
    const grid = keys(built);

    // 03 section 1: a Search is 5 steps, a Careful Search 20 — and the key
    // reads them from the step clock, so it cannot drift from what is spent.
    expect(hintOf(grid.get(t('chest.actions.search')))).toBe(t('chest.hints.steps', { n: 5 }));
    expect(hintOf(grid.get(t('chest.actions.careful')))).toBe(t('chest.hints.steps', { n: 20 }));
    expect(costOf('search')).toBe(5);
    expect(costOf('carefulSearch')).toBe(20);
    // Picking shows the roll's own odds.
    expect(hintOf(grid.get(t('chest.actions.pick')))).toMatch(/^\d+%$/);
    // And nothing found to disarm says so, rather than saying nothing.
    const disarm = grid.get(t('chest.actions.disarm'));
    expect(disarm.disabled).toBe(true);
    expect(hintOf(disarm)).toBe(t('chest.reasons.noTrap'));
    // A locked chest cannot be opened yet, and the key says which step is left.
    const open = grid.get(t('chest.actions.open'));
    expect(open.disabled).toBe(true);
    expect(hintOf(open)).toBe(t('chest.reasons.locked'));
  });

  it('marks BASH red while a trap is armed, because it always sets one off', () => {
    const { run, chest } = runAtChest();
    chest.lock = 'simple';
    chest.tier = 'crude';
    chest.trap = { kind: 'poison_needle', tier: 'crude', found: true, typeKnown: true, searches: { normal: true } };
    const { built } = mount(run);
    const bash = keys(built).get(t('chest.actions.bash'));

    // 00: "OPEN and BASH go red while a trap is armed."
    expect(bash.classList.contains('btn--risky')).toBe(true);
    expect(hintOf(bash)).toBe(t('chest.hints.setsOff'));

    // Disarmed, it is an ordinary key again, showing its own odds.
    chest.trap.disarmed = true;
    expect(keysFor(run).bash.kind).toBe(undefined);
    expect(keysFor(run).bash.hint).toMatch(/^\d+%$/);
  });

  it('marks OPEN red while a trap is armed, and amber once nothing is left', () => {
    const { run, chest } = runAtChest();
    chest.lock = 'none';
    chest.tier = null;
    chest.trap = { kind: 'poison_needle', tier: 'crude', found: true, typeKnown: true, searches: { normal: true } };
    const { built } = mount(run);
    const open = keys(built).get(t('chest.actions.open'));
    expect(open.classList.contains('btn--risky')).toBe(true);
    expect(hintOf(open)).toBe(t('chest.hints.armedWarning'));

    chest.trap.disarmed = true;
    expect(keysFor(run).open.kind).toBe('primary');
  });

  it('will not look twice the same way', () => {
    const { run, chest } = runAtChest();
    const { built } = mount(run);
    keys(built).get(t('chest.actions.search')).click();
    expect(chest.searches.normal).toBe(true);

    const again = keys(built).get(t('chest.actions.search'));
    expect(again.disabled).toBe(true);
    expect(hintOf(again)).toBe(t('chest.reasons.used'));
    // The Careful Search is still there: it is a second, better look.
    expect(keys(built).get(t('chest.actions.careful')).disabled).toBe(false);
  });

  it('spends the hero’s time through the run, not on its own', () => {
    const { run } = runAtChest();
    const { built } = mount(run);
    const steps = run.ex.steps;
    keys(built).get(t('chest.actions.search')).click();
    expect(run.ex.steps).toBe(steps + 5);
    expect(run.log.length).toBeGreaterThan(0);
  });

  it('goes back to the dungeon once the chest is open, and on LEAVE', () => {
    const { run, chest } = runAtChest();
    chest.lock = 'none';
    chest.trap = null;
    chest.mimic = false;
    const { built, router } = mount(run);
    keys(built).get(t('chest.actions.open')).click();
    expect(chest.opened).toBe(true);
    expect(router.go).toHaveBeenCalledWith('explore');

    const fresh = runAtChest();
    const second = mount(fresh.run);
    keys(second.built).get(t('chest.actions.leave')).click();
    expect(second.router.go).toHaveBeenCalledWith('explore');
  });
});
