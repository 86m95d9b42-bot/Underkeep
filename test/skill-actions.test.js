/**
 * Using an active skill in a fight (`01` section 6 through `06` section 4).
 *
 * The skills themselves are data; these are the rules that turn one into an
 * action the engine resolves — and the promise that a skill no phase has
 * built yet is refused by name rather than silently doing nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  NOT_YET,
  actionForSkill,
  resolveHeal,
  resolveSkillAction,
  whyNotPlayable,
} from '../src/engine/skill-actions.js';
import { createFight, standInHero } from '../src/systems/fight.js';
import { makeMonster } from '../src/data/monsters.js';
import { carriedStreams } from '../src/engine/rng.js';
import { learn } from '../src/systems/skill-tree.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { skill, skillIds } from '../src/data/skills.js';
import { t } from '../src/data/strings.js';

/** A hero with room to learn whatever a test wants. */
function hero({ origin = 'sellsword', points = 6, learns = [] } = {}) {
  const made = finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 12, luck: 8 },
        },
        origin,
      ),
      'Harrow',
    ),
  );
  made.skillPoints = points;
  for (const id of learns) learn(made, id);
  return made;
}

/** A fight with one kobold in it, so a skill has something to aim at. */
function fightWith(who, monsters = ['kobold']) {
  return createFight({
    hero: standInHero(who),
    monsters: monsters.map((id) => makeMonster(id)),
    streams: carriedStreams(5),
    surprise: false,
  });
}

describe('turning a skill into an action', () => {
  it('swings the weapon the hero is holding', () => {
    const { action } = actionForSkill(hero({ learns: ['power_strike'] }), 'power_strike');
    expect(action).toMatchObject({ id: 'skill', skill: 'power_strike', fp: 2, kind: 'melee' });
    // `01` section 6: -2 to hit, and one extra die of the weapon's own damage.
    expect(action.attack.atkMod).toBe(-2);
    expect(action.attack.damage).toBe('1d8 slash');
    expect(action.attack.extraDice).toEqual(['1d8 slash']);
  });

  it('brings its own dice when the skill is a spell', () => {
    const { action } = actionForSkill(hero({ origin: 'apprentice' }), 'magic_missile');
    expect(action.kind).toBe('spell');
    expect(action.attack).toMatchObject({ damage: '1d4+1 force', autoHit: true });
  });

  it('carries the Path as a tag, so an Anti-Magic Field can silence it', () => {
    const { action } = actionForSkill(hero({ learns: ['mend'] }), 'mend');
    expect(action.tags).toContain('spirit');
  });

  it('says which phase a shape it cannot play is waiting for', () => {
    // Rows, buffs and cures are all played now; only the dungeon's own
    // skills wait, because a fight is not where they are used.
    expect(whyNotPlayable('sleep')).toBe(null);
    expect(whyNotPlayable('spirit_ward')).toBe(null);
    expect(whyNotPlayable('cleanse')).toBe(null);
    expect(whyNotPlayable('knock')).toBe(NOT_YET.opens);
    // A passive has no action at all.
    expect(whyNotPlayable('toughness')).toBe('notAnAction');
    // Every reason has a line for the button that is dimmed with it.
    for (const why of new Set([...Object.values(NOT_YET), 'notAnAction'])) {
      expect([why, typeof t(`combat.illegal.${why}`)]).toEqual([why, 'string']);
    }
  });

  it('answers for every skill in the tree, one way or the other', () => {
    // Nothing is silently dropped: each skill either builds an action or says
    // what it is waiting for, and a player is never left tapping a dead key.
    const who = hero();
    for (const id of skillIds()) {
      const built = actionForSkill(who, id);
      expect([id, Boolean(built.action) !== Boolean(built.why)]).toEqual([id, true]);
    }
  });
});

describe('a healing skill', () => {
  it('rolls its dice, adds its attribute, and never overfills', () => {
    const who = hero();
    who.hp = 1;
    const combat = { rng: { roll: () => 7 } };
    const healed = resolveHeal(combat, who, { dice: '2d6', addMod: 'wits' });
    // 7 rolled + the WIT modifier the hero has.
    expect(healed.rolled).toBe(7 + (who.mods?.wits ?? 0));
    expect(who.hp).toBe(Math.min(who.maxHp, 1 + healed.rolled));

    who.hp = who.maxHp;
    const wasted = resolveHeal(combat, who, { dice: '2d6' });
    expect(wasted.healed).toBe(0);
    expect(who.hp).toBe(who.maxHp);
  });

  it('can be a share of the maximum, as Second Wind is', () => {
    const who = hero();
    who.hp = 1;
    resolveHeal({ rng: { roll: () => 0 } }, who, { shareOfMaxHp: 0.25 });
    expect(who.hp).toBe(1 + Math.floor(who.maxHp * 0.25));
  });
});

describe('using one in a fight', () => {
  it('heals the hero and spends the Focus', () => {
    const who = hero({ learns: ['mend'] });
    who.hp = 5;
    const fight = fightWith(who);
    const fp = who.fp;

    expect(fight.legality('skill', { skill: 'mend' })).toEqual({ legal: true });
    expect(fight.act('skill', { skill: 'mend' })).toMatchObject({ acted: true });
    expect(who.hp).toBeGreaterThan(5);
    expect(who.fp).toBe(fp - skill('mend').fp);
    expect(fight.log.some((line) => line.text.includes(t('skills.mend.name')))).toBe(true);
  });

  it('refuses one there is no Focus for, and says so', () => {
    const who = hero({ learns: ['mend'] });
    who.fp = 0;
    const fight = fightWith(who);
    expect(fight.legality('skill', { skill: 'mend' })).toMatchObject({ why: 'notEnoughFp' });
    expect(fight.act('skill', { skill: 'mend' })).toMatchObject({ acted: false });
  });

  it('refuses a shape no phase has built, by name', () => {
    const who = hero({ learns: ['toughness'] });
    const fight = fightWith(who);
    expect(fight.legality('skill', { skill: 'toughness' })).toEqual({
      legal: false,
      why: 'notAnAction',
    });
    expect(fight.act('skill', { skill: 'toughness' })).toMatchObject({ acted: false });
  });

  it('attacks through every step of section 6, so it can hit and kill', () => {
    const who = hero({ learns: ['power_strike'] });
    const fight = fightWith(who);
    fight.combat.rng.d20 = () => 19;
    const before = fight.rowOf('front')[0]?.hp;
    fight.act('skill', { skill: 'power_strike' });
    const after = fight.combat.units[1];
    expect(after.hp).toBeLessThan(before);
  });

  it('is the same action whether the engine or the sheet asks for it', () => {
    const who = hero({ learns: ['mend'] });
    const direct = actionForSkill(who, 'mend');
    expect(direct.action.heal).toEqual(skill('mend').action.heal);
    expect(resolveSkillAction({ rng: { roll: () => 4 } }, who, direct.action)).toMatchObject({
      skill: 'mend',
    });
  });
});
