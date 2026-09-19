/**
 * Zero HP, morale, fleeing and the end of a fight
 * (`06` sections 9, 14 and 15, with the row movement of section 13).
 */
import { describe, it, expect } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import {
  FALLEN,
  burn,
  fall,
  isFallen,
  monsterFlees,
  recoveryHp,
  tickFallen,
  zeroHp,
} from '../src/engine/defeat.js';
import {
  MORALE,
  canBreak,
  checkMorale,
  groupHalved,
  moraleOf,
  onHurt,
  onKill,
  stepForward,
} from '../src/engine/morale.js';
import { endCombat, fleeTn, heroFlees, outcomeOf, xpFrom } from '../src/engine/ending.js';
import { combatOver, runRound, startRound } from '../src/engine/round.js';
import { resolveAttack } from '../src/engine/attack.js';
import { takeTurn } from '../src/engine/turn.js';

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
  hp: 6,
  maxHp: 6,
  atk: 2,
  def: 11,
  hd: 1,
  xp: 10,
  morale: 7,
  row: 'front',
  ...extra,
});

function fight({ monsters = [monster('rat')], hero = {}, seed = 'ending' } = {}) {
  const hooks = createHooks();
  const rng = createStream(seed, 'combat');
  const combat = createCombat({ hero: heroTemplate(hero), monsters, rng, hooks, surprise: false });
  registerRules(combat);
  combat.round = 1;
  return combat;
}

/** Fixes the 2d6 morale roll and the d20. */
function fixRolls(combat, { morale, d20 } = {}) {
  if (morale !== undefined) combat.rng.roll = () => morale;
  if (d20 !== undefined) combat.rng.d20 = () => d20;
}

describe('zero HP (06 section 9)', () => {
  it('takes a monster out of the fight when nothing catches it', () => {
    const combat = fight();
    const rat = combat.units[1];
    rat.hp = 0;
    expect(zeroHp(combat, rat)).toMatchObject({ died: true });
    expect(rat.alive).toBe(false);
  });

  it('asks the traits first, in the order 06 section 16 lists them', () => {
    const combat = fight();
    const asked = [];
    for (const name of ['relentless', 'ferocity', 'undying']) {
      combat.hooks.on('zeroHP', () => asked.push(name), { name });
    }
    const rat = combat.units[1];
    rat.hp = 0;
    zeroHp(combat, rat);
    expect(asked).toEqual(['undying', 'ferocity', 'relentless']);
  });

  it("puts the hero back on their feet at half HP when Undying catches them", () => {
    const combat = fight({ hero: { hp: 0 } });
    combat.hooks.on('zeroHP', (payload) => {
      payload.saved = true;
      payload.savedBy = 'undying';
    }, { name: 'undying' });
    expect(zeroHp(combat, combat.hero)).toMatchObject({ saved: true, savedBy: 'undying' });
    expect(combat.hero.hp).toBe(10);
    expect(combat.hero.alive).toBe(true);
  });

  it('lets a trait hold a monster at the hit point it names, as Ferocity does', () => {
    const combat = fight();
    const rat = combat.units[1];
    rat.hp = 0;
    combat.hooks.on('zeroHP', (payload) => {
      payload.saved = true;
      payload.savedBy = 'ferocity';
      payload.unit.hp = 1;
    }, { name: 'ferocity' });
    zeroHp(combat, rat);
    expect(rat.hp).toBe(1);
  });

  it('marks the hero defeated, which ends the fight', () => {
    const combat = fight();
    combat.hero.hp = 0;
    zeroHp(combat, combat.hero);
    expect(combat.hero.defeated).toBe(true);
    expect(combatOver(combat)).toBe(true);
    expect(outcomeOf(combat)).toBe('defeat');
  });

  it('recovers to half of maximum, never to nothing', () => {
    expect(recoveryHp({ maxHp: 21 })).toBe(10);
    expect(recoveryHp({ maxHp: 1 })).toBe(1);
  });
});

describe('a Fallen troll', () => {
  it('goes down without dying, and keeps the fight open', () => {
    const combat = fight({ monsters: [monster('troll', { hp: 0 })] });
    const troll = combat.units[1];
    combat.hooks.on('zeroHP', (payload) => {
      payload.fallen = true;
    }, { name: 'wontStayDown' });

    expect(zeroHp(combat, troll)).toMatchObject({ fallen: true });
    expect(troll.alive).toBe(false);
    expect(isFallen(troll)).toBe(true);
    // 06 section 15: the combat does not end while an unburned troll lies there.
    expect(combatOver(combat)).toBe(false);
  });

  it('rises after three rounds with 10 HP', () => {
    const combat = fight({ monsters: [monster('troll')] });
    const troll = combat.units[1];
    fall(troll);
    for (let i = 0; i < FALLEN.rounds - 1; i += 1) {
      expect(tickFallen(combat)).toEqual([]);
    }
    expect(tickFallen(combat)).toEqual([troll]);
    expect(troll).toMatchObject({ alive: true, hp: FALLEN.hp, fallen: null });
  });

  it('counts down on the round, through the roundStart hook', () => {
    const combat = fight({ monsters: [monster('troll')] });
    const troll = combat.units[1];
    fall(troll);
    startRound(combat);
    expect(troll.fallen.rounds).toBe(FALLEN.rounds - 1);
  });

  it('is finished for good by fire or holy damage, and by nothing else', () => {
    const combat = fight({ monsters: [monster('troll')] });
    const troll = combat.units[1];
    fall(troll);
    expect(burn(troll, ['slash', 'pierce'])).toBe(false);
    expect(burn(troll, ['fire'])).toBe(true);
    expect(isFallen(troll)).toBe(false);
    expect(combatOver(combat)).toBe(true);
  });

  it('can still be hit while it lies there, which is the only way to burn it', () => {
    const combat = fight({ monsters: [monster('troll')] });
    const troll = combat.units[1];
    fall(troll);
    fixRolls(combat, { d20: 18 });
    const result = resolveAttack(combat, combat.hero, {
      target: 'troll-1',
      damage: '1d6 fire',
    });
    expect(result.hit).toBe(true);
    expect(troll.burned).toBe(true);
  });
});

describe('morale (06 section 9)', () => {
  it('never shakes the mindless or the fearless', () => {
    expect(moraleOf({ morale: '—' })).toBe(null);
    expect(canBreak({ morale: '—', alive: true })).toBe(false);
    expect(canBreak({ morale: MORALE.fearless, alive: true })).toBe(false);
    expect(canBreak({ morale: 7, alive: true })).toBe(true);
  });

  it('breaks on 2d6 over the monster Morale, and holds on equal', () => {
    const combat = fight();
    const rat = combat.units[1];
    fixRolls(combat, { morale: 8 });
    expect(checkMorale(combat, rat, 'hurt')).toMatchObject({ roll: 8, flees: true });

    const other = fight().units[1];
    const second = fight();
    fixRolls(second, { morale: 7 });
    expect(checkMorale(second, second.units[1], 'hurt').flees).toBe(false);
    expect(other.fleeing).toBeUndefined();
  });

  it('rolls each trigger at most once per monster', () => {
    const combat = fight();
    fixRolls(combat, { morale: 2 });
    expect(checkMorale(combat, combat.units[1], 'hurt')).not.toBe(null);
    expect(checkMorale(combat, combat.units[1], 'hurt')).toBe(null);
    // A different fright still gets its roll.
    expect(checkMorale(combat, combat.units[1], 'leaderDead')).not.toBe(null);
  });

  it('checks when the group falls to half or fewer', () => {
    const combat = fight({ monsters: [monster('rat'), monster('rat'), monster('rat'), monster('rat')] });
    expect(groupHalved(combat)).toBe(false);
    combat.units[1].alive = false;
    combat.units[2].alive = false;
    expect(groupHalved(combat)).toBe(true);

    fixRolls(combat, { morale: 12 });
    const checks = onKill(combat, combat.units[2]);
    expect(checks.map((check) => check.unit)).toEqual(['rat-3', 'rat-4']);
    expect(checks.every((check) => check.flees)).toBe(true);
  });

  it('does not count summons toward the group thinning', () => {
    const combat = fight({ monsters: [monster('rat'), monster('rat')] });
    combat.startingGroupSize = 2;
    combat.units[1].alive = false;
    const summon = monster('rat', { summoned: true });
    combat.units.push({ ...summon, id: 'rat-3', side: 'monsters', alive: true, seq: 9 });
    expect(groupHalved(combat)).toBe(true);
  });

  it('checks when a leader dies', () => {
    // Four monsters, so the group is not halved as well: this is the leader's
    // own fright, on its own.
    const combat = fight({
      monsters: [
        monster('kobold', { id: 'chief' }),
        monster('kobold', { leader: 'chief' }),
        monster('kobold'),
        monster('kobold'),
      ],
    });
    fixRolls(combat, { morale: 12 });
    combat.units[1].alive = false;
    const checks = onKill(combat, combat.units[1]);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ unit: 'kobold-2', trigger: 'leaderDead', flees: true });
  });

  it('rolls only once for a monster that two frights reach at the same moment', () => {
    const combat = fight({ monsters: [monster('kobold', { id: 'chief' }), monster('kobold', { leader: 'chief' })] });
    fixRolls(combat, { morale: 12 });
    combat.units[1].alive = false;
    // The group is halved and the leader is dead, but the survivor breaks once.
    expect(onKill(combat, combat.units[1])).toHaveLength(1);
  });

  it('checks when a monster drops below a quarter of its hit points', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 8, maxHp: 8 })] });
    const rat = combat.units[1];
    fixRolls(combat, { morale: 12 });
    rat.hp = 3;
    expect(onHurt(combat, rat)).toBe(null);
    rat.hp = 2;
    expect(onHurt(combat, rat)).toMatchObject({ trigger: 'hurt', flees: true });
  });

  it('breaks a monster through the damage, without the damage rules knowing', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 8, maxHp: 8 })] });
    const rat = combat.units[1];
    fixRolls(combat, { morale: 12, d20: 18 });
    resolveAttack(combat, combat.hero, { target: 'rat-1', damage: '1d6+4 slash' });
    expect(rat.fleeing).toBe(true);
  });

  it('leaves on its next turn, dropping half its gold', () => {
    const combat = fight({ monsters: [monster('kobold', { gold: 9, fleeing: true })] });
    const record = takeTurn(combat, combat.units[1], {});
    expect(record.steps[0]).toMatchObject({ type: 'fled', gold: 4 });
    expect(combat.droppedGold).toBe(4);
    expect(combatOver(combat)).toBe(true);
  });

  it('gives no XP for a monster that ran', () => {
    const combat = fight({ monsters: [monster('kobold', { gold: 9, fleeing: true })] });
    monsterFlees(combat, combat.units[1]);
    expect(xpFrom(combat).xp).toBe(0);
  });
});

describe('the row behind a death (06 sections 8 and 13)', () => {
  it('steps the back row forward once the front row is empty', () => {
    const combat = fight({ monsters: [monster('rat'), monster('archer', { row: 'back' })] });
    const archer = combat.units[2];
    expect(stepForward(combat)).toEqual([]);
    combat.units[1].alive = false;
    expect(stepForward(combat)).toEqual([archer]);
    expect(archer).toMatchObject({ row: 'front', slot: 0 });
  });

  it('never moves an anchored unit', () => {
    const combat = fight({
      monsters: [monster('rat'), monster('phylactery', { row: 'back', anchored: true, object: true })],
    });
    combat.units[1].alive = false;
    expect(stepForward(combat)).toEqual([]);
    expect(combat.units[2].row).toBe('back');
  });

  it('happens on the kill, with no one having to ask', () => {
    const combat = fight({ monsters: [monster('rat', { hp: 1, maxHp: 1 }), monster('archer', { row: 'back' })] });
    fixRolls(combat, { morale: 2, d20: 18 });
    resolveAttack(combat, combat.hero, { target: 'rat-1', damage: '1d6+4 slash' });
    expect(combat.units[2].row).toBe('front');
  });
});

describe('the hero flees (06 section 14)', () => {
  it('rolls against 10 plus the living enemies', () => {
    const combat = fight({ monsters: [monster('rat'), monster('rat'), monster('rat')] });
    expect(fleeTn(combat)).toBe(13);
    combat.units[1].alive = false;
    expect(fleeTn(combat)).toBe(12);
  });

  it('ends the fight on a success, with no XP and no loot', () => {
    const combat = fight();
    fixRolls(combat, { d20: 15 });
    expect(heroFlees(combat, { bonus: 0 })).toMatchObject({ fled: true, tn: 11 });
    expect(combatOver(combat)).toBe(true);
    expect(endCombat(combat)).toMatchObject({ outcome: 'fled', xp: 0 });
  });

  it('costs a free attack from each of the two biggest enemies on a failure', () => {
    const combat = fight({
      monsters: [
        monster('rat', { hd: 1 }),
        monster('ogre', { hd: 4, damage: '1d8 crush' }),
        monster('kobold', { hd: 2 }),
      ],
    });
    fixRolls(combat, { d20: 2 });
    const result = heroFlees(combat, { bonus: 0 });
    expect(result.fled).toBe(false);
    expect(result.freeAttacks).toHaveLength(2);
    expect(result.freeAttacks.map((row) => row.attacker)).toEqual(['ogre-1', 'kobold-1']);
    // They still take their own turns later in the round.
    expect(combat.units.every((unit) => !unit.turn)).toBe(true);
  });

  it('is impossible against a boss, automatic escapes included', () => {
    const combat = fight();
    combat.boss = 'ratKing';
    expect(heroFlees(combat, { bonus: 99 })).toMatchObject({ fled: false, why: 'noEscape' });
    expect(heroFlees(combat, { automatic: true })).toMatchObject({ fled: false, why: 'noEscape' });
  });

  it('skips the roll for Smoke Bomb, Vanish and a Scroll of Teleport', () => {
    const combat = fight();
    combat.rng.d20 = () => {
      throw new Error('no roll should be made');
    };
    expect(heroFlees(combat, { automatic: true }).fled).toBe(true);
  });
});

describe('ending the fight (06 section 15)', () => {
  it('knows which of the three endings it is', () => {
    const won = fight();
    expect(outcomeOf(won)).toBe(null);
    won.units[1].alive = false;
    expect(outcomeOf(won)).toBe('victory');

    const lost = fight();
    lost.hero.alive = false;
    expect(outcomeOf(lost)).toBe('defeat');
  });

  it('counts the XP of every defeated monster', () => {
    const combat = fight({ monsters: [monster('rat', { xp: 10 }), monster('kobold', { xp: 15 })] });
    combat.units[1].alive = false;
    combat.units[2].alive = false;
    expect(xpFrom(combat)).toMatchObject({ xp: 25, from: ['rat-1', 'kobold-1'] });
  });

  it('pays for only the first four summons', () => {
    const combat = fight({ monsters: [monster('rat')] });
    for (let i = 0; i < 6; i += 1) {
      combat.units.push({
        id: `spawn-${i}`,
        side: 'monsters',
        summoned: true,
        alive: false,
        xp: 5,
        seq: 10 + i,
      });
    }
    combat.units[1].alive = false;
    expect(xpFrom(combat).xp).toBe(10 + 4 * 5);
  });

  it('clears what the fight leaves behind, and hands back a summary', () => {
    const combat = fight({ monsters: [monster('rat', { xp: 10, gold: 4 })] });
    const hero = combat.hero;
    hero.conditions.blinded = { rounds: 2 };
    hero.conditions.weakened = { rounds: null };
    combat.units[1].alive = false;
    combat.droppedGold = 4;

    const summary = endCombat(combat);
    expect(summary).toMatchObject({ outcome: 'victory', xp: 10, gold: 4, defeated: ['rat-1'] });
    // 06 section 10, After Combat: Weakened stays, everything else goes.
    expect(hero.conditions.blinded).toBeUndefined();
    expect(hero.conditions.weakened).toBeTruthy();
  });

  it('lets the loot and the healing hooks add to the summary', () => {
    const combat = fight();
    combat.units[1].alive = false;
    combat.hooks.on('combatEnd', (payload) => {
      payload.loot.push('short sword');
      payload.gold += 7;
    }, { name: 'loot' });
    combat.hooks.on('combatEnd', (payload) => {
      payload.healing += 3;
    }, { name: 'bloodstone' });
    expect(endCombat(combat)).toMatchObject({ loot: ['short sword'], gold: 7, healing: 3 });
  });

  it('saves after the fight, as the caller asks', () => {
    const combat = fight();
    combat.units[1].alive = false;
    let saved = null;
    endCombat(combat, { save: (c) => (saved = c.outcome) });
    expect(saved).toBe('victory');
  });
});

describe('a fight from start to finish', () => {
  it('runs rounds until nothing is standing, and ends in a victory', () => {
    const combat = fight({
      monsters: [monster('rat', { hp: 4, maxHp: 4, xp: 10 }), monster('rat', { hp: 4, maxHp: 4, xp: 10 })],
    });
    combat.round = null;
    fixRolls(combat, { morale: 2, d20: 19 });

    let guard = 0;
    while (!combat.over && guard < 20) {
      guard += 1;
      runRound(combat, {
        takeTurn: (c, unit) =>
          takeTurn(c, unit, {
            chooseAction: () => ({ id: 'attack', kind: 'melee', damage: '1d6+3 slash' }),
            script: () => ({ id: 'attack', kind: 'melee', damage: '1d4 pierce', target: 'hero' }),
            resolveAction: (fight_, attacker, action) => resolveAttack(fight_, attacker, action),
          }),
      });
    }

    expect(combat.over).toBe(true);
    expect(combat.units.filter((unit) => unit.side === 'monsters' && unit.alive)).toHaveLength(0);
    expect(endCombat(combat)).toMatchObject({ outcome: 'victory', xp: 20 });
    expect(guard).toBeLessThan(20);
  });
});
