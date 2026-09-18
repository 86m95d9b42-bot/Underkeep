/**
 * @vitest-environment happy-dom
 *
 * The Exploration screen (`00-build-outline.md`, "Exploration").
 *
 * The rules it stands on are tested in `run.test.js`; this is about the screen
 * itself: that both frames place what the outline's tables say, that the
 * left-handed setting mirrors the pad rather than growing a second layout, and
 * that a key press and a swipe both move the hero.
 */
import { describe, it, expect, vi } from 'vitest';
import { explore, exploreRegions, REGIONS, MIRRORED } from '../src/ui/screens/explore.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { swipeDirection, thresholdFor, SWIPE_COMMANDS, onSwipe } from '../src/shell/swipe.js';
import { createRun } from '../src/systems/run.js';
import { t } from '../src/data/strings.js';

const SEED = 20260918;

/** Builds the screen into a detached tree, the way the router would. */
function mount({ frame = 'tall', hand = 'right', run = createRun({ masterSeed: SEED, floor: 1 }) } = {}) {
  document.documentElement.dataset.hand = hand;
  const router = { has: () => false, go: vi.fn() };
  const built = explore.build({ router, run, frame, haptics: { buzz: vi.fn() } });
  const placed = placeRegions({ ...explore, regions: explore.regions }, frame);
  return { built, placed, run, router };
}

describe('where everything sits', () => {
  it("follows the outline's portrait table", () => {
    // Rows 1-2 bars and menu, 3-10 view, 11-12 log, 13-18 pad and side column.
    expect(REGIONS.bars.tall).toEqual([1, 7, 1, 2]);
    expect(REGIONS.menu.tall).toEqual([8, 9, 1, 2]);
    expect(REGIONS.view.tall).toEqual([1, 9, 3, 10]);
    expect(REGIONS.log.tall).toEqual([1, 9, 11, 12]);
    expect(REGIONS.forward.tall).toEqual([3, 4, 13, 14]);
    expect(REGIONS.context.tall).toEqual([3, 4, 15, 16]);
    expect(REGIONS.back.tall).toEqual([3, 4, 17, 18]);
    expect(REGIONS.map.tall).toEqual([7, 9, 13, 14]);
  });

  it("follows the outline's landscape table: view centred, pad left, keys right", () => {
    expect(REGIONS.view.wide).toEqual([4, 15, 2, 7]);
    expect(REGIONS.log.wide).toEqual([4, 15, 8, 9]);
    expect(REGIONS.context.wide).toEqual([1, 3, 2, 3]);
    for (const name of ['strafeLeft', 'forward', 'strafeRight', 'turnLeft', 'back', 'turnRight']) {
      expect(REGIONS[name].wide[0], name).toBeLessThanOrEqual(3);
    }
    for (const name of ['map', 'pack', 'hero']) {
      expect(REGIONS[name].wide[0], name).toBe(16);
    }
  });

  it('places every region inside both frames, with 2-row tap targets', () => {
    for (const hand of ['right', 'left']) {
      expect(validateScreen({ ...explore, regions: exploreRegions(hand) }), hand).toEqual([]);
    }
  });

  it('never lets two regions sit on the same cell', () => {
    for (const hand of ['right', 'left']) {
      for (const frame of ['tall', 'wide']) {
        const taken = new Map();
        for (const [name, [c1, c2, r1, r2]] of placeRegions(
          { ...explore, regions: exploreRegions(hand) },
          frame,
        )) {
          for (let c = c1; c <= c2; c += 1) {
            for (let r = r1; r <= r2; r += 1) {
              const cell = `${c},${r}`;
              expect(taken.get(cell), `${frame}/${hand} ${cell}: ${taken.get(cell)} and ${name}`).toBe(undefined);
              taken.set(cell, name);
            }
          }
        }
      }
    }
  });
});

describe('the left-handed setting', () => {
  it('mirrors the pad and the side column, and nothing else', () => {
    const left = exploreRegions('left');
    // Portrait: the side column moves from cols 7-9 to cols 1-3.
    expect(left.map.tall).toEqual([1, 3, 13, 14]);
    expect(left.forward.tall).toEqual([6, 7, 13, 14]);
    expect(left.strafeLeft.tall).toEqual([8, 9, 13, 14]);
    // Landscape: the pad moves to the right-hand columns.
    expect(left.forward.wide).toEqual([17, 17, 4, 5]);
    expect(left.map.wide).toEqual([1, 3, 2, 3]);
    // The menu corner moves with them, and the bars make room for it.
    expect(left.menu.tall).toEqual([1, 2, 1, 2]);
    expect(left.bars.tall).toEqual([3, 9, 1, 2]);
    // The view and the log stay where they are.
    expect(left.view).toEqual(REGIONS.view);
    expect(left.log).toEqual(REGIONS.log);
  });

  it('is the same declaration, mirrored, not a second screen', () => {
    const right = exploreRegions('right');
    const left = exploreRegions('left');
    expect(Object.keys(left)).toEqual(Object.keys(right));
    for (const name of Object.keys(right)) {
      if (MIRRORED.has(name)) continue;
      expect(left[name], name).toBe(right[name]);
    }
  });
});

describe('the screen', () => {
  it('builds every region it declares', () => {
    const { built } = mount();
    for (const name of Object.keys(REGIONS)) {
      // SEARCH is a landscape-only key; everything else is always there.
      if (name === 'search') continue;
      expect(built[name], name).toBeTruthy();
    }
  });

  it('gives the extra SEARCH key to landscape only', () => {
    expect(mount({ frame: 'tall' }).built.search).toBe(null);
    expect(mount({ frame: 'wide' }).built.search).toBeTruthy();
  });

  it('names every key for a screen reader', () => {
    const { built } = mount();
    expect(built.forward.getAttribute('aria-label')).toBe(t('explore.pad.forwardLabel'));
    expect(built.turnLeft.getAttribute('aria-label')).toBe(t('explore.pad.turnLeftLabel'));
    expect(built.map.textContent).toContain(t('explore.side.map'));
    expect(built.log.getAttribute('role')).toBe('log');
  });

  it('shows the floor, the facing and the step count', () => {
    const { built, run } = mount();
    expect(built.menu.textContent).toContain(`F${run.floor.floor}`);
    expect(built.view.textContent).toContain(t('explore.chips.facing'));
    expect(built.view.textContent).toContain(`${t('explore.chips.steps')} 0`);
  });

  it('disables the keys whose screens are not built yet, with a reason', () => {
    const { built } = mount();
    for (const name of ['map', 'pack', 'hero']) {
      expect(built[name].hasAttribute('disabled'), name).toBe(true);
      expect(built[name].textContent, name).toContain(t('common.comingSoon'));
    }
  });

  it('opens the Pause Menu from the menu key and from the back gesture', () => {
    const openSheet = vi.fn();
    const router = { has: () => false, go: vi.fn(), openSheet, currentSheet: null };
    const run = createRun({ masterSeed: SEED, floor: 1 });
    const built = explore.build({ router, run, frame: 'tall', haptics: { buzz: vi.fn() } });

    built.menu.querySelector('.btn').click();
    expect(openSheet).toHaveBeenCalledWith('pause');

    expect(explore.onBack({ router })).toBe(true);
    expect(openSheet).toHaveBeenCalledTimes(2);

    // With the sheet already open, the gesture closes it instead.
    expect(explore.onBack({ router: { ...router, currentSheet: { id: 'pause' } } })).toBe(false);
  });

  it('moves the hero when a pad key is pressed, and updates the chips', () => {
    const { built, run } = mount();
    const before = [...run.ex.pos];

    built.turnRight.click();
    expect(run.ex.facing).not.toBe(run.floor.start.facing);
    expect(built.view.textContent).toContain(`${t('explore.chips.steps')} 1`);

    // Turn until forward is clear, then step.
    for (let i = 0; i < 4 && run.ex.pos[0] === before[0] && run.ex.pos[1] === before[1]; i += 1) {
      built.forward.click();
      if (run.ex.pos[0] === before[0] && run.ex.pos[1] === before[1]) built.turnRight.click();
    }
    expect(run.ex.pos).not.toEqual(before);
  });

  it('writes a blocked step into the log, newest line on top', () => {
    const { built, run } = mount();
    const facingWall = (run.floor.start.facing + 2) % 4;
    while (run.ex.facing !== facingWall) built.turnRight.click();
    built.forward.click();

    expect(run.log.at(-1).text).toBe(t('explore.blocked.wall'));
    expect(built.log.firstElementChild.textContent).toBe(t('explore.blocked.wall'));
  });

  it('repaints the context key with what the hero faces', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    const { built } = mount({ run });
    // The hero arrives on the waystone, so the key offers TOUCH to start with.
    expect(built.context.textContent).toContain(t('explore.context.touch'));

    built.turnRight.click();
    built.forward.click();
    expect(built.context.textContent.length).toBeGreaterThan(0);
  });
});

describe('swipes on the view', () => {
  it('reads a drag as a step or a turn', () => {
    expect(swipeDirection(0, -40, 24)).toBe('up');
    expect(swipeDirection(0, 40, 24)).toBe('down');
    expect(swipeDirection(-40, 0, 24)).toBe('left');
    expect(swipeDirection(40, 5, 24)).toBe('right');
    // Too small to mean anything, and a diagonal goes the way it mostly went.
    expect(swipeDirection(6, -8, 24)).toBe(null);
    expect(swipeDirection(30, -40, 24)).toBe('up');
  });

  it('asks for a real swipe on a big view and a small one alike', () => {
    expect(thresholdFor(390, 300)).toBeCloseTo(36, 5);
    expect(thresholdFor(100, 80)).toBe(24);
  });

  it('maps each direction to the key it stands in for', () => {
    expect(SWIPE_COMMANDS).toEqual({
      up: 'forward',
      down: 'back',
      left: 'turnLeft',
      right: 'turnRight',
    });
  });

  it('fires once a drag on the element is long enough', () => {
    const node = document.createElement('div');
    node.getBoundingClientRect = () => ({ width: 300, height: 260 });
    const seen = [];
    const stop = onSwipe(node, (d) => seen.push(d));

    const drag = (fromX, fromY, toX, toY) => {
      node.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: fromX, clientY: fromY }));
      node.dispatchEvent(new window.PointerEvent('pointerup', { clientX: toX, clientY: toY }));
    };

    drag(100, 200, 100, 100); // up
    drag(100, 100, 40, 105); // left
    drag(100, 100, 104, 108); // too small
    expect(seen).toEqual(['up', 'left']);

    stop();
    drag(100, 200, 100, 100);
    expect(seen).toEqual(['up', 'left']);
  });

  it('turns the hero when the view is swiped', () => {
    const { built, run } = mount();
    const view = built.view;
    view.getBoundingClientRect = () => ({ width: 300, height: 260 });
    const facing = run.ex.facing;

    view.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 200, clientY: 100 }));
    view.dispatchEvent(new window.PointerEvent('pointerup', { clientX: 100, clientY: 100 }));
    expect(run.ex.facing).toBe((facing + 3) % 4);
  });
});
