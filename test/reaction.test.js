/**
 * @vitest-environment happy-dom
 *
 * The Reaction prompt (`06` section 17): with the setting on Ask, a hit that
 * Lucky or Arcane Shield could meet stops the fight and asks; the answer
 * plays the turn out again from where it began, drawing the same numbers.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildHero } from '../tools/lib/builds.js';
import { createFight } from '../src/systems/fight.js';
import { bossOnFloor } from '../src/data/bosses.js';
import { createStream } from '../src/engine/rng.js';
import { createSession } from '../src/systems/session.js';
import { restoreSession, takeSnapshot } from '../src/save/snapshot.js';
import { decode, encode } from '../src/save/codec.js';
import { reaction } from '../src/ui/screens/reaction.js';
import { validateScreen } from '../src/shell/layout.js';

/** A boss fight for a build that has Arcane Shield or Lucky by then. */
function fightFor({ build = 'battle_mage', floor = 6, seed = 3, reactions = 'ask' } = {}) {
  const hero = buildHero(build, { floor, seed });
  hero.maxHp *= 3;
  hero.hp = hero.maxHp;
  return createFight({ hero, boss: bossOnFloor(floor), floor, masterSeed: seed, reactions, logKept: 1000 });
}

/** Plays a fight out: the hero swings, and `answer` meets every prompt. */
function playOut(fight, answer = () => 'take') {
  const seen = [];
  for (let guard = 0; guard < 600 && !fight.over; guard += 1) {
    if (fight.reaction) {
      seen.push(fight.reaction);
      fight.react(answer(fight.reaction, fight));
      continue;
    }
    fight.act('attack');
  }
  return seen;
}

const lines = (fight) => fight.log.map((line) => line.text).join('\n');

describe('the prompt setting (06 section 17)', () => {
  it('asks, and taking every hit plays out exactly as Never would', () => {
    let asked = 0;
    for (const [build, floor] of [['battle_mage', 6], ['assassin', 9], ['wanderer', 5]]) {
      const never = fightFor({ build, floor, reactions: 'never' });
      const ask = fightFor({ build, floor, reactions: 'ask' });
      playOut(never);
      asked += playOut(ask, () => 'take').length;
      expect(lines(ask)).toBe(lines(never));
      expect(ask.outcome).toBe(never.outcome);
    }
    expect(asked).toBeGreaterThan(0);
  });

  it('plays Auto when no setting is given, as the tools do', () => {
    const hero = buildHero('battle_mage', { floor: 6, seed: 3 });
    hero.maxHp *= 3;
    hero.hp = hero.maxHp;
    const fight = createFight({ hero, boss: bossOnFloor(6), floor: 6, masterSeed: 3 });
    expect(fight.reactions).toBe('auto');
    expect(playOut(fight)).toEqual([]);
  });

  it('can be changed in the middle of a fight', () => {
    const fight = fightFor({ reactions: 'never' });
    fight.reactions = 'ask';
    expect(fight.reactions).toBe('ask');
    fight.reactions = 'sometimes';
    expect(fight.reactions).toBe('ask');
  });
});

describe('what the prompt says', () => {
  it('names who struck, the roll against DEF, the damage, and what can meet it', () => {
    const fight = fightFor();
    while (!fight.over && !fight.reaction) fight.act('attack');
    const prompt = fight.reaction;
    expect(prompt).toMatchObject({ key: expect.stringMatching(/^r\d+$/), attacker: expect.any(String) });
    expect(prompt.total).toBeGreaterThanOrEqual(prompt.def);
    expect(prompt.options.every((id) => ['arcaneShield', 'lucky'].includes(id))).toBe(true);
    // The damage it shows is the damage the hit then does.
    const dealt = [];
    fight.combat.hooks.on('damageTaken', (payload) => {
      if (payload.target === fight.combat.hero) dealt.push(payload.amount);
    }, { name: 'probe', source: 'probe' });
    fight.react('take');
    expect(dealt).toContain(prompt.damage);
  });

  it('waits: the hero cannot act while a hit is waiting on them', () => {
    const fight = fightFor();
    while (!fight.over && !fight.reaction) fight.act('attack');
    expect(fight.act('attack')).toEqual({ acted: false, why: 'notYourTurn' });
    expect(fight.react('fireball')).toEqual({ acted: false, why: 'notReady' });
  });
});

describe('the answers', () => {
  it('Arcane Shield turns the hit into a miss, for 2 FP', () => {
    const fight = fightFor();
    while (!fight.over && !(fight.reaction?.options.includes('arcaneShield'))) {
      if (fight.reaction) fight.react('take');
      else fight.act('attack');
    }
    const prompt = fight.reaction;
    const fp = fight.hero.fp;
    const missed = [];
    fight.combat.hooks.on('miss', (payload) => {
      if (payload.target === fight.combat.hero && payload.attacker?.id === prompt.attacker) missed.push(payload);
    }, { name: 'probe', source: 'probe' });
    fight.react('arcaneShield');
    expect(missed.length).toBeGreaterThan(0);
    expect(fight.hero.fp).toBeLessThanOrEqual(fp - 2 + 1);
  });

  it('Lucky is spent once and never offered again that fight', () => {
    const fight = fightFor({ build: 'assassin', floor: 9 });
    const prompts = playOut(fight, (prompt) => (prompt.options.includes('lucky') ? 'lucky' : 'take'));
    const offeredLucky = prompts.filter((prompt) => prompt.options.includes('lucky'));
    expect(offeredLucky.length).toBe(1);
  });
});

describe('a prompt in the save (05 section 11)', () => {
  it('comes back as the same question, and answers the same way', () => {
    const hero = buildHero('battle_mage', { floor: 6, seed: 3 });
    hero.seed = 3;
    hero.maxHp *= 3;
    hero.hp = hero.maxHp;
    const session = createSession({ hero, seed: 3, reactions: () => 'ask' });
    session.descend({ floor: 1 });
    const fight = session.startBoss({ floor: 6 });
    while (!fight.over && !fight.reaction) fight.act('attack');
    const back = restoreSession(decode(encode(takeSnapshot(session))), { reactions: () => 'ask' });
    expect(back.fight.reaction).toEqual(fight.reaction);
    fight.react('take');
    back.fight.react('take');
    expect(back.fight.log.slice(-3)).toEqual(fight.log.slice(-3));
    expect(back.fight.hero.hp).toBe(fight.hero.hp);
  });
});

describe('a stream put back', () => {
  it('draws the same numbers again from a state it had', () => {
    const stream = createStream(42, 'combat');
    const state = stream.state();
    const first = [stream.d20(), stream.d20(), stream.d20()];
    stream.restore(state);
    expect([stream.d20(), stream.d20(), stream.d20()]).toEqual(first);
    expect(() => stream.restore([1, 2])).toThrow();
  });
});

describe('the Combat: Reaction sheet', () => {
  it('keeps to the grid, as a right-hand panel in wide', () => {
    expect(validateScreen(reaction, 'tall')).toEqual([]);
    expect(validateScreen(reaction, 'wide')).toEqual([]);
    expect(reaction.onBack()).toBe(true);
  });

  it('offers one button per reaction, then TAKE THE HIT, and answers through the fight', () => {
    const fight = fightFor();
    while (!fight.over && !fight.reaction) fight.act('attack');
    const router = { closeSheet: vi.fn(), render: vi.fn() };
    const settings = { all: { reactions: 'ask' }, set: vi.fn() };
    const built = reaction.build({ router, fight, settings });
    const text = built.sheet.textContent;
    expect(text).toMatch(/COMBAT PAUSED/);
    expect(text).toMatch(new RegExp(`strikes for ${fight.reaction.damage}\\.`));
    expect(text).toMatch(/TAKE THE HIT/);
    const labels = [...built.sheet.querySelectorAll('.reaction__buttons button')].map((b) => b.textContent);
    expect(labels).toHaveLength(fight.reaction.options.length + 1);
    // The shortcut sets what happens next time.
    [...built.sheet.querySelectorAll('.reaction__setting button')].find((b) => b.textContent === 'NEVER').click();
    expect(settings.set).toHaveBeenCalledWith('reactions', 'never');
    // Taking the hit plays the turn on.
    [...built.sheet.querySelectorAll('button')].find((b) => b.textContent.includes('TAKE THE HIT')).click();
    expect(fight.reaction?.key ?? null).not.toBe('r1');
  });
});
