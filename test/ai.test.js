/**
 * Monster AI (`06` section 11): the condition vocabulary, the first-true-rule
 * runner, the eight archetypes, and the difficulty settings.
 *
 * The last two groups transcribe scripts straight out of section 12 — the
 * Goblin Archer, the Grave Robber and the Bone Warden — because a vocabulary
 * that cannot run the document's own scripts is no use.
 */
import { describe, it, expect } from 'vitest';
import aiData from '../src/data/ai.json' with { type: 'json' };
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import {
  ARCHETYPES,
  DIFFICULTY,
  abilityOf,
  checkCondition,
  chooseAction,
  countOf,
  evaluate,
  heroCanBe,
  remember,
  scriptFor,
  spend,
} from '../src/engine/ai.js';
import { takeMonsterTurn } from '../src/engine/turn.js';
import { applyCondition } from '../src/engine/conditions.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  hp: 20,
  maxHp: 20,
  atk: 3,
  def: 12,
  protected: true,
  ...extra,
});
const monster = (type, extra = {}) => ({
  type,
  hp: 10,
  maxHp: 10,
  atk: 2,
  def: 11,
  morale: 7,
  row: 'front',
  attack: { damage: '1d4 pierce' },
  ...extra,
});

function fight({ monsters = [monster('rat')], hero = {}, difficulty = 'hard', seed = 'ai' } = {}) {
  const hooks = createHooks();
  const rng = createStream(seed, 'combat');
  const combat = createCombat({ hero: heroTemplate(hero), monsters, rng, hooks, surprise: false });
  registerRules(combat);
  combat.round = 1;
  // Hard follows the script every time, which is what most of these check.
  combat.difficulty = difficulty;
  return combat;
}

const context = (combat, unit) => ({ combat, unit, hero: combat.hero });

describe('the condition vocabulary (06 section 11)', () => {
  it('reads ready(X) and unused(X)', () => {
    const combat = fight({
      monsters: [
        monster('drake', {
          abilities: [
            { id: 'breath', recharges: true, ready: false },
            { id: 'roar', oncePerCombat: true },
          ],
        }),
      ],
    });
    const drake = combat.units[1];
    const where = context(combat, drake);
    expect(evaluate('ready(breath)', where)).toBe(false);
    drake.abilities[0].ready = true;
    expect(evaluate('ready(breath)', where)).toBe(true);
    expect(evaluate('unused(roar)', where)).toBe(true);
    spend(drake, 'roar');
    expect(evaluate('unused(roar)', where)).toBe(false);
  });

  it('reads every(N) off the round', () => {
    const combat = fight();
    const where = context(combat, combat.units[1]);
    combat.round = 2;
    expect(evaluate('every(3)', where)).toBe(false);
    combat.round = 3;
    expect(evaluate('every(3)', where)).toBe(true);
    // Round 0 is the surprise round, and is a multiple of nothing.
    combat.round = 0;
    expect(evaluate('every(3)', where)).toBe(false);
  });

  it('reads hp < P% and ally hp < P%', () => {
    const combat = fight({ monsters: [monster('ogre'), monster('imp')] });
    const [, ogre, imp] = combat.units;
    ogre.hp = 4;
    expect(evaluate('hp < 50%', context(combat, ogre))).toBe(true);
    expect(evaluate('hp < 50%', context(combat, imp))).toBe(false);
    expect(evaluate('ally hp < 50%', context(combat, imp))).toBe(true);
    expect(evaluate('ally hp < 50%', context(combat, ogre))).toBe(false);
  });

  it('counts a type however the document spells it', () => {
    const combat = fight({ monsters: [monster('giantRat'), monster('giantRat'), monster('kobold')] });
    expect(countOf(combat, 'Giant Rat')).toBe(2);
    expect(evaluate('count(Giant Rat) < 4', context(combat, combat.units[1]))).toBe(true);
    expect(evaluate('count(Giant Rat) >= 2', context(combat, combat.units[1]))).toBe(true);
    combat.units[1].alive = false;
    expect(countOf(combat, 'giant rat')).toBe(1);
  });

  it('asks what the hero has and lacks', () => {
    const combat = fight();
    const where = context(combat, combat.units[1]);
    expect(evaluate('hero has Paralyzed', where)).toBe(false);
    applyCondition(combat.hero, 'paralyzed', { dc: 12 });
    expect(evaluate('hero has Paralyzed', where)).toBe(true);
    expect(evaluate('hero lacks Paralyzed', where)).toBe(false);
    expect(evaluate('hero lacks Asleep', where)).toBe(true);
  });

  it('asks whether the hero can be caught at all', () => {
    const combat = fight();
    const where = context(combat, combat.units[1]);
    expect(evaluate('hero can be Asleep', where)).toBe(true);

    // Immune outright.
    combat.hero.immunities = ['asleep'];
    expect(evaluate('hero can be Asleep', where)).toBe(false);

    // Or inside the control-immunity window the hero just earned.
    combat.hero.immunities = [];
    combat.hero.controlImmunity = { stunned: 2 };
    expect(evaluate('hero can be Stunned', where)).toBe(false);
  });

  it('reads the row, the phase, and a thief holding gold', () => {
    const combat = fight({ monsters: [monster('archer', { row: 'back', phase: 2, stolenGold: 12 })] });
    const where = context(combat, combat.units[1]);
    expect(evaluate('in back row', where)).toBe(true);
    expect(evaluate('in front row', where)).toBe(false);
    expect(evaluate('phase = 2', where)).toBe(true);
    expect(evaluate('holding(gold)', where)).toBe(true);
  });

  it('draws chance(p) from the combat stream', () => {
    const combat = fight();
    combat.rng.chance = (probability) => probability >= 0.5;
    const where = context(combat, combat.units[1]);
    expect(evaluate('chance(0.5)', where)).toBe(true);
    expect(evaluate('chance(25%)', where)).toBe(false);
  });

  it('joins terms with and, or and not', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 2 })] });
    const where = context(combat, combat.units[1]);
    expect(evaluate('hp < 50% and count(rat) < 4', where)).toBe(true);
    expect(evaluate('hp > 50% and count(rat) < 4', where)).toBe(false);
    expect(evaluate('hp > 50% or count(rat) < 4', where)).toBe(true);
    expect(evaluate('not hp > 50%', where)).toBe(true);
    expect(evaluate('always', where)).toBe(true);
  });

  it('refuses a condition it does not know, so a typo cannot go quiet', () => {
    const combat = fight();
    expect(() => evaluate('morale is low', context(combat, combat.units[1]))).toThrow(/unknown AI condition/);
    expect(checkCondition('hp < 50%')).toBe(null);
    expect(checkCondition('hp is low')).toMatch(/unknown AI condition/);
  });

  it('reads every condition the shipped archetypes use', () => {
    for (const [name, archetype] of Object.entries(ARCHETYPES)) {
      if (name.startsWith('_')) continue;
      for (const rule of archetype.rules) {
        expect([rule.when, checkCondition(rule.when)]).toEqual([rule.when, null]);
      }
    }
  });
});

describe('the runner', () => {
  it('takes the first rule that is true and legal', () => {
    const combat = fight({
      monsters: [
        monster('ogre', {
          script: [
            { when: 'hp < 25%', do: 'flee' },
            { when: 'every(2)', do: 'defend' },
            { when: 'always', do: 'attack' },
          ],
        }),
      ],
    });
    const ogre = combat.units[1];
    combat.round = 2;
    expect(chooseAction(combat, ogre).id).toBe('defend');
    combat.round = 3;
    expect(chooseAction(combat, ogre).id).toBe('attack');
    ogre.hp = 1;
    expect(chooseAction(combat, ogre).id).toBe('flee');
  });

  it('passes over a rule whose action is illegal', () => {
    const combat = fight({
      monsters: [
        monster('imp', {
          script: [
            { when: 'always', do: 'flee' },
            { when: 'always', do: 'attack' },
          ],
        }),
      ],
    });
    // Nothing flees a boss fight, so the next rule takes the turn.
    combat.boss = 'ratKing';
    expect(chooseAction(combat, combat.units[1]).id).toBe('attack');
  });

  it('passes over an ability that is not ready, and takes it when it is', () => {
    const combat = fight({
      monsters: [
        monster('drake', {
          archetype: 'breather',
          abilities: [{ id: 'breath', role: 'breath', recharges: true, ready: false, damage: '2d6 fire' }],
        }),
      ],
    });
    const drake = combat.units[1];
    expect(chooseAction(combat, drake)).toMatchObject({ id: 'attack' });
    drake.abilities[0].ready = true;
    expect(chooseAction(combat, drake)).toMatchObject({ ability: 'breath', damage: '2d6 fire' });
  });

  it('falls back to an attack when nothing in the script applies', () => {
    const combat = fight({ monsters: [monster('rat', { script: [{ when: 'hp < 10%', do: 'flee' }] })] });
    expect(chooseAction(combat, combat.units[1]).id).toBe('attack');
  });

  it('waits when even the attack is illegal', () => {
    const combat = fight();
    const rat = combat.units[1];
    applyCondition(rat, 'webbed');
    expect(chooseAction(combat, rat)).toEqual({ id: 'wait' });
  });

  it('spends a used ability, which is what the recharge rolls are for', () => {
    const combat = fight({
      monsters: [
        monster('drake', {
          archetype: 'breather',
          abilities: [{ id: 'breath', role: 'breath', recharges: true, ready: true, damage: '2d6 fire' }],
        }),
      ],
    });
    const drake = combat.units[1];
    takeMonsterTurn(combat, drake, {
      script: (c, unit) => chooseAction(c, unit),
      resolveAction: () => ({ hit: true }),
    });
    expect(drake.abilities[0]).toMatchObject({ ready: false, used: true });
  });
});

describe("monsters don't waste abilities", () => {
  const sleeper = () =>
    fight({
      monsters: [
        monster('siren', {
          archetype: 'controller',
          abilities: [{ id: 'lullaby', role: 'control', control: 'asleep', action: 'skill' }],
        }),
      ],
    });

  it('reaches for a control ability the hero can take', () => {
    const combat = sleeper();
    expect(chooseAction(combat, combat.units[1])).toMatchObject({ ability: 'lullaby' });
  });

  it('leaves it alone against a hero who is immune', () => {
    const combat = sleeper();
    combat.hero.immunities = ['asleep'];
    expect(chooseAction(combat, combat.units[1]).id).toBe('attack');
  });

  it('leaves it alone inside a control-immunity window', () => {
    const combat = sleeper();
    combat.hero.controlImmunity = { asleep: 2 };
    expect(chooseAction(combat, combat.units[1]).id).toBe('attack');
  });

  it('remembers an immunity it has learned, for the rest of the fight', () => {
    const combat = sleeper();
    const siren = combat.units[1];
    remember(siren, 'asleep');
    expect(heroCanBe(siren, combat.hero, 'asleep')).toBe(false);
    expect(chooseAction(combat, siren).id).toBe('attack');
  });

  it('tries anyway on Easy, which is what Easy means', () => {
    const combat = sleeper();
    combat.difficulty = 'easy';
    combat.rng.chance = () => false; // never slips, so the script decides
    combat.hero.immunities = ['asleep'];
    expect(chooseAction(combat, combat.units[1])).toMatchObject({ ability: 'lullaby' });
  });
});

describe('difficulty (06 section 11)', () => {
  it('is the three settings the document gives', () => {
    expect(DIFFICULTY.easy.slip).toBe(0.25);
    expect(DIFFICULTY.normal.slip).toBe(0.1);
    expect(DIFFICULTY.hard.slip).toBe(0);
    expect(DIFFICULTY.hard.eliteBonus).toBe(0.05);
    expect(aiData.difficulty.default).toBe('normal');
  });

  it('makes a monster forget its script on a slip', () => {
    const combat = fight({
      monsters: [monster('ogre', { script: [{ when: 'always', do: 'defend' }] })],
      difficulty: 'normal',
    });
    combat.rng.chance = () => true;
    expect(chooseAction(combat, combat.units[1])).toMatchObject({ id: 'attack', slipped: true });
    combat.rng.chance = () => false;
    expect(chooseAction(combat, combat.units[1]).id).toBe('defend');
  });

  it('never slips on Hard, and never asks the stream about it', () => {
    const combat = fight({
      monsters: [monster('ogre', { script: [{ when: 'always', do: 'defend' }] })],
      difficulty: 'hard',
    });
    combat.rng.chance = () => {
      throw new Error('Hard should not roll for a slip');
    };
    expect(chooseAction(combat, combat.units[1]).id).toBe('defend');
  });
});

describe('the archetypes (06 section 11)', () => {
  it('are the eight the document lists', () => {
    expect(Object.keys(ARCHETYPES).filter((name) => !name.startsWith('_'))).toEqual([
      'brute',
      'controller',
      'archer',
      'caster',
      'support',
      'thief',
      'breather',
      'boss',
    ]);
  });

  it('gives a monster with no script of its own its archetype rules', () => {
    expect(scriptFor({ archetype: 'brute' })).toEqual(ARCHETYPES.brute.rules);
    expect(scriptFor({ script: [{ when: 'always', do: 'wait' }] })[0].do).toBe('wait');
    // Anything unrecognised just swings.
    expect(scriptFor({ archetype: 'wanderer' })).toEqual(ARCHETYPES.brute.rules);
  });

  it('Brute attacks', () => {
    const combat = fight({ monsters: [monster('rat', { archetype: 'brute' })] });
    expect(chooseAction(combat, combat.units[1]).id).toBe('attack');
  });

  it('Archer shoots from the back and knifes from the front', () => {
    const combat = fight({
      monsters: [
        monster('rat'),
        monster('archer', {
          row: 'back',
          archetype: 'archer',
          abilities: [
            { id: 'shoot', role: 'ranged', kind: 'ranged', damage: '1d6 pierce' },
            { id: 'knife', role: 'melee', kind: 'melee', bonus: -2, damage: '1d4 slash' },
          ],
        }),
      ],
    });
    const archer = combat.units[2];
    expect(chooseAction(combat, archer)).toMatchObject({ ability: 'shoot' });
    archer.row = 'front';
    expect(chooseAction(combat, archer)).toMatchObject({ ability: 'knife', bonus: -2 });
  });

  it('Caster reaches for the strongest spell, and for cover when hurt', () => {
    const combat = fight({
      monsters: [
        monster('cultist', {
          archetype: 'caster',
          abilities: [
            { id: 'spark', role: 'spell', power: 1, action: 'skill', kind: 'spell' },
            { id: 'firebolt', role: 'spell', power: 3, action: 'skill', kind: 'spell' },
            { id: 'ward', role: 'defensive', action: 'skill' },
          ],
        }),
      ],
    });
    const cultist = combat.units[1];
    expect(chooseAction(combat, cultist)).toMatchObject({ ability: 'firebolt' });
    cultist.hp = 4;
    expect(chooseAction(combat, cultist)).toMatchObject({ ability: 'ward' });
  });

  it('Support heals a hurt ally first', () => {
    const combat = fight({
      monsters: [
        monster('acolyte', {
          archetype: 'support',
          abilities: [
            { id: 'mend', role: 'heal', action: 'skill' },
            { id: 'bless', role: 'buff', action: 'skill' },
          ],
        }),
        monster('ogre'),
      ],
    });
    const acolyte = combat.units[1];
    expect(chooseAction(combat, acolyte)).toMatchObject({ ability: 'bless' });
    combat.units[2].hp = 2;
    expect(chooseAction(combat, acolyte)).toMatchObject({ ability: 'mend' });
  });

  it('Thief runs once it is holding gold', () => {
    const combat = fight({ monsters: [monster('robber', { archetype: 'thief' })] });
    const robber = combat.units[1];
    expect(chooseAction(combat, robber).id).toBe('attack');
    robber.stolenGold = 20;
    expect(chooseAction(combat, robber).id).toBe('flee');
  });

  it('Boss takes its scheduled ability when the round comes round', () => {
    const combat = fight({
      monsters: [
        monster('warden', {
          archetype: 'boss',
          abilities: [
            { id: 'towerShield', when: 'every(3)', action: 'defend' },
            { id: 'smash', phase: 1, power: 2, damage: '2d6 crush' },
          ],
        }),
      ],
    });
    const warden = combat.units[1];
    combat.round = 3;
    expect(chooseAction(combat, warden)).toMatchObject({ ability: 'towerShield' });
    combat.round = 4;
    expect(chooseAction(combat, warden)).toMatchObject({ ability: 'smash' });
  });
});

describe("the document's own scripts (06 section 12)", () => {
  it('runs the Goblin Archer, rule for rule', () => {
    const combat = fight({
      monsters: [
        monster('goblinArcher', {
          row: 'back',
          archetype: 'archer',
          script: [
            { when: 'unused(volley) and count(Goblin Archer) >= 2', do: 'volley' },
            { when: 'in front row', do: 'knife' },
            { when: 'always', do: 'shoot' },
          ],
          abilities: [
            { id: 'volley', oncePerCombat: true, bonus: 2, kind: 'ranged' },
            { id: 'knife', kind: 'melee', bonus: -2 },
            { id: 'shoot', kind: 'ranged' },
          ],
        }),
        monster('rat'),
      ],
    });
    const archer = combat.units[1];

    // One archer: no Volley, and it shoots from the back row.
    expect(chooseAction(combat, archer)).toMatchObject({ ability: 'shoot' });

    // A second archer makes the Volley worth it.
    const second = { ...archer, id: 'goblinArcher-2', slot: 1, seq: 9 };
    combat.units.push(second);
    expect(chooseAction(combat, archer)).toMatchObject({ ability: 'volley', bonus: 2 });

    // Once it has been used, and once the archer is dragged forward, the knife.
    spend(archer, 'volley');
    archer.row = 'front';
    expect(chooseAction(combat, archer)).toMatchObject({ ability: 'knife', bonus: -2 });
  });

  it('runs the Rat King: Call the Swarm every third round while the swarm is thin', () => {
    const combat = fight({
      monsters: [
        monster('ratKing', {
          row: 'back',
          archetype: 'boss',
          script: [
            { when: 'every(3) and count(Giant Rat) < 4', do: 'callTheSwarm' },
            { when: 'in back row', do: 'wait' },
            { when: 'always', do: 'attack' },
          ],
          abilities: [{ id: 'callTheSwarm', action: 'skill' }],
        }),
        monster('giantRat'),
      ],
    });
    const king = combat.units[1];

    combat.round = 3;
    expect(chooseAction(combat, king)).toMatchObject({ ability: 'callTheSwarm' });
    combat.round = 4;
    // Not its round, and it is hiding in the swarm: it waits.
    expect(chooseAction(combat, king).id).toBe('wait');
    king.row = 'front';
    expect(chooseAction(combat, king).id).toBe('attack');
  });

  it('runs the Bone Warden, whose first rule is a once-only rescue', () => {
    const combat = fight({
      monsters: [
        monster('boneWarden', {
          hp: 40,
          maxHp: 40,
          archetype: 'boss',
          script: [
            { when: 'hp < 50% and unused(raise)', do: 'raise' },
            { when: 'every(4)', do: 'graveCleave' },
            { when: 'every(3)', do: 'towerShield' },
            { when: 'always', do: 'attack' },
          ],
          abilities: [
            { id: 'raise', oncePerCombat: true, action: 'skill' },
            { id: 'graveCleave', telegraph: true },
            { id: 'towerShield', action: 'defend' },
          ],
        }),
      ],
    });
    const warden = combat.units[1];

    combat.round = 1;
    expect(chooseAction(combat, warden).id).toBe('attack');

    combat.round = 4;
    expect(chooseAction(combat, warden)).toMatchObject({ id: 'telegraph', ability: 'graveCleave' });

    combat.round = 3;
    expect(chooseAction(combat, warden)).toMatchObject({ ability: 'towerShield' });

    warden.hp = 10;
    expect(chooseAction(combat, warden)).toMatchObject({ ability: 'raise' });
    spend(warden, 'raise');
    expect(chooseAction(combat, warden)).toMatchObject({ ability: 'towerShield' });
  });

  it('winds a telegraph up through the turn, instead of swinging it', () => {
    const combat = fight({
      monsters: [
        monster('warden', {
          script: [{ when: 'always', do: 'graveCleave' }],
          abilities: [{ id: 'graveCleave', telegraph: true }],
        }),
      ],
    });
    const warden = combat.units[1];
    const record = takeMonsterTurn(combat, warden, {
      script: (c, unit) => chooseAction(c, unit),
      resolveAction: () => {
        throw new Error('a wind-up resolves nothing');
      },
    });
    expect(record.steps.map((entry) => entry.type)).toContain('telegraph');
    expect(warden.telegraph).toMatchObject({ ability: 'graveCleave' });
  });
});

describe('abilities', () => {
  it('are found by id or by name, however they are spelled', () => {
    const unit = { abilities: [{ id: 'callTheSwarm', name: 'Call the Swarm' }] };
    expect(abilityOf(unit, 'Call the Swarm')?.id).toBe('callTheSwarm');
    expect(abilityOf(unit, 'calltheswarm')?.id).toBe('callTheSwarm');
    expect(abilityOf(unit, 'bite')).toBeUndefined();
  });
});
