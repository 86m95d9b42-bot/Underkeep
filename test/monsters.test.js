/**
 * The monsters of floors 1 and 2, and their encounter tables
 * (`02` sections 4, 5 and 16).
 *
 * The first group checks the transcription against the document's own stat
 * blocks, number for number. The rest put each trait on the field and watch it
 * work, because a stat block that the engine ignores is just a table.
 */
import { describe, it, expect } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import { MONSTERS, goldFrom, makeMonster, monsterIds, monstersOnFloor, scale, statBlock } from '../src/data/monsters.js';
import { idsOnTable, lineFor, rollEncounter, tableFor } from '../src/data/encounters.js';
import { PENDING, TRAITS } from '../src/engine/monster-traits.js';
import { BOSS_TRAITS } from '../src/engine/boss-traits.js';
import { ELITE_TRAITS } from '../src/engine/elite-traits.js';
import { resolveAttack } from '../src/engine/attack.js';
import { applyRider, rollSave } from '../src/engine/riders.js';
import { chooseAction } from '../src/engine/ai.js';
import { takeMonsterTurn } from '../src/engine/turn.js';
import { endRound, runTurns, startRound } from '../src/engine/round.js';
import { applyCondition, has } from '../src/engine/conditions.js';
import { countedEnemies } from '../src/engine/field.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  hp: 20,
  maxHp: 20,
  atk: 3,
  def: 12,
  protected: true,
  saves: { body: 1, reflex: 1, mind: 1 },
  ...extra,
});

/** A fight with the engine's own rules registered, as the game registers them. */
function fight(ids, { hero = {}, floor = 1, seed = 'monsters' } = {}) {
  const hooks = createHooks();
  const rng = createStream(seed, 'combat');
  const combat = createCombat({
    hero: heroTemplate(hero),
    monsters: ids.map((id) => makeMonster(id, { floor })),
    rng,
    hooks,
    surprise: false,
  });
  registerRules(combat);
  combat.round = 1;
  combat.difficulty = 'hard';
  return combat;
}

/** Fixes the dice this test cares about. */
function fixRolls(combat, { d20, die, dice, roll } = {}) {
  if (d20 !== undefined) combat.rng.d20 = () => d20;
  if (die !== undefined) combat.rng.die = () => die;
  if (dice !== undefined) combat.rng.dice = (count) => count * dice;
  if (roll !== undefined) combat.rng.roll = () => roll;
}

/** Every floor the bestiary writes a table for (`02` sections 4 to 13). */
const FLOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('the stat blocks (02 sections 4 and 5)', () => {
  it('has the nine monsters of floors 1 and 2, and the Coin Imp', () => {
    expect(monstersOnFloor(1)).toEqual(['giant_rat', 'kobold', 'goblin_archer', 'green_slime']);
    expect(monstersOnFloor(2)).toEqual([
      'skeleton',
      'zombie',
      'cave_bat_swarm',
      'grave_robber',
      'ghoul',
    ]);
    expect(monsterIds()).toContain('coin_imp');
  });

  it('transcribes the Giant Rat', () => {
    const rat = makeMonster('giant_rat');
    expect(rat).toMatchObject({
      name: 'Giant Rat',
      hd: 1,
      hp: 4,
      maxHp: 4,
      atk: 2,
      def: 11,
      init: 2,
      row: 'front',
      morale: 6,
      xp: 10,
    });
    expect(rat.saves).toEqual({ body: 0, reflex: 1, mind: 0 });
    expect(rat.attack).toMatchObject({ damage: '1d4 pierce', kind: 'melee' });
    expect(statBlock('giant_rat').group).toEqual([2, 5]);
  });

  it('transcribes the Skeleton, resistances and all', () => {
    const skeleton = makeMonster('skeleton');
    expect(skeleton).toMatchObject({ hp: 10, atk: 3, def: 13, init: 0, xp: 20, morale: null });
    expect(skeleton.resistant).toEqual(['slash', 'pierce']);
    expect(skeleton.weak).toEqual(['crush', 'holy']);
    expect(skeleton.immune).toEqual(['poison', 'asleep', 'feared']);
    // The immunity list is a condition list too: a Skeleton cannot be put to sleep.
    expect(skeleton.immunities).toContain('asleep');
  });

  it('transcribes the Zombie, which always acts last', () => {
    const zombie = makeMonster('zombie');
    expect(zombie).toMatchObject({ hp: 16, atk: 2, def: 10, init: -3, actsLast: true });
    expect(zombie.attack.onHit).toMatchObject({ save: 'body', dc: 11, condition: 'grabbed' });
  });

  it('transcribes the Goblin Archer with its script out of 06 section 12', () => {
    const archer = makeMonster('goblin_archer');
    expect(archer).toMatchObject({ row: 'back', archetype: 'archer' });
    expect(archer.script.map((rule) => rule.do)).toEqual(['volley', 'knife', 'shoot']);
    expect(archer.abilities.find((ability) => ability.id === 'knife').bonus).toBe(-2);
    expect(archer.abilities.every((ability) => ability.ready)).toBe(true);
  });

  it('gives every floor the monsters 02 lists for it', () => {
    expect(monstersOnFloor(3)).toEqual(
      expect.arrayContaining(['orc', 'goblin_shaman', 'worg', 'hobgoblin_captain']),
    );
    expect(monstersOnFloor(4)).toEqual([
      'shrieker',
      'myconid_sporecaller',
      'giant_spider',
      'rot_crawler',
    ]);
    expect(monstersOnFloor(6)).toEqual(
      expect.arrayContaining(['cultist', 'zealot', 'gargoyle', 'ember_hound']),
    );
    expect(monstersOnFloor(9)).toEqual(['troll', 'rime_wolf', 'frozen_revenant', 'frost_giant']);
    expect(monstersOnFloor(10)).toEqual(
      expect.arrayContaining(['drake', 'ashbound_knight', 'basilisk']),
    );
    // 31 more than floors 1 and 2's nine, plus the two rare wanderers of
    // `02` section 14.
    expect(monsterIds()).toHaveLength(42);
    expect(monsterIds()).toContain('hollow_stalker');
  });

  it('transcribes the deeper floors, row by row of 02', () => {
    // One line of each floor's table, read straight off the document.
    const rows = [
      ['orc', { hd: 3, hp: 15, atk: 4, def: 13, init: 0, xp: 30 }],
      ['hobgoblin_captain', { hd: 4, hp: 24, atk: 5, def: 16, init: 0, xp: 60 }],
      ['giant_spider', { hd: 4, hp: 22, atk: 5, def: 14, init: 2, xp: 60 }],
      ['ghast', { hd: 6, hp: 30, atk: 7, def: 15, init: 1, xp: 90 }],
      ['gargoyle', { hd: 6, hp: 32, atk: 7, def: 17, init: 1, xp: 90 }],
      ['salamander', { hd: 8, hp: 44, atk: 9, def: 16, init: 2, xp: 120 }],
      ['banshee', { hd: 9, hp: 40, atk: 10, def: 16, init: 2, xp: 135 }],
      ['frost_giant', { hd: 12, hp: 80, atk: 13, def: 17, init: -1, xp: 180 }],
      ['ashbound_knight', { hd: 12, hp: 75, atk: 13, def: 20, init: 0, xp: 180 }],
      ['basilisk', { hd: 11, hp: 70, atk: 12, def: 17, init: -1, xp: 165 }],
    ];
    for (const [id, numbers] of rows) {
      expect([id, makeMonster(id)]).toEqual([id, expect.objectContaining(numbers)]);
    }
  });

  it('carries what the stat block writes on the monster itself', () => {
    // DR 2 that crush goes straight through (`02` section 10).
    expect(makeMonster('animated_armor')).toMatchObject({ dr: 2, crushIgnoresDr: 'all' });
    // Ambushers: the Giant Spider drops on a 1-3, the Gargoyle waits for a 4.
    expect(makeMonster('giant_spider').surprise).toBe(3);
    expect(makeMonster('gargoyle').surprise).toBe(4);
    expect(makeMonster('wraith').surprise).toBe(3);
    // Grudge: there is no running from a Frozen Revenant.
    expect(makeMonster('frozen_revenant').preventsFlight).toBe(true);
    // Two claws, three missiles.
    expect(makeMonster('troll').attack.attacks).toBe(2);
    expect(makeMonster('rot_crawler').attack.attacks).toBe(2);
    const missiles = makeMonster('dark_mage').abilities.find((one) => one.id === 'magic_missile');
    expect(missiles).toMatchObject({ attacks: 3, autoHit: true });
  });

  it('gives a breath weapon its recharge and its one save', () => {
    const hound = makeMonster('ember_hound');
    const breath = hound.abilities.find((one) => one.id === 'flame_breath');
    expect(breath).toMatchObject({
      recharges: true,
      ready: true,
      damage: '3d6 fire',
      save: { type: 'reflex', dc: 13, half: true },
    });
    // The Burning rides the same save, rather than asking for another.
    expect(breath.onHit).toMatchObject({ useAttackSave: true, condition: 'burning' });
  });

  it('scales the Coin Imp to the floor it is met on', () => {
    expect(scale('floor * 4', 3)).toBe(12);
    expect(scale('14 + floor / 2', 5)).toBe(16);
    const imp = makeMonster('coin_imp', { floor: 3 });
    expect(imp).toMatchObject({ hd: 3, hp: 12, def: 15, xp: 30, goldRoll: 150 });
  });

  it('rolls a monster purse from its own notation', () => {
    const rng = createStream('gold', 'loot');
    expect(goldFrom(makeMonster('giant_rat'), rng)).toBe(0);
    const kobold = goldFrom(makeMonster('kobold'), rng);
    expect(kobold).toBeGreaterThanOrEqual(1);
    expect(kobold).toBeLessThanOrEqual(6);
  });

  it('gives every trait an implementation or a reason it is waiting', () => {
    for (const id of monsterIds()) {
      for (const entry of MONSTERS[id].traits ?? []) {
        const trait = typeof entry === 'string' ? entry : entry.id;
        const answered = Boolean(
          TRAITS[trait] || BOSS_TRAITS[trait] || ELITE_TRAITS[trait] || PENDING[trait],
        );
        expect([trait, answered]).toEqual([trait, true]);
      }
    }
  });

  it('builds a fightable field out of the table', () => {
    const combat = fight(['giant_rat', 'giant_rat', 'goblin_archer']);
    expect(combat.units.map((unit) => unit.id)).toEqual([
      'hero',
      'giant_rat-1',
      'giant_rat-2',
      'goblin_archer-1',
    ]);
    expect(combat.units[3].row).toBe('back');
    expect(combat.startingGroupSize).toBe(3);
  });
});

describe('the encounter tables (02 section 16)', () => {
  it('reads floor 1 line by line', () => {
    expect(lineFor(1, 1).monsters).toEqual([{ id: 'giant_rat', count: [2, 4] }]);
    expect(lineFor(1, 5).monsters).toEqual([{ id: 'kobold', count: [2, 3] }]);
    expect(lineFor(1, 7).monsters.map((row) => row.id)).toEqual(['kobold', 'goblin_archer']);
    expect(lineFor(1, 9).monsters).toEqual([{ id: 'green_slime', count: [1, 1] }]);
    expect(lineFor(1, 11).monsters.map((row) => row.id)).toEqual(['kobold', 'goblin_archer']);
  });

  it('reads floor 2 line by line', () => {
    expect(lineFor(2, 3).monsters).toEqual([{ id: 'skeleton', count: [2, 3] }]);
    expect(lineFor(2, 7).monsters).toEqual([{ id: 'cave_bat_swarm', count: [1, 1] }]);
    expect(lineFor(2, 8).monsters).toEqual([{ id: 'grave_robber', count: [1, 2] }]);
    expect(lineFor(2, 11).monsters).toEqual([{ id: 'ghoul', count: [1, 1] }]);
  });

  it('only ever names monsters that exist on that floor', () => {
    for (const floor of FLOORS) {
      for (const id of idsOnTable(floor)) {
        expect([id, MONSTERS[id]?.floors]).toEqual([id, expect.arrayContaining([floor])]);
      }
    }
  });

  it('reads the deeper tables line by line', () => {
    // 02 section 16, one line from each.
    expect(lineFor(3, 1).monsters.map((row) => row.id)).toEqual(['orc', 'goblin_archer']);
    expect(lineFor(4, 5).monsters).toEqual([{ id: 'rot_crawler', count: [1, 1] }]);
    expect(lineFor(5, 2).monsters).toEqual([{ id: 'ghoul', count: [2, 3] }]);
    expect(lineFor(6, 11).monsters).toEqual([{ id: 'ghast', count: [2, 2] }]);
    expect(lineFor(7, 6).monsters).toEqual([{ id: 'magma_beetle', count: [2, 3] }]);
    expect(lineFor(8, 7).monsters).toEqual([{ id: 'mimic', count: [1, 1] }]);
    expect(lineFor(9, 9).monsters.map((row) => row.id)).toEqual(['frost_giant', 'rime_wolf']);
    expect(lineFor(10, 11).monsters.map((row) => row.id)).toEqual(['frost_giant', 'troll']);
  });

  it('builds a fight from every roll of every floor', () => {
    for (const floor of FLOORS) {
      for (let roll = 1; roll <= 11; roll += 1) {
        const rng = createStream(`f${floor}r${roll}`, 'encounter');
        const queue = [roll];
        const die = rng.die;
        rng.die = (sides) => (queue.length ? queue.shift() : die(sides));
        const result = rollEncounter(floor, rng);
        expect([floor, roll, result.monsters.length > 0]).toEqual([floor, roll, true]);
        for (const unit of result.monsters) {
          expect([floor, roll, unit.hp > 0]).toEqual([floor, roll, true]);
        }
      }
    }
  });

  it('rolls a group inside the range the line gives', () => {
    const rng = createStream('encounter', 'encounter');
    rng.die = () => 1; // a 1 on the d12: 2-4 Giant Rats
    const result = rollEncounter(1, rng);
    expect(result.roll).toBe(1);
    expect(result.monsters.every((unit) => unit.type === 'giant_rat')).toBe(true);
    expect(result.monsters.length).toBeGreaterThanOrEqual(2);
    expect(result.monsters.length).toBeLessThanOrEqual(4);
  });

  it('sends a 12 and a 1 to the Coin Imp', () => {
    const rng = createStream('imp', 'encounter');
    const queue = [12, 1];
    rng.die = () => queue.shift();
    const result = rollEncounter(2, rng);
    expect(result).toMatchObject({ roll: 12, wanderer: 'coin_imp' });
    expect(result.monsters[0]).toMatchObject({ type: 'coin_imp', hd: 2, hp: 8 });
  });

  it('sends any other 12 back to the table with one monster made Elite', () => {
    const rng = createStream('elite', 'encounter');
    const queue = [12, 4, 9];
    rng.die = () => (queue.length ? queue.shift() : 1);
    rng.int = () => 0;
    const result = rollEncounter(2, rng);
    // Floor 2, line 9: 2 Skeletons + 1 Zombie, with the first made Elite.
    expect(result.roll).toBe(12);
    expect(result.elite).toBe('skeleton');
    expect(result.monsters.filter((unit) => unit.elite)).toHaveLength(1);
    expect(result.monsters.map((unit) => unit.type)).toEqual(['skeleton', 'skeleton', 'zombie']);
  });

  it('covers every roll on the die, with no gap and no overlap', () => {
    for (const floor of FLOORS) {
      const table = tableFor(floor);
      let previous = 0;
      for (const row of table) {
        expect(row.upTo).toBeGreaterThan(previous);
        previous = row.upTo;
      }
      // 12 is the special row, so the table itself ends at 11.
      expect(previous).toBe(11);
    }
  });
});

describe('on-hit riders (06 section 8)', () => {
  it("lands the Zombie's Grab on a failed Body save", () => {
    const combat = fight(['zombie']);
    const zombie = combat.units[1];
    fixRolls(combat, { d20: 2 });
    applyRider(combat, zombie, combat.hero, zombie.attack, { roll: 15 });
    expect(has(combat.hero, 'grabbed')).toBe(true);
    expect(combat.hero.conditions.grabbed.source).toBe('zombie-1');
  });

  it('is shrugged off on a save', () => {
    const combat = fight(['zombie']);
    fixRolls(combat, { d20: 19 });
    const result = applyRider(combat, combat.units[1], combat.hero, combat.units[1].attack, {});
    expect(result).toMatchObject({ applied: false, why: 'saved' });
  });

  it("only bites with the Giant Rat's Filthy Bite on a natural 18-20", () => {
    const combat = fight(['giant_rat']);
    const rat = combat.units[1];
    fixRolls(combat, { d20: 2 });
    expect(applyRider(combat, rat, combat.hero, rat.attack, { roll: 17 })).toBe(null);
    expect(applyRider(combat, rat, combat.hero, rat.attack, { roll: 18 })).toMatchObject({
      condition: 'weakened',
      applied: true,
    });
  });

  it('is skipped against an immune target, and the monster remembers', () => {
    const combat = fight(['ghoul'], { floor: 2 });
    const ghoul = combat.units[1];
    combat.hero.immunities = ['paralyzed'];
    const result = applyRider(combat, ghoul, combat.hero, ghoul.attack, {});
    expect(result).toMatchObject({ applied: false, why: 'immune' });
    expect(ghoul.knownImmune).toContain('paralyzed');
  });

  it('honours a natural 20 and a natural 1 on the save itself', () => {
    const rng = createStream('saves', 'combat');
    rng.d20 = () => 20;
    expect(rollSave({ saves: { body: -10 } }, 'body', 30, rng).passed).toBe(true);
    rng.d20 = () => 1;
    expect(rollSave({ saves: { body: 40 } }, 'body', 5, rng).passed).toBe(false);
  });

  it('rides a real attack, through the hit hook', () => {
    const combat = fight(['ghoul'], { floor: 2 });
    // One stubbed d20 serves both rolls: 9 + the Ghoul's +4 beats the hero's
    // DEF 12, and 9 + the hero's +1 Body falls short of the claw's DC 11.
    fixRolls(combat, { d20: 9, dice: 3 });
    resolveAttack(combat, combat.units[1], { target: 'hero', ...combat.units[1].attack });
    expect(has(combat.hero, 'paralyzed')).toBe(true);
  });
});

describe('the traits of floor 1', () => {
  it('Pack Tactics adds +1 a kobold, capped at +2', () => {
    const combat = fight(['kobold', 'kobold', 'kobold', 'kobold']);
    const kobold = combat.units[1];
    let seen = 0;
    combat.hooks.on('attackRoll', (payload) => {
      if (payload.phase === 'gather') seen = payload.bonus;
    }, { name: 'zzz', order: 99 });

    fixRolls(combat, { d20: 10, dice: 1 });
    resolveAttack(combat, kobold, { target: 'hero', ...kobold.attack });
    expect(seen).toBe(2);

    combat.units[2].alive = false;
    combat.units[3].alive = false;
    resolveAttack(combat, kobold, { target: 'hero', ...kobold.attack });
    expect(seen).toBe(1);
  });

  it('the last kobold standing checks its morale at once', () => {
    const combat = fight(['kobold', 'kobold']);
    const survivor = combat.units[1];
    fixRolls(combat, { roll: 12 }); // 2d6 of 12 beats Morale 7
    combat.units[2].alive = false;
    combat.hooks.fire('kill', { combat, target: combat.units[2], unit: combat.units[2] });
    expect(survivor.fleeing).toBe(true);
  });

  it('the Green Slime divides under a heavy slash, up to four slimes', () => {
    const combat = fight(['green_slime']);
    const slime = combat.units[1];
    fixRolls(combat, { d20: 15, dice: 6 });

    resolveAttack(combat, combat.hero, { target: 'green_slime-1', damage: '1d8 slash' });
    const slimes = countedEnemies(combat).filter((unit) => unit.type === 'green_slime');
    expect(slimes).toHaveLength(2);
    // The two halves share what was left: nothing is created out of nothing.
    expect(slimes[0].hp + slimes[1].hp).toBeLessThanOrEqual(10);
  });

  it('does not divide under crush, however hard', () => {
    const combat = fight(['green_slime']);
    fixRolls(combat, { d20: 15, dice: 6 });
    resolveAttack(combat, combat.hero, { target: 'green_slime-1', damage: '1d8 crush' });
    expect(countedEnemies(combat).filter((unit) => unit.type === 'green_slime')).toHaveLength(1);
  });

  it('fires a Volley with the turns of every archer in the group', () => {
    const combat = fight(['goblin_archer', 'goblin_archer']);
    const [, first, second] = combat.units;
    fixRolls(combat, { d20: 12, dice: 2 });

    const action = chooseAction(combat, first);
    expect(action).toMatchObject({ ability: 'volley' });

    const before = combat.hero.hp;
    takeMonsterTurn(combat, first, {
      script: () => action,
      resolveAction: (c, unit, chosen) => resolveAttack(c, unit, { ...chosen, target: 'hero' }),
    });
    // Both archers fired, and the second one's turn is spent.
    expect(combat.hero.hp).toBeLessThan(before);
    expect(second.actedInRound).toBe(combat.round);
    const record = takeMonsterTurn(combat, second, { script: () => ({ id: 'attack' }) });
    expect(record.steps[0].type).toBe('turnSpent');
  });
});

describe('the traits of floor 2', () => {
  it('Reassemble stands a Skeleton back up on a 1 in 6', () => {
    const combat = fight(['skeleton'], { floor: 2 });
    const skeleton = combat.units[1];
    skeleton.alive = false;
    skeleton.lastDamageTypes = ['slash'];
    fixRolls(combat, { die: 1 });
    endRound(combat, {});
    expect(skeleton.alive).toBe(true);
    expect(skeleton.hp).toBe(5);
  });

  it('leaves it down when crush or holy put it there', () => {
    const combat = fight(['skeleton'], { floor: 2 });
    const skeleton = combat.units[1];
    skeleton.alive = false;
    skeleton.lastDamageTypes = ['crush'];
    fixRolls(combat, { die: 1 });
    endRound(combat, {});
    expect(skeleton.alive).toBe(false);
  });

  it('Relentless gets a Zombie up once, at 1 HP', () => {
    const combat = fight(['zombie'], { floor: 2 });
    const zombie = combat.units[1];
    fixRolls(combat, { d20: 18, dice: 20, die: 1 });
    resolveAttack(combat, combat.hero, { target: 'zombie-1', damage: '2d10 slash' });
    expect(zombie).toMatchObject({ alive: true, hp: 1, usedRelentless: true });
  });

  it('does not get it up from fire, or from a critical hit', () => {
    const burned = fight(['zombie'], { floor: 2 });
    fixRolls(burned, { d20: 18, dice: 20, die: 1 });
    resolveAttack(burned, burned.hero, { target: 'zombie-1', damage: '2d10 fire' });
    expect(burned.units[1].alive).toBe(false);

    const crit = fight(['zombie'], { floor: 2, seed: 'crit' });
    fixRolls(crit, { d20: 20, dice: 20, die: 1 });
    resolveAttack(crit, crit.hero, { target: 'zombie-1', damage: '2d10 slash' });
    expect(crit.units[1].alive).toBe(false);
  });

  it('the Cave Bat Swarm turns a single-target weapon aside', () => {
    const combat = fight(['cave_bat_swarm'], { floor: 2 });
    const swarm = combat.units[1];
    fixRolls(combat, { d20: 15, dice: 6 });
    resolveAttack(combat, combat.hero, { target: 'cave_bat_swarm-1', damage: '1d8 slash' });
    expect(swarm.hp).toBe(7); // 6 halved to 3, off 10
  });

  it('and comes apart under an area effect', () => {
    const combat = fight(['cave_bat_swarm'], { floor: 2 });
    const swarm = combat.units[1];
    fixRolls(combat, { d20: 15, dice: 6 });
    resolveAttack(combat, combat.hero, {
      target: 'cave_bat_swarm-1',
      kind: 'spell',
      area: true,
      damage: '1d8 fire',
    });
    expect(swarm.hp).toBe(1); // 6 and a half again is 9
  });

  it('Echolocation gives the swarm advantage in the dark', () => {
    const combat = fight(['cave_bat_swarm'], { floor: 2 });
    let options = null;
    combat.rng.d20 = (given = {}) => {
      options = given;
      return 10;
    };
    combat.dark = true;
    resolveAttack(combat, combat.units[1], { target: 'hero', ...combat.units[1].attack });
    expect(options).toMatchObject({ advantage: true });
  });

  it('Blinding Flurry blinds on a critical hit', () => {
    const combat = fight(['cave_bat_swarm'], { floor: 2 });
    fixRolls(combat, { d20: 20, dice: 2 });
    resolveAttack(combat, combat.units[1], { target: 'hero', ...combat.units[1].attack });
    expect(has(combat.hero, 'blinded')).toBe(true);
  });

  it('the Grave Robber steals gold, and runs with it', () => {
    const combat = fight(['grave_robber'], { floor: 2, hero: { gold: 40 } });
    const robber = combat.units[1];
    fixRolls(combat, { d20: 15, dice: 3, roll: 12 });
    resolveAttack(combat, robber, { target: 'hero', ...robber.attack });
    expect(combat.hero.gold).toBe(28);
    expect(robber.stolenGold).toBe(12);
    // The Thief archetype's first rule is exactly its Slippery trait.
    expect(chooseAction(combat, robber).id).toBe('flee');
  });

  it('never steals more than the hero is carrying', () => {
    const combat = fight(['grave_robber'], { floor: 2, hero: { gold: 3 } });
    fixRolls(combat, { d20: 15, dice: 3, roll: 20 });
    resolveAttack(combat, combat.units[1], { target: 'hero', ...combat.units[1].attack });
    expect(combat.hero.gold).toBe(0);
    expect(combat.units[1].stolenGold).toBe(3);
  });

  it("the Ghoul's Feast adds a die against a Paralyzed hero", () => {
    const combat = fight(['ghoul'], { floor: 2 });
    const ghoul = combat.units[1];
    fixRolls(combat, { d20: 15, dice: 4 });

    const before = combat.hero.hp;
    resolveAttack(combat, ghoul, { target: 'hero', damage: '1d6+1 slash' });
    const ordinary = before - combat.hero.hp;

    applyCondition(combat.hero, 'paralyzed', { dc: 11 });
    const then = combat.hero.hp;
    resolveAttack(combat, ghoul, { target: 'hero', damage: '1d6+1 slash' });
    expect(then - combat.hero.hp).toBe(ordinary + 4);
  });
});

describe('a fight the document would recognise', () => {
  it('runs 2 Kobolds and a Goblin Archer from the first round to the last', () => {
    const combat = fight(['kobold', 'kobold', 'goblin_archer']);
    combat.round = null;
    let guard = 0;

    while (!combat.over && guard < 30) {
      guard += 1;
      startRound(combat);
      runTurns(combat, {
        takeTurn: (c, unit) =>
          unit.side === 'hero'
            ? takeMonsterTurn(c, unit, {}) // the hero waits; the monsters fight
            : takeMonsterTurn(c, unit, {
                script: chooseAction,
                resolveAction: (fightNow, attacker, action) =>
                  resolveAttack(fightNow, attacker, { ...action, target: 'hero' }),
              }),
      });
      endRound(combat, {});
      if (!combat.hero.alive) break;
    }

    // Three level-1 monsters do eventually wear a stand-in hero down, and the
    // whole loop runs without anything throwing.
    expect(guard).toBeLessThan(30);
    expect(combat.hero.hp).toBeLessThan(20);
  });
});
