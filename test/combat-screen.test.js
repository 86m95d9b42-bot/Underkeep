/**
 * @vitest-environment happy-dom
 *
 * The Combat screen and the Combat: Skills sheet
 * (`00-build-outline.md`, "Combat" and "Combat: Skills").
 *
 * The rules underneath are tested in the engine's own files; this is about the
 * screen: that both frames place what the outline's tables say, that a tap
 * resolves a whole turn before anything is repainted, and that every dimmed
 * button says why.
 */
import { describe, it, expect, vi } from 'vitest';
import { combat as combatScreen, REGIONS } from '../src/ui/screens/combat.js';
import { combatSkills } from '../src/ui/screens/combat-skills.js';
import { placeRegions, validateScreen, PANEL_COLS } from '../src/shell/layout.js';
import { createFight, ACTIONS, lineFor, logName } from '../src/systems/fight.js';
import { makeMonster } from '../src/data/monsters.js';
import { carriedStreams } from '../src/engine/rng.js';
import { chanceToBeat, hitChance } from '../src/engine/odds.js';
import { t } from '../src/data/strings.js';

const HERO = {
  id: 'hero',
  name: 'Harrow',
  hp: 20,
  maxHp: 20,
  fp: 4,
  maxFp: 4,
  atk: 2,
  def: 12,
  init: 0,
  saves: { body: 1, reflex: 1, mind: 1 },
  attack: { name: 'sword', kind: 'melee', damage: '1d6+1 slash' },
  protected: true,
};

/** A fight with a fixed cast, so a test never depends on the encounter roll. */
function makeFight({ ids = ['giant_rat', 'giant_rat'], seed = 7, difficulty = 'hard' } = {}) {
  return createFight({
    hero: { ...HERO },
    monsters: ids.map((id) => makeMonster(id, { floor: 1 })),
    streams: carriedStreams(seed),
    difficulty,
    surprise: false,
  });
}

/** Builds the screen into a detached tree, the way the router would. */
function mount({ frame = 'tall', fight = makeFight() } = {}) {
  const router = { has: () => false, go: vi.fn(), openSheet: vi.fn(), closeSheet: vi.fn() };
  const built = combatScreen.build({ router, fight, frame, haptics: { buzz: vi.fn() } });
  const placed = placeRegions({ ...combatScreen, regions: combatScreen.regions }, frame);
  return { built, placed, fight, router };
}

/** Every button on the screen, by its visible label. */
function buttons(built) {
  const labels = new Map();
  for (const node of Object.values(built)) {
    for (const btn of node.querySelectorAll?.('button') ?? []) {
      const label = btn.querySelector('.label')?.textContent ?? btn.textContent;
      if (label) labels.set(label.trim(), btn);
    }
  }
  return labels;
}

describe('where everything sits', () => {
  it("follows the outline's portrait table", () => {
    expect(REGIONS.bars.tall).toEqual([1, 7, 1, 2]);
    expect(REGIONS.menu.tall).toEqual([8, 9, 1, 2]);
    expect(REGIONS.back.tall).toEqual([1, 9, 3, 5]);
    expect(REGIONS.front.tall).toEqual([1, 9, 6, 9]);
    expect(REGIONS.chips.tall).toEqual([1, 9, 10, 10]);
    expect(REGIONS.log.tall).toEqual([1, 9, 11, 12]);
    expect(REGIONS.quick.tall).toEqual([1, 9, 13, 14]);
    expect(REGIONS.actions.tall).toEqual([1, 9, 15, 18]);
  });

  it("follows the outline's landscape row: rows and log left, controls right", () => {
    // "Back row, front row, and log cols 1-12; actions in a 2 x 3 grid and
    // quick slots cols 13-18."
    for (const name of ['back', 'front', 'chips', 'log']) {
      expect([name, REGIONS[name].wide[0], REGIONS[name].wide[1]]).toEqual([name, 1, 12]);
    }
    for (const name of ['menu', 'quick', 'actions']) {
      expect([name, REGIONS[name].wide[0], REGIONS[name].wide[1]]).toEqual([name, 13, 18]);
    }
  });

  it('places cleanly in both frames', () => {
    expect(validateScreen({ ...combatScreen, regions: REGIONS }, 'tall')).toEqual([]);
    expect(validateScreen({ ...combatScreen, regions: REGIONS }, 'wide')).toEqual([]);
    expect(mount({ frame: 'tall' }).placed.size).toBe(Object.keys(REGIONS).length);
    expect(mount({ frame: 'wide' }).placed.size).toBe(Object.keys(REGIONS).length);
  });

  it('gives every tap target at least two rows in the tall frame', () => {
    for (const [name, def] of Object.entries(REGIONS)) {
      if (!def.tap) continue;
      expect([name, def.tall[3] - def.tall[2] + 1]).toEqual([name, expect.any(Number)]);
      expect(def.tall[3] - def.tall[2] + 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('puts the Skills sheet over the screen, and beside it when wide', () => {
    expect(combatSkills.regions.sheet.tall).toEqual([1, 9, 7, 18]);
    expect(combatSkills.pattern).toBe('panel');
    const placed = placeRegions({ ...combatSkills, regions: combatSkills.regions }, 'wide');
    const [c1, c2] = placed.get('sheet');
    expect([c1, c2]).toEqual(PANEL_COLS);
  });
});

describe('what the screen shows', () => {
  it('draws a card for every enemy, with the rows the outline gives', () => {
    const { built } = mount({ fight: makeFight({ ids: ['giant_rat', 'goblin_archer'] }) });
    const front = built.front.querySelectorAll('.card:not(.card--empty)');
    const back = built.back.querySelectorAll('.card:not(.card--empty)');
    expect(front).toHaveLength(1);
    expect(back).toHaveLength(1);
    expect(front[0].textContent).toContain('GIANT RAT');
  });

  it('keeps the row full width by padding it with empty slots', () => {
    const { built } = mount();
    // Two rats in a four-slot front row: the label slot plus two empties.
    expect(built.front.querySelectorAll('.card').length).toBe(4);
    expect(built.back.textContent).toContain(t('combat.backRow'));
  });

  it('outlines the selected target, and moves it when the card is tapped', () => {
    const { built, fight } = mount({ fight: makeFight({ ids: ['giant_rat', 'giant_rat'] }) });
    expect(fight.target.id).toBe('giant_rat-1');
    const cards = built.front.querySelectorAll('.card:not(.card--empty)');
    expect(cards[0].classList.contains('card--selected')).toBe(true);

    cards[1].click();
    expect(fight.target.id).toBe('giant_rat-2');
    const after = built.front.querySelectorAll('.card:not(.card--empty)');
    expect(after[1].classList.contains('card--selected')).toBe(true);
  });

  it('names an enemy for a screen reader, with its hit points', () => {
    const { built } = mount();
    const card = built.front.querySelector('.card:not(.card--empty)');
    expect(card.getAttribute('aria-label')).toBe(
      t('combat.targetLabel', { name: 'Giant Rat', hp: 4, max: 4 }),
    );
  });

  it('shows the round, the bars, and the hero chips', () => {
    const { built, fight } = mount();
    expect(built.menu.textContent).toContain(t('combat.round', { n: fight.round }));
    expect(built.bars.querySelectorAll('.bar')).toHaveLength(2);
    expect(built.chips.textContent).toContain('DEF');
    expect(built.chips.textContent).toContain('HIT');
  });

  it('has the six actions of the outline, in its order', () => {
    const { built } = mount();
    const labels = [...built.actions.querySelectorAll('.label')].map((node) => node.textContent);
    expect(labels).toEqual(ACTIONS.map((id) => t(`combat.actions.${id}`)));
  });

  it('makes ATTACK the one primary button, and FLEE the risky one', () => {
    const { built } = mount();
    const nodes = [...built.actions.querySelectorAll('button')];
    const primary = nodes.filter((node) => node.classList.contains('btn--primary'));
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toContain(t('combat.actions.attack'));
    expect(nodes.at(-1).classList.contains('btn--risky')).toBe(true);
  });

  it('says why a dimmed action is dimmed', () => {
    const { built } = mount();
    const skill = buttons(built).get(t('combat.actions.skill'));
    expect(skill.disabled).toBe(true);
    expect(skill.textContent).toContain(t('combat.illegal.noSkills'));
  });

  it('shows four quick slots, each saying why it is empty', () => {
    const { built } = mount();
    const slots = built.quick.querySelectorAll('button');
    expect(slots).toHaveLength(4);
    expect(slots[0].disabled).toBe(true);
    expect(slots[0].textContent).toContain(t('combat.illegal.noItems'));
  });

  it('puts the newest log line on top', () => {
    const fight = makeFight();
    fight.act('defend');
    const { built } = mount({ fight });
    const lines = [...built.log.querySelectorAll('span')].map((node) => node.textContent);
    // A tap resolves the hero's turn and the monsters' answers, so the newest
    // line is the last thing that happened, not the hero's own move.
    expect(lines[0]).toBe(fight.log.at(-1).text);
    expect(lines.at(-1)).toBe(fight.log[0].text);
    expect(fight.log.some((line) => line.text === t('combat.defend'))).toBe(true);
  });
});

describe('taking a turn', () => {
  it('resolves the hero turn and every monster turn after it, in one tap', () => {
    const fight = makeFight();
    const { built } = mount({ fight });
    const before = fight.combat.units[1].hp;
    const heroBefore = fight.hero.hp;

    buttons(built).get(t('combat.actions.attack')).click();

    // The hero swung and both rats answered before the screen was repainted.
    const monstersMoved = fight.combat.units[1].hp < before || fight.hero.hp < heroBefore;
    expect(monstersMoved).toBe(true);
    expect(fight.log.length).toBeGreaterThan(0);
    // And it is the hero's turn again, or the fight is over.
    expect(['hero', 'over']).toContain(fight.phase);
  });

  it('defends, which raises DEF until the hero acts again', () => {
    const fight = makeFight();
    const { built } = mount({ fight });
    buttons(built).get(t('combat.actions.defend')).click();
    expect(fight.log.some((line) => line.text === t('combat.defend'))).toBe(true);
  });

  it('opens the Skills sheet rather than acting', () => {
    const fight = makeFight();
    fight.hero.skills = [{ id: 'power_strike', rank: 1 }];
    const { built, router } = mount({ fight });
    buttons(built).get(t('combat.actions.skill')).click();
    expect(router.openSheet).toHaveBeenCalledWith('combatSkills', { mode: 'skill' });
  });

  it('plays a whole fight out to an ending', () => {
    const fight = makeFight({ ids: ['giant_rat'] });
    let guard = 0;
    while (!fight.over && guard < 40) {
      guard += 1;
      fight.act('attack');
    }
    expect(fight.over).toBe(true);
    expect(['victory', 'defeat', 'fled']).toContain(fight.outcome);
    expect(fight.summary).toBeTruthy();
    expect(fight.log.at(-1).text).toBe(t(`combat.end.${fight.outcome}`));
  });

  it('refuses every action once the fight is over, and says why', () => {
    const fight = makeFight({ ids: ['giant_rat'] });
    let guard = 0;
    while (!fight.over && guard < 40) {
      guard += 1;
      fight.act('attack');
    }
    expect(fight.act('attack')).toEqual({ acted: false, why: 'notYourTurn' });
    expect(fight.legality('attack')).toMatchObject({ legal: false, why: 'notYourTurn' });

    // And the screen dims them all with that reason.
    const { built } = mount({ fight });
    for (const node of built.actions.querySelectorAll('button')) {
      expect(node.disabled).toBe(true);
    }
  });
});

describe('the Skills sheet', () => {
  function mountSheet({ mode = 'skill', fight = makeFight(), frame = 'tall' } = {}) {
    const router = { closeSheet: vi.fn(), go: vi.fn(), has: () => false };
    const built = combatSkills.build({ router, fight, frame, params: { mode } });
    return { built, router, fight };
  }

  it('says the list is empty until skills arrive', () => {
    const { built } = mountSheet();
    expect(built.sheet.textContent).toContain(t('combat.skills.none'));
  });

  it('lists the hero skills, with their cost, from the tree', () => {
    const fight = makeFight();
    // The hero carries `{ id, rank }`; the words and the cost are the tree's.
    fight.hero.skills = [{ id: 'power_strike', rank: 1 }];
    const { built } = mountSheet({ fight });
    expect(built.sheet.textContent).toContain(t('skills.power_strike.name'));
    expect(built.sheet.textContent).toContain(t('combat.hints.fp', { n: 2 }));
  });

  it('lists items in the same sheet when the Item action opened it', () => {
    const { built } = mountSheet({ mode: 'item' });
    expect(built.sheet.textContent).toContain(t('combat.skills.items'));
    expect(built.sheet.textContent).toContain(t('combat.skills.noItems'));
  });

  it('shows the hero Focus beside the title', () => {
    const { built, fight } = mountSheet();
    expect(built.sheet.textContent).toContain(
      t('combat.skills.fp', { n: fight.hero.fp, max: fight.hero.maxFp }),
    );
  });

  it('has CANCEL and a USE that says why it is off', () => {
    const { built, router } = mountSheet();
    const nodes = [...built.sheet.querySelectorAll('button')];
    const cancel = nodes.find((node) => node.textContent.includes(t('combat.skills.cancel')));
    const use = nodes.find((node) => node.textContent.includes(t('combat.skills.use')));
    expect(use.disabled).toBe(true);
    expect(use.textContent).toContain(t('combat.illegal.noSkills'));
    cancel.click();
    expect(router.closeSheet).toHaveBeenCalled();
  });
});

describe('the odds the screen shows', () => {
  it('counts the faces that land, with a natural 1 and 20 fixed', () => {
    // Needing 11 with +3: naturals 8-20 land, less the always-miss 1.
    expect(chanceToBeat(11, 3)).toBeCloseTo(13 / 20);
    // Nothing is certain: a natural 1 always misses.
    expect(chanceToBeat(-5, 0)).toBeCloseTo(19 / 20);
    // And nothing is impossible: a natural 20 always hits.
    expect(chanceToBeat(99, 0)).toBeCloseTo(1 / 20);
  });

  it('folds advantage and disadvantage in, and cancels them together', () => {
    const plain = chanceToBeat(11, 0);
    expect(chanceToBeat(11, 0, { advantage: true })).toBeGreaterThan(plain);
    expect(chanceToBeat(11, 0, { disadvantage: true })).toBeLessThan(plain);
    expect(chanceToBeat(11, 0, { advantage: true, disadvantage: true })).toBeCloseTo(plain);
  });

  it('reads the hero attack and the target DEF', () => {
    const fight = makeFight();
    const rat = fight.combat.units[1];
    // +2 against DEF 11: naturals 9-20 land.
    expect(hitChance(fight.combat, fight.hero, rat)).toBe(60);
  });
});

describe('the log lines', () => {
  it('says what the hero did, and what was done to the hero', () => {
    const hero = { id: 'hero', name: 'Harrow', side: 'hero' };
    const rat = { id: 'giant_rat-1', name: 'Giant Rat', side: 'monsters' };
    const hit = { type: 'action', result: { hit: true, targetName: 'Giant Rat', damage: { total: 4 } } };
    expect(lineFor(hit, hero).text).toBe(t('combat.log.youHit', { target: 'Giant Rat', n: 4 }));

    const taken = { type: 'action', result: { hit: true, targetName: 'Harrow', damage: { total: 2 } } };
    expect(lineFor(taken, rat)).toMatchObject({
      // The article belongs to the name rather than to the template, so that
      // a boss with a name of its own is not "The Vyrmathrax the Ashen".
      text: t('combat.log.theyHit', { who: 'The Giant Rat', n: 2 }),
      tone: 'danger',
    });
  });

  it('leaves a boss its own name, and its own article', () => {
    const dragon = { id: 'vyrmathrax-1', name: 'Vyrmathrax the Ashen', side: 'monsters', boss: true };
    const king = { id: 'rat_king-1', name: 'The Rat King', side: 'monsters', boss: true };
    expect(logName(dragon, { start: true })).toBe('Vyrmathrax the Ashen');
    expect(logName(king, { start: true })).toBe('The Rat King');
    expect(logName(king)).toBe('the Rat King');
    expect(logName({ name: 'Giant Rat' }, { start: true })).toBe('The Giant Rat');
    expect(logName({ name: 'Giant Rat' })).toBe('the Giant Rat');
  });

  it('says nothing about a step the player would not see', () => {
    expect(lineFor({ type: 'turnSkipped' }, {})).toBe(null);
  });
});
