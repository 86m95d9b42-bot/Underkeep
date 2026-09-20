/**
 * @vitest-environment happy-dom
 *
 * Waystones (`05` section 9): attuning one by standing on it, travelling from
 * town to any that is attuned, and taking one back up.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  attune,
  attunedFloors,
  gateFloors,
  isAttuned,
  markOf,
  placeMark,
  whyNotLeaveByStone,
  whyNotTravel,
} from '../src/systems/travel.js';
import { gate as gateScreen, REGIONS, lineFor } from '../src/ui/screens/gate.js';
import { bossDefeated, createTown } from '../src/systems/town.js';
import { createRun } from '../src/systems/run.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { resetStalker } from '../src/dungeon/step-clock.js';
import { floorSpec } from '../src/data/floors.js';
import { t } from '../src/data/strings.js';

const SEED = 20260918;

function makeHero() {
  return finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 12, luck: 10 },
        },
        'sellsword',
      ),
      'Harrow',
    ),
  );
}

function mount({ frame = 'tall', town = createTown(), descend } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = gateScreen.build({ router, town, descend, frame, settings: { all: {} } });
  return { built, router, town, placed: placeRegions(gateScreen, frame) };
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

describe('attuning (05 section 9)', () => {
  it('happens by standing on the stone, and is permanent', () => {
    const town = createTown();
    expect(isAttuned(town, 3)).toBe(false);
    expect(attune(town, 3)).toEqual({ attuned: true, floor: 3 });
    expect(isAttuned(town, 3)).toBe(true);
    // A second visit is not a second attunement.
    expect(attune(town, 3)).toEqual({ attuned: false, floor: 3 });
    expect(attunedFloors(town)).toEqual([3]);
  });

  it('happens the moment the hero steps onto the stone', () => {
    const town = createTown();
    const run = createRun({ masterSeed: SEED, floor: 2, hero: makeHero(), town });
    // The stone is in the arrival room, a step away, and the hero faces it.
    expect(isAttuned(town, 2)).toBe(false);
    expect(run.context).toBe('touch');

    const { events } = run.press('forward');
    expect(run.ex.pos).toEqual(run.floor.waystone);
    expect(events.some((event) => event.type === 'attuned')).toBe(true);
    expect(isAttuned(town, 2)).toBe(true);
    expect(run.log.some((line) => line.text === t('explore.log.attuned'))).toBe(true);

    // Stepping off and back on says nothing new.
    run.press('back');
    const again = run.press('forward');
    expect(again.events.some((event) => event.type === 'attuned')).toBe(false);
  });

  it('keeps the floors in order however they were found', () => {
    const town = createTown();
    attune(town, 4);
    attune(town, 1);
    attune(town, 2);
    expect(attunedFloors(town)).toEqual([1, 2, 4]);
  });
});

describe('what the Dungeon Gate offers', () => {
  it('lists ten floors, and floor 1 is always reachable', () => {
    const rows = gateFloors(createTown());
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ floor: 1, attuned: true, why: null });
    expect(rows[1]).toMatchObject({ floor: 2, attuned: false, known: false, why: 'unknown' });
  });

  it('knows one floor past the deepest stone or boss', () => {
    const town = createTown();
    attune(town, 1);
    expect(gateFloors(town)[1]).toMatchObject({ floor: 2, known: true, why: 'notAttuned' });
    expect(gateFloors(town)[2]).toMatchObject({ floor: 3, known: false, why: 'unknown' });

    bossDefeated(town, 2);
    expect(gateFloors(town)[2]).toMatchObject({ floor: 3, known: true, why: 'notAttuned' });
  });

  it('travels to any attuned stone, and refuses the rest', () => {
    const town = createTown();
    attune(town, 1);
    attune(town, 4);
    expect(whyNotTravel(town, 1)).toBe(null);
    expect(whyNotTravel(town, 4)).toBe(null);
    expect(whyNotTravel(town, 2)).toBe('notAttuned');
    expect(whyNotTravel(town, 9)).toBe('unknown');
  });
});

describe('taking a Waystone back up', () => {
  it('needs the hero to be standing on one they have attuned', () => {
    const town = createTown();
    const run = createRun({ masterSeed: SEED, floor: 1, hero: makeHero(), town });
    // Beside it, facing it: not yet.
    expect(whyNotLeaveByStone(town, run)).toBe('notOnStone');

    run.press('forward');
    expect(run.ex.pos).toEqual(run.floor.waystone);
    expect(whyNotLeaveByStone(town, run)).toBe(null);
    expect(whyNotLeaveByStone(town, null)).toBe('nowhere');

    const other = createTown();
    expect(whyNotLeaveByStone(other, { floor: run.floor, ex: { pos: run.floor.waystone } })).toBe(
      'notAttuned',
    );
  });

  it('is the context key, and it hands the trip to the session', () => {
    const town = createTown();
    const leaveDungeon = vi.fn();
    const run = createRun({ masterSeed: SEED, floor: 1, hero: makeHero(), town, leaveDungeon });
    // Standing beside it, the key says to stand on it.
    expect(run.actReason).toBe(t('explore.reason.notOnStone'));
    run.press('forward');
    expect(run.context).toBe('touch');
    expect(run.actReason).toBeUndefined();
    expect(run.actHint).toBe(t('explore.hint.toTown'));

    const { events } = run.act();
    expect(events[0]).toMatchObject({ type: 'waystoneTravel', floor: 1 });
    expect(leaveDungeon).toHaveBeenCalledWith({ leaveMark: false, by: 'waystone' });
    expect(run.log.at(-1).text).toBe(t('explore.log.waystoneTravel'));
  });

  it('says why the key is off when the stone is not theirs', () => {
    const town = createTown();
    // No town was given to the run, so nothing it steps on is attuned.
    const run = createRun({ masterSeed: SEED, floor: 1, hero: makeHero() });
    run.press('forward');
    expect(run.context).toBe('touch');
    expect(run.actReason).toBe(t('explore.reason.notAttuned'));
    expect(run.act().events).toEqual([]);
    expect(town.attuned).toEqual([]);
  });

  it('resets the floor\'s Hollow Stalker count (05 section 9)', () => {
    const clock = { steps: 900, sinceCheck: 7, stalkerWarned: [1000], stalkerLoose: true };
    resetStalker(clock);
    expect(clock).toMatchObject({ steps: 0, sinceCheck: 0, stalkerWarned: [], stalkerLoose: false });
  });
});

describe('the Dungeon Gate screen', () => {
  it("follows the outline's table", () => {
    // Bar 1-2, waystones 3-14, the mark card 15-16, DESCEND 17-18.
    expect(REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(REGIONS.floors.tall).toEqual([1, 9, 3, 14]);
    expect(REGIONS.mark.tall).toEqual([1, 9, 15, 16]);
    expect(REGIONS.descend.tall).toEqual([1, 9, 17, 18]);
    expect(validateScreen(gateScreen, 'tall')).toEqual([]);
    expect(validateScreen(gateScreen, 'wide')).toEqual([]);
  });

  it('draws every floor as the mockup writes it', () => {
    const town = createTown();
    attune(town, 1);
    attune(town, 2);
    const { built } = mount({ town });
    expect(built.floors.textContent).toContain(t('gate.floor', { n: 1 }));
    expect(built.floors.textContent).toContain(floorSpec(1).theme);
    expect(built.floors.textContent).toContain(t('gate.attuned'));
    expect(built.floors.textContent).toContain(t('gate.locked'));
    expect(built.floors.textContent).toContain(t('gate.unknown'));
    expect(lineFor({ floor: 2, attuned: true })).toBe(floorSpec(2).theme);
    expect(lineFor({ floor: 9, attuned: false, known: false })).toBe(t('gate.unknown'));
    expect(lineFor({ floor: 3, attuned: false, known: true })).toBe(t('gate.notAttuned'));
  });

  it('starts on the deepest floor the hero can reach', () => {
    const town = createTown();
    attune(town, 1);
    attune(town, 3);
    const { built } = mount({ town });
    expect(built.descend.textContent).toContain(t('gate.descend', { n: 3 }));
  });

  it('descends to the floor that is picked', () => {
    const town = createTown();
    attune(town, 1);
    attune(town, 2);
    const descend = vi.fn();
    const { built, router } = mount({ town, descend });
    const row = [...built.floors.querySelectorAll('button')].find((node) =>
      node.textContent.includes(t('gate.floor', { n: 1 })),
    );
    row.click();
    built.descend.querySelector('button').click();
    expect(descend).toHaveBeenCalledWith({ floor: 1 });
    expect(router.go).toHaveBeenCalledWith('explore');
  });

  it('shows the Return Mark card only when there is one, and takes it', () => {
    const plain = mount();
    expect(plain.built.mark.textContent).not.toContain(t('gate.mark'));

    const town = createTown();
    attune(town, 2);
    placeMark(town, { floor: { floor: 2, arena: { rect: [0, 0, 1, 1] } }, ex: { pos: [9, 9], facing: 1 } });
    expect(markOf(town)).toBeTruthy();

    const descend = vi.fn();
    const { built } = mount({ town, descend });
    expect(built.mark.textContent).toContain(t('gate.markCard', { n: 2 }));
    built.mark.querySelector('button').click();
    expect(built.descend.textContent).toContain(t('gate.descendMark'));
    built.descend.querySelector('button').click();
    expect(descend).toHaveBeenCalledWith({ mark: true });
  });

  it('has one primary button, which is the way down', () => {
    const { built } = mount();
    const primary = Object.values(built).flatMap((node) => [
      ...(node.querySelectorAll?.('.btn--primary') ?? []),
    ]);
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toContain(t('gate.descend', { n: 1 }));
    expect(buttons(built).size).toBeGreaterThan(1);
  });
});
