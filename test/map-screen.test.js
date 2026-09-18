/**
 * @vitest-environment happy-dom
 *
 * The Automap screen (`00-build-outline.md`, Automap).
 *
 * What goes on the map is tested in `automap.test.js`; this is the screen: the
 * two layouts, the legend, and the keys that move the view.
 */
import { describe, it, expect, vi } from 'vitest';
import { map, LEGEND } from '../src/ui/screens/map.js';
import { validateScreen, placeRegions } from '../src/shell/layout.js';
import { createRun } from '../src/systems/run.js';
import { ZOOM } from '../src/dungeon/automap.js';
import { t } from '../src/data/strings.js';

const SEED = 20260918;

function mount(run = createRun({ masterSeed: SEED, floor: 1 })) {
  const router = { has: () => false, go: vi.fn(), back: vi.fn() };
  const built = map.build({ router, run, frame: 'tall' });
  // The map sizes itself from its box, which a detached tree does not have.
  built.map.getBoundingClientRect = () => ({ width: 300, height: 400, left: 0, top: 0 });
  return { built, run, router };
}

const viewBox = (built) => built.map.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);

describe('where everything sits', () => {
  it('follows the outline: map, legend, then the keys', () => {
    expect(map.regions.top.tall).toEqual([1, 9, 1, 2]);
    expect(map.regions.map.tall).toEqual([1, 9, 3, 14]);
    expect(map.regions.legend.tall).toEqual([1, 9, 15, 16]);
    expect(map.regions.controls.tall).toEqual([1, 9, 17, 18]);
  });

  it('gives landscape the map on the left and the keys stacked on the right', () => {
    // 00: "Map cols 1-14; legend and zoom stacked in cols 15-18".
    expect(map.regions.map.wide).toEqual([1, 14, 3, 9]);
    expect(map.regions.legend.wide[0]).toBe(15);
    expect(map.regions.controls.wide).toEqual([15, 18, 4, 9]);
  });

  it('places inside both frames, with 2-row tap targets', () => {
    expect(validateScreen(map)).toEqual([]);
    for (const frame of ['tall', 'wide']) {
      expect(placeRegions(map, frame).size).toBe(Object.keys(map.regions).length);
    }
  });
});

describe('the screen', () => {
  it('names the floor and its theme, and can go back', () => {
    const { built, run, router } = mount();
    expect(built.top.textContent).toContain(`${t('map.title')} ${run.floor.floor}`);
    expect(built.top.textContent).toContain(run.floor.spec.theme);
    built.top.querySelector('.btn').click();
    expect(router.back).toHaveBeenCalled();
  });

  it('draws the tiles the hero has seen, and the hero', () => {
    const { built, run } = mount();
    const svg = built.map.querySelector('svg');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
    // The hero's arrow is drawn last.
    expect(svg.lastElementChild.getAttribute('transform')).toContain(`rotate(${run.ex.facing * 90})`);
  });

  it('lists the legend the rules ask for', () => {
    const { built } = mount();
    const text = built.legend.textContent;
    for (const kind of LEGEND) expect(text, kind).toContain(t(`map.legendNames.${kind}`));
    // It scrolls sideways rather than wrapping (00, Automap).
    expect(built.legend.classList.contains('scroll-x')).toBe(true);
  });

  it('zooms in and out between the limits', () => {
    const { built } = mount();
    const keys = [...built.controls.querySelectorAll('.btn')];
    const zoomOut = keys.find((b) => b.textContent.includes(t('map.zoomOut')));
    const zoomIn = keys.find((b) => b.textContent.includes(t('map.zoomIn')));

    const before = viewBox(built)[2];
    zoomOut.click();
    expect(viewBox(built)[2]).toBeGreaterThan(before);
    zoomIn.click();
    zoomIn.click();
    expect(viewBox(built)[2]).toBeLessThan(before);

    for (let i = 0; i < 30; i += 1) zoomIn.click();
    expect(viewBox(built)[2]).toBeGreaterThanOrEqual(ZOOM.min);
  });

  it('drags the view, and CENTER puts the hero back in the middle', () => {
    const { built } = mount();
    const frame = built.map;
    const start = viewBox(built);

    // Drag towards the middle of the floor: the view is already against its
    // edge behind the hero, where a drag has nowhere to go.
    frame.dispatchEvent(new window.PointerEvent('pointerdown', { pointerId: 1, clientX: 60, clientY: 200 }));
    frame.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 260 }));
    frame.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1, clientX: 150, clientY: 260 }));
    const dragged = viewBox(built);
    expect(dragged[0]).not.toBe(start[0]);

    built.controls.querySelector('.btn').click();
    expect(viewBox(built)).toEqual(start);
  });

  it('pinches to zoom', () => {
    const { built } = mount();
    const frame = built.map;
    const before = viewBox(built)[2];

    const at = (id, x) =>
      new window.PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: 200 });
    frame.dispatchEvent(at(1, 140));
    frame.dispatchEvent(at(2, 160));
    // Fingers apart: fewer tiles across.
    frame.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 2, clientX: 260, clientY: 200 }));
    expect(viewBox(built)[2]).toBeLessThan(before);
  });
});
