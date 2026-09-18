import { describe, it, expect } from 'vitest';
import { placeRegions, validateScreen, sideOf, gridStyle } from '../src/shell/layout.js';
import { frameFor } from '../src/shell/frame.js';

/** A screen whose regions sit neatly either side of the fold. */
const foldScreen = {
  id: 'fold-demo',
  pattern: 'fold',
  regions: {
    art: { tall: [1, 9, 1, 6] },
    card: { tall: [1, 9, 7, 9] },
    a: { tall: [1, 9, 11, 12], tap: true },
    b: { tall: [1, 4, 17, 18], tap: true },
  },
};

describe('tall frame', () => {
  it('uses each region\'s tall placement unchanged', () => {
    const placed = placeRegions(foldScreen, 'tall');
    expect(placed.get('art')).toEqual([1, 9, 1, 6]);
    expect(placed.get('b')).toEqual([1, 4, 17, 18]);
  });

  it('rejects a placement outside the 9 x 18 grid', () => {
    const bad = { id: 'bad', regions: { x: { tall: [1, 10, 1, 2] } } };
    expect(() => placeRegions(bad, 'tall')).toThrow(/outside the tall/);
  });

  it('rejects a placement whose end comes before its start', () => {
    const bad = { id: 'bad', regions: { x: { tall: [5, 2, 1, 2] } } };
    expect(() => placeRegions(bad, 'tall')).toThrow(/outside the tall/);
  });
});

describe('the fold rule', () => {
  it('keeps rows above the fold in the left half', () => {
    const placed = placeRegions(foldScreen, 'wide');
    expect(placed.get('art')).toEqual([1, 9, 1, 6]);
    expect(placed.get('card')).toEqual([1, 9, 7, 9]);
  });

  it('moves rows below the fold to the right half, less 9', () => {
    const placed = placeRegions(foldScreen, 'wide');
    expect(placed.get('a')).toEqual([10, 18, 2, 3]);
    expect(placed.get('b')).toEqual([10, 13, 8, 9]);
  });

  it('refuses a region that crosses the fold with no wide placement', () => {
    const screen = { id: 'x', pattern: 'fold', regions: { r: { tall: [1, 9, 7, 10] } } };
    expect(() => placeRegions(screen, 'wide')).toThrow(/cross the fold/);
  });

  it('accepts a crossing region once it has a wide placement', () => {
    const screen = {
      id: 'x',
      pattern: 'fold',
      regions: { r: { tall: [1, 9, 7, 10], wide: [1, 9, 7, 9] } },
    };
    expect(placeRegions(screen, 'wide').get('r')).toEqual([1, 9, 7, 9]);
  });
});

describe('sideOf', () => {
  it('reads the side from the rows', () => {
    expect(sideOf({ tall: [1, 9, 1, 9] })).toBe('left');
    expect(sideOf({ tall: [1, 9, 10, 18] })).toBe('right');
    expect(sideOf({ tall: [1, 9, 8, 12] })).toBe('crosses');
  });

  it('lets an explicit side win', () => {
    expect(sideOf({ tall: [1, 9, 1, 4], side: 'right' })).toBe('right');
  });
});

describe('stage + controls', () => {
  const screen = {
    id: 'stage-demo',
    pattern: 'stage',
    regions: {
      view: { tall: [1, 9, 3, 10], side: 'left' },
      log: { tall: [1, 9, 11, 12], side: 'left' },
      pad: { tall: [1, 6, 13, 18], side: 'right' },
    },
  };

  it('packs each half into its own nine rows', () => {
    const placed = placeRegions(screen, 'wide');
    // The left half holds rows 3–12 of the tall screen, scaled to 1–9.
    expect(placed.get('view')).toEqual([1, 9, 1, 7]);
    expect(placed.get('log')).toEqual([1, 9, 8, 9]);
    // The right half holds one region, so it fills the half.
    expect(placed.get('pad')).toEqual([10, 15, 1, 9]);
  });

  it('leaves no gaps or overlaps between packed regions', () => {
    const placed = placeRegions(screen, 'wide');
    const left = [placed.get('view'), placed.get('log')];
    expect(left[0][2]).toBe(1);
    expect(left[1][3]).toBe(9);
    expect(left[1][2]).toBe(left[0][3] + 1);
  });
});

describe('panel (sheets)', () => {
  it('puts the sheet in columns 11–18', () => {
    const screen = {
      id: 'sheet-demo',
      pattern: 'panel',
      regions: {
        under: { tall: [1, 9, 1, 6], side: 'left' },
        body: { tall: [1, 9, 9, 16], side: 'right' },
        buttons: { tall: [1, 9, 17, 18], side: 'right' },
      },
    };
    const placed = placeRegions(screen, 'wide');
    expect(placed.get('body')[0]).toBe(11);
    expect(placed.get('body')[1]).toBe(18);
    expect(placed.get('buttons')[0]).toBe(11);
    expect(placed.get('under')).toEqual([1, 9, 1, 9]);
  });
});

describe('validateScreen', () => {
  it('passes a sound screen', () => {
    expect(validateScreen(foldScreen)).toEqual([]);
  });

  it('reports a tap target shorter than two rows', () => {
    const screen = {
      id: 'thin',
      pattern: 'fold',
      regions: { go: { tall: [1, 9, 18, 18], tap: true } },
    };
    expect(validateScreen(screen).join(' ')).toMatch(/spans 1 row/);
  });

  it('reports a bad placement instead of throwing', () => {
    const screen = { id: 'oops', regions: { x: { tall: [1, 9, 1, 19] } } };
    expect(validateScreen(screen).length).toBeGreaterThan(0);
  });
});

describe('gridStyle', () => {
  it('turns an inclusive placement into CSS grid lines', () => {
    expect(gridStyle([1, 9, 11, 12])).toEqual({ gridColumn: '1 / 10', gridRow: '11 / 13' });
  });
});

describe('frameFor', () => {
  it('picks wide at an aspect ratio of 1.2 or more', () => {
    expect(frameFor(844, 390)).toBe('wide');
    expect(frameFor(1180, 820)).toBe('wide');
    expect(frameFor(1200, 1000)).toBe('wide');
  });

  it('picks tall below that', () => {
    expect(frameFor(390, 844)).toBe('tall');
    expect(frameFor(820, 1180)).toBe('tall');
    expect(frameFor(1199, 1000)).toBe('tall');
  });

  it('survives a zero-height viewport', () => {
    expect(frameFor(390, 0)).toBe('tall');
  });
});
