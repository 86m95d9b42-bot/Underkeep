/**
 * Every screen must place correctly in both frames and keep the UI rules from
 * CLAUDE.md. As screens are added in later phases they go in the list below and
 * are checked the same way.
 */
import { describe, it, expect } from 'vitest';
import { validateScreen, placeRegions } from '../src/shell/layout.js';
import { title } from '../src/ui/screens/title.js';
import { settings } from '../src/ui/screens/settings.js';
import { t, strings } from '../src/data/strings.js';

const SCREENS = [title, settings];

describe.each(SCREENS.map((s) => [s.id, s]))('%s', (id, screen) => {
  it('places in both frames with no broken rules', () => {
    expect(validateScreen(screen)).toEqual([]);
  });

  it('has no two regions overlapping in either frame', () => {
    for (const frame of ['tall', 'wide']) {
      const cells = new Map();
      for (const [name, [c1, c2, r1, r2]] of placeRegions(screen, frame)) {
        for (let c = c1; c <= c2; c++) {
          for (let r = r1; r <= r2; r++) {
            const key = `${c},${r}`;
            expect(
              cells.has(key),
              `${id}.${name} overlaps ${id}.${cells.get(key)} at ${key} in the ${frame} frame`,
            ).toBe(false);
            cells.set(key, name);
          }
        }
      }
    }
  });
});

describe('the Title screen', () => {
  it('matches the build outline row for row', () => {
    const placed = placeRegions(title, 'tall');
    expect(placed.get('logo')).toEqual([1, 9, 1, 6]);
    expect(placed.get('lastPlayed')).toEqual([1, 9, 7, 10]);
    expect(placed.get('continue')).toEqual([1, 9, 11, 12]);
    expect(placed.get('newGame')).toEqual([1, 9, 13, 14]);
    expect(placed.get('hall')).toEqual([1, 9, 15, 16]);
    expect(placed.get('settings')).toEqual([1, 9, 17, 18]);
  });

  it('stacks the four buttons in the right half when wide', () => {
    const placed = placeRegions(title, 'wide');
    for (const name of ['continue', 'newGame', 'hall', 'settings']) {
      expect(placed.get(name)[0]).toBeGreaterThanOrEqual(10);
    }
    expect(placed.get('logo')[1]).toBeLessThanOrEqual(9);
  });
});

describe('the Settings screen', () => {
  it('matches the build outline row for row', () => {
    const placed = placeRegions(settings, 'tall');
    expect(placed.get('top')).toEqual([1, 9, 1, 2]);
    expect(placed.get('list')).toEqual([1, 9, 3, 16]);
    expect(placed.get('export')).toEqual([1, 4, 17, 18]);
    expect(placed.get('import')).toEqual([5, 9, 17, 18]);
  });
});

describe('strings', () => {
  it('reads a nested string', () => {
    expect(t('title.continue')).toBe('CONTINUE');
    expect(t('app.name')).toBe('UNDERKEEP');
  });

  it('shows the path itself when a string is missing, never "undefined"', () => {
    expect(t('nope.missing')).toBe('nope.missing');
    expect(t('title')).toBe('title');
  });

  it('holds no empty text', () => {
    const walk = (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string') expect(value.trim(), `${path}.${key}`).not.toBe('');
        else walk(value, `${path}.${key}`);
      }
    };
    walk(strings, 'strings');
  });
});
