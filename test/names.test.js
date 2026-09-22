/**
 * Rolling a hero's name (DECISIONS, 2026-09-22).
 *
 * The properties that matter are the ones creation leans on everywhere else:
 * the same seed and draw always give the same name, a different draw gives a
 * different one, and nothing that comes back is too long for the sheet.
 */
import { describe, it, expect } from 'vitest';
import { NAME_LIMIT, NAME_PARTS, nameFor, rollName } from '../src/systems/names.js';
import { createDraft, rollHeroName, whyNotReady } from '../src/systems/creation.js';
import { nameStream } from '../src/engine/rng.js';

describe('a rolled name', () => {
  it('is built from the parts in names.json', () => {
    const starts = new RegExp(`^(${NAME_PARTS.starts.join('|')})`);
    const ends = new RegExp(`(${NAME_PARTS.ends.join('|')})$`);
    for (let draw = 0; draw < 200; draw += 1) {
      const [given, ...rest] = nameFor(7, draw).split(' ');
      expect(given).toMatch(starts);
      expect(given).toMatch(ends);
      if (rest.length) expect(NAME_PARTS.epithets).toContain(rest.join(' '));
    }
  });

  it('never comes back empty, untrimmed, or longer than the sheet holds', () => {
    for (let draw = 0; draw < 500; draw += 1) {
      const name = nameFor(1234, draw);
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(NAME_LIMIT);
    }
  });

  it('drops the epithet rather than cutting it in half', () => {
    // A tiny limit leaves room for no epithet at all, so every name is bare.
    for (let draw = 0; draw < 100; draw += 1) {
      expect(rollName(nameStream(99, draw), 8)).not.toContain(' ');
    }
  });

  it('gives the same name for the same seed and draw, for ever', () => {
    expect(nameFor(4242, 3)).toBe(nameFor(4242, 3));
    expect(nameFor(4242, 3)).not.toBe(nameFor(4243, 3));
  });

  it('gives a new name on nearly every tap', () => {
    const names = new Set(Array.from({ length: 50 }, (_, draw) => nameFor(4242, draw)));
    expect(names.size).toBeGreaterThan(45);
    // Enough parts that two players are unlikely to meet the same hero:
    // twenty thousand taps of one seed find over eight thousand names, and
    // the lists reach roughly eighteen thousand in all.
    const all = new Set(Array.from({ length: 20000 }, (_, draw) => nameFor(11, draw)));
    expect(all.size).toBeGreaterThan(8000);
  });

  it('uses the epithets often enough to be worth having', () => {
    const rolled = Array.from({ length: 400 }, (_, draw) => nameFor(808, draw));
    expect(rolled.filter((name) => name.includes(' ')).length).toBeGreaterThan(20);
  });
});

describe('rolling a name on the Create: Origin screen', () => {
  it('fills a draft that had no name, and counts the taps', () => {
    let draft = createDraft({ seed: 4242 });
    expect(whyNotReady(draft)).toBe('noOrigin');

    draft = rollHeroName(draft);
    expect(draft.nameDraw).toBe(1);
    expect(draft.name).toBe(nameFor(4242, 1));

    draft = rollHeroName(draft);
    expect(draft.nameDraw).toBe(2);
    expect(draft.name).toBe(nameFor(4242, 2));
  });

  it('answers the "your hero needs a name" hold on its own', () => {
    const draft = rollHeroName({ ...createDraft({ seed: 5 }), origin: 'pilgrim' });
    expect(whyNotReady(draft)).toBe(null);
  });
});
