/**
 * The run: one game in progress (`05` sections 5, 11 and 14).
 *
 * These are the rules the Exploration screen sits on — what a press does, what
 * reaches the log, and what stays quiet — so they run in plain Node with no
 * screen at all.
 */
import { describe, it, expect } from 'vitest';
import { createRun, lineFor, PLACEHOLDER_HERO, LOG_KEPT } from '../src/systems/run.js';
import { tileAhead } from '../src/dungeon/movement.js';
import { t } from '../src/data/strings.js';

const SEED = 20260918;
const key = (x, y) => `${x},${y}`;

/** Turns the hero until the way ahead is clear, then steps. */
function stepAnywhere(run) {
  for (let i = 0; i < 4; i += 1) {
    const { outcome } = run.press('forward');
    if (outcome.moved) return outcome;
    run.press('turnRight');
  }
  return null;
}

describe('starting a run', () => {
  it('builds the floor and puts the hero where it arrives', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    expect(run.floor.floor).toBe(1);
    expect(run.ex.pos).toEqual(run.floor.start.pos);
    expect(run.ex.facing).toBe(run.floor.start.facing);
    expect(run.ex.steps).toBe(0);
    expect(run.hero.maxHp).toBe(PLACEHOLDER_HERO.maxHp);
    // The log opens with what the arrival tile holds: the hero is standing on
    // the up stairs (`07` section 3 step 2).
    expect(run.log.map((line) => line.text)).toContain(t('explore.log.stairs.up'));
  });

  it('rebuilds the same floor from the same seed', () => {
    const one = createRun({ masterSeed: SEED, floor: 3 });
    const two = createRun({ masterSeed: SEED, floor: 3 });
    expect(two.floor.map).toEqual(one.floor.map);
    expect(two.ex.pos).toEqual(one.ex.pos);
  });
});

describe('pressing a key', () => {
  it('resolves and commits before it returns', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    const before = [...run.ex.pos];
    const moved = stepAnywhere(run);
    expect(moved).not.toBe(null);
    expect(run.ex.pos).not.toEqual(before);
    // The clock was wound by the same press: a step is one tick (01 section 9).
    expect(run.ex.steps).toBeGreaterThan(0);
  });

  it('winds the clock on a turn and not on a bump', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    run.press('turnRight');
    expect(run.ex.steps).toBe(1);

    // Face the wall behind the arrival dead end and push.
    const facingWall = (run.floor.start.facing + 2) % 4;
    while (run.ex.facing !== facingWall) run.press('turnRight');
    const steps = run.ex.steps;
    const { outcome } = run.press('forward');
    expect(outcome.blocked).not.toBe(null);
    expect(run.ex.steps).toBe(steps);
  });

  it('rolls a wandering check every ten ticks', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    for (let i = 0; i < 30; i += 1) run.press('turnRight');
    expect(run.ex.steps).toBe(30);
    expect(run.ex.checks).toBe(3);
  });

  it('plays out identically from the same seed', () => {
    const play = () => {
      const run = createRun({ masterSeed: SEED, floor: 2 });
      for (let i = 0; i < 60; i += 1) run.press(i % 5 === 0 ? 'turnRight' : 'forward');
      return { pos: run.ex.pos, steps: run.ex.steps, checks: run.ex.checks, log: run.log };
    };
    expect(play()).toEqual(play());
  });
});

describe('what reaches the log', () => {
  it("says why a step was refused, in the hero's own terms", () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    const facingWall = (run.floor.start.facing + 2) % 4;
    while (run.ex.facing !== facingWall) run.press('turnRight');
    run.press('forward');
    expect(run.log.at(-1).text).toBe(t('explore.blocked.wall'));
  });

  it('keeps an undetected trap to itself', () => {
    // An event the hero could not have noticed makes no line at all.
    expect(lineFor({ type: 'trap', trap: { found: false } })).toBe(null);
    expect(lineFor({ type: 'newTile' })).toBe(null);
    expect(lineFor({ type: 'hazard', kind: 'spinner' })).toBe(null);
  });

  it('is silent on a wandering check that found nothing', () => {
    expect(lineFor({ type: 'wanderingCheck', encounter: false })).toBe(null);
    expect(lineFor({ type: 'wanderingCheck', encounter: true }).text).toBe(t('explore.log.wandering'));
  });

  it('never gives a secret door away', () => {
    // 03 section 6: a secret door looks like wall until it is found.
    const line = lineFor({ type: 'blocked', reason: 'secret', looksLike: 'wall' });
    expect(line.text).toBe(t('explore.blocked.wall'));
  });

  it('warns on the way into the Safe Room, once', () => {
    const run = createRun({ masterSeed: SEED, floor: 4 });
    const safeRoom = run.floor.rooms.find((room) => room.id === run.floor.safeRoom);
    const [rx, ry] = safeRoom.rect;

    // Walk in by hand: the crossing is what the run watches for.
    run.ex.pos = [rx - 1, ry + 1];
    run.ex.pos = [rx + 1, ry + 1];
    const events = run.press('turnRight').events;
    expect(events.some((e) => e.type === 'safeRoom')).toBe(true);
    expect(run.log.at(-1).text).toBe(t('explore.log.safeRoom'));

    const again = run.press('turnRight').events;
    expect(again.some((e) => e.type === 'safeRoom')).toBe(false);
  });

  it('keeps the log to its last lines', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    for (let i = 0; i < LOG_KEPT + 20; i += 1) run.say(`line ${i}`);
    expect(run.log).toHaveLength(LOG_KEPT);
    expect(run.log.at(-1).text).toBe(`line ${LOG_KEPT + 19}`);
  });
});

describe('the context key', () => {
  it('offers SEARCH on open floor, and cannot do it yet', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    // The arrival tile holds the waystone, so step off it first.
    stepAnywhere(run);
    expect(['search', 'open', 'touch', 'drink', 'offer', 'burn']).toContain(run.context);
    if (run.context === 'search') expect(run.actReason).toBe(t('common.comingSoon'));
  });

  it('burns a web curtain with a torch, and the way is then open', () => {
    // 03 section 8: burning needs no roll. Everything else the key can offer
    // belongs to Phase 6 or Phase 7.
    const run = createRun({ masterSeed: SEED, floor: 4 });
    const moved = stepAnywhere(run);
    expect(moved).not.toBe(null);

    const ahead = tileAhead(run.ex.pos, run.ex.facing);
    run.floor.hazards[key(...ahead)] = { kind: 'web_curtain', pos: ahead, burned: false, found: true };

    expect(run.context).toBe('burn');
    expect(run.actReason).toBe(undefined);
    expect(run.press('forward').outcome.blocked.reason).toBe('web');

    const { events } = run.act();
    expect(events[0].type).toBe('burned');
    expect(run.log.at(-1).text).toBe(t('explore.log.burned'));
    // Burning costs a step, like any other use of an item (03 section 1).
    expect(run.ex.steps).toBeGreaterThan(0);
    expect(run.press('forward').outcome.moved).toBe(true);
  });

  it('does nothing when it has nothing to do', () => {
    const run = createRun({ masterSeed: SEED, floor: 1 });
    const before = run.ex.steps;
    expect(run.act().events).toEqual([]);
    expect(run.ex.steps).toBe(before);
  });
});
