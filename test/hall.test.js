/**
 * @vitest-environment happy-dom
 *
 * The Hall of the Dead (`05` section 12): the top records by score or by date,
 * each with its rank, a finished game written into it once, and the screen
 * that lists them and opens a record's tombstone.
 */
import { describe, it, expect, vi } from 'vitest';
import { hallView, shortCause, HALL_KEPT } from '../src/systems/death.js';
import { hall } from '../src/ui/screens/hall.js';
import { death } from '../src/ui/screens/death.js';
import { validateScreen } from '../src/shell/layout.js';
import { createSession } from '../src/systems/session.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';

const RECORDS = [
  { name: 'Mirelle', level: 19, origin: 'apprentice', mode: 'adventurer', victory: true, floor: 10, day: 31, score: 48210, steps: 30120, bosses: 10, at: '2026-09-01T10:00:00Z' },
  { name: 'Harrow', level: 8, origin: 'cutpurse', mode: 'ironman', floor: 5, day: 9, cause: { kind: 'monster', name: 'Ghast' }, score: 15213, steps: 6204, bosses: 4, at: '2026-09-20T10:00:00Z' },
  { name: 'Dunn', level: 2, origin: 'sellsword', mode: 'ironman', floor: 1, day: 2, cause: { kind: 'monster', name: 'The Rat King', boss: true }, score: 1340, steps: 400, bosses: 0, at: '2026-09-21T10:00:00Z' },
];

describe('the Hall as it is listed', () => {
  it('ranks by score, and keeps that rank when sorted by date', () => {
    expect(hallView(RECORDS, 'score').map(({ rank, record }) => [rank, record.name])).toEqual([
      [1, 'Mirelle'],
      [2, 'Harrow'],
      [3, 'Dunn'],
    ]);
    expect(hallView(RECORDS, 'recent').map(({ rank, record }) => [rank, record.name])).toEqual([
      [3, 'Dunn'],
      [2, 'Harrow'],
      [1, 'Mirelle'],
    ]);
  });

  it('shows the top 20 and no more', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `h${i}`, score: i, at: `2026-09-${String(i + 1).padStart(2, '0')}` }));
    expect(HALL_KEPT).toBe(20);
    expect(hallView(many)).toHaveLength(20);
    expect(hallView(many)[0].record.score).toBe(29);
  });

  it('says the cause short, the way the mockup rows do', () => {
    expect(shortCause(RECORDS[0])).toBe('VICTORY');
    expect(shortCause(RECORDS[1])).toBe('Ghast, floor 5');
    expect(shortCause(RECORDS[2])).toBe('Rat King, floor 1');
  });
});

describe('a finished game (05 section 12: "or any hero finishes the game")', () => {
  it('is recorded when the last boss falls, and only once', () => {
    const hero = finish(setName(chooseOrigin(createDraft({ seed: 3 }), 'pilgrim'), 'Mirelle'));
    const game = createSession({ hero, seed: 3 });
    game.descend({ floor: 1 });
    expect(game.bossBeaten(1).finished).toBe(null);
    const won = game.bossBeaten(10);
    expect(won.finished).toMatchObject({ name: 'Mirelle', victory: true, cause: null, bosses: 2 });
    // Doubled for a victory (05 section 12).
    expect(won.finished.score).toBe((hero.xp + (hero.gold ?? 0) + 10 * 1000 + 2 * 500) * 2);
    expect(game.bossBeaten(10).finished).toBe(null);
  });
});

describe('the Hall of the Dead screen', () => {
  const routerFor = (params = {}) => ({ current: { id: 'hall', params }, replace: vi.fn(), go: vi.fn(), has: () => true });
  const text = (built) => Object.values(built).filter(Boolean).map((node) => node.textContent).join(' ');

  it('keeps every region on the grid in both frames', () => {
    expect(validateScreen(hall, 'tall')).toEqual([]);
    expect(validateScreen(hall, 'wide')).toEqual([]);
    expect(validateScreen(death, 'tall')).toEqual([]);
    expect(validateScreen(death, 'wide')).toEqual([]);
  });

  it('lists the records, amber and worded for a victory', () => {
    const built = hall.build({ router: routerFor(), hall: RECORDS, params: {}, frame: 'tall' });
    expect(text(built)).toMatch(/1\s+MIRELLE.*VICTORY.*48,210/);
    expect(text(built)).toMatch(/2\s+HARROW.*Ghast, floor 5.*15,213/);
    expect(built.stone).toBeUndefined();
    expect(text(built)).toMatch(/BACK TO TITLE/);
  });

  it('opens a record\'s tombstone in the list\'s place, and the back gesture closes it', () => {
    const router = routerFor({ open: 2 });
    const built = hall.build({ router, hall: RECORDS, params: { open: 2 }, frame: 'tall' });
    expect(built.list).toBeUndefined();
    expect(built.stone.textContent).toMatch(/HERE LIES.*Harrow.*Slain by a Ghast/);
    expect(text(built)).toMatch(/BACK TO THE LIST/);
    expect(hall.onBack({ router })).toBe(true);
    expect(router.replace).toHaveBeenCalledWith('hall', { open: null });
    expect(hall.onBack({ router: routerFor({}) })).toBe(false);
  });

  it('shows the list and a tombstone side by side in the wide frame', () => {
    const built = hall.build({ router: routerFor(), hall: RECORDS, params: {}, frame: 'wide' });
    expect(built.list).toBeTruthy();
    expect(built.stone.textContent).toMatch(/VICTORIOUS.*Mirelle/);
  });

  it('keeps the sort in its params, so rotating keeps it', () => {
    const router = routerFor();
    const built = hall.build({ router, hall: RECORDS, params: {}, frame: 'tall' });
    const recent = [...built.sort.querySelectorAll('button')].find((b) => b.textContent.includes('RECENT'));
    recent.click();
    expect(router.replace).toHaveBeenCalledWith('hall', { sort: 'recent', open: null });
  });

  it('says so when no one has fallen yet', () => {
    const built = hall.build({ router: routerFor(), hall: [], params: {}, frame: 'tall' });
    expect(text(built)).toMatch(/No one has fallen yet/);
  });
});
