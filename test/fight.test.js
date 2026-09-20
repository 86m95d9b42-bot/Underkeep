/**
 * The Phase 3 "done when": a fight against rats and kobolds runs start to
 * finish with the log matching the rules.
 *
 * `npm run fight` plays hundreds of these; this plays a handful on every test
 * run, and pins the parts of the log that a rule decides — who acted, what
 * landed, what fell, and what the fight was worth.
 */
import { describe, it, expect } from 'vitest';
import { playFight, RATS_AND_KOBOLDS, auditHero } from '../tools/lib/fighter.js';
import { createFight, standInHero } from '../src/systems/fight.js';
import { carriedStreams } from '../src/engine/rng.js';
import { makeMonster } from '../src/data/monsters.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { t } from '../src/data/strings.js';

/** A hero rolled the way a player rolls one. */
function makeHero() {
  return finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 11 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 },
        },
        'sellsword',
      ),
      'Harrow',
    ),
  );
}

/** Every line of a fight, as plain text. */
const text = (result) => result.log.map((line) => line.text);

describe('a fight against rats and kobolds', () => {
  it('runs start to finish, with a log that matches the rules', () => {
    const result = playFight({ seed: 20260918, monsters: RATS_AND_KOBOLDS });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(['victory', 'defeat', 'fled']).toContain(result.outcome);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
  });

  it('holds up over many seeds, and over both floors', () => {
    const problems = [];
    for (let seed = 1; seed <= 60; seed += 1) {
      const masterSeed = seed * 7919 + 13;
      for (const floor of [1, 2]) {
        const result = playFight({
          seed: masterSeed,
          monsters: seed % 2 === 0 ? RATS_AND_KOBOLDS : undefined,
          floor,
          // The hit points `01` section 4 will give a level 1 hero, so the
          // fights last long enough to reach the late-round rules.
          hp: 22,
        });
        if (!result.ok) problems.push(`floor ${floor} seed ${masterSeed}: ${result.problems.join('; ')}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never leaves a raw string key or an undefined in the log', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const result = playFight({ seed: seed * 31 + 7, floor: seed % 2 ? 1 : 2, hp: 22 });
      for (const line of text(result)) {
        expect(line).not.toMatch(/combat\.|undefined|NaN|\{\w+\}/);
      }
    }
  });

  it('ends with the line that says how it ended', () => {
    const result = playFight({ seed: 20260918, monsters: RATS_AND_KOBOLDS });
    expect(text(result).at(-1)).toBe(t(`combat.end.${result.outcome}`));
  });

  it('stamps every line with the round it was said in, in order', () => {
    const result = playFight({ seed: 4242, monsters: RATS_AND_KOBOLDS, hp: 22 });
    const rounds = result.log.map((line) => line.round);
    expect(rounds.every((round) => Number.isInteger(round))).toBe(true);
    // A round never starts again once it is over.
    for (let i = 1; i < rounds.length; i += 1) expect(rounds[i]).toBeGreaterThanOrEqual(rounds[i - 1]);
  });

  it('says what fell, once per monster that fell', () => {
    const wins = [];
    for (let seed = 1; seed <= 40 && wins.length < 3; seed += 1) {
      const result = playFight({ seed: seed * 977, monsters: RATS_AND_KOBOLDS, hp: 40 });
      if (result.outcome === 'victory') wins.push(result);
    }
    expect(wins.length).toBeGreaterThan(0);
    for (const win of wins) {
      const fell = text(win).filter((line) => / falls\.$/.test(line));
      const dead = win.summary.defeated.length;
      expect(fell.length).toBe(dead);
      // And the XP is what those monsters were worth: four of them, 10 each.
      expect(win.summary.xp).toBe(dead * 10);
    }
  });

  it('gives the hero a fall line of their own, and only the one', () => {
    const losses = [];
    for (let seed = 1; seed <= 20 && losses.length < 3; seed += 1) {
      const result = playFight({ seed: seed * 13, monsters: RATS_AND_KOBOLDS, hp: 6 });
      if (result.outcome === 'defeat') losses.push(result);
    }
    expect(losses.length).toBeGreaterThan(0);
    for (const loss of losses) {
      const lines = text(loss);
      expect(lines.at(-1)).toBe(t('combat.end.defeat'));
      // The hero's fall is the ending, not a death among the blows.
      expect(lines.filter((line) => line === t('combat.log.dies', { who: 'Harrow' }))).toEqual([]);
    }
  });
});

describe('the hero the fight is fought with', () => {
  it('is the run stand-in, with the numbers a level 1 hero has', () => {
    const hero = auditHero();
    expect(hero).toMatchObject({ atk: 2, def: 12, protected: true });
    expect(hero.attack.damage).toBe('1d6+1 slash');
  });

  it('is the run\u2019s own hero, not a copy of them', () => {
    // Everything a fight does happens to the person who walked in: the hit
    // points they lose, the experience they earn, the coin they pick up.
    const harrow = makeHero();
    harrow.hp = harrow.maxHp = 60;
    const fight = createFight({
      hero: standInHero(harrow),
      monsters: [makeMonster('kobold'), makeMonster('kobold')],
      streams: carriedStreams(3),
      surprise: false,
    });
    expect(fight.hero).toBe(harrow);
    expect(fight.combat.hero).toBe(harrow);

    fight.combat.rng.d20 = () => 19;
    for (let guard = 0; guard < 40 && !fight.over; guard += 1) fight.act('attack');
    expect(fight.outcome).toBe('victory');
    expect(harrow.xp).toBe(fight.summary.xp);
    expect(harrow.hp).toBeLessThanOrEqual(harrow.maxHp);
  });

  it('is paid the gold that fell, before the screen reports it', () => {
    // `06` section 15 step 4: the gold is the fight's loot, and it is banked
    // as combat ends rather than when a screen draws it.
    const harrow = makeHero();
    harrow.hp = harrow.maxHp = 60;
    const purse = harrow.gold ?? 0;
    const fight = createFight({
      hero: standInHero(harrow),
      monsters: [makeMonster('kobold'), makeMonster('kobold')],
      streams: carriedStreams(3),
      surprise: false,
    });
    fight.combat.rng.d20 = () => 19;
    for (let guard = 0; guard < 40 && !fight.over; guard += 1) fight.act('attack');
    expect(fight.summary.gold).toBeGreaterThan(0);
    expect(harrow.gold).toBe(purse + fight.summary.gold);
  });
});
