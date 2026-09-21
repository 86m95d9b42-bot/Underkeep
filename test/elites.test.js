/**
 * Elites and the two rare wanderers (`02` sections 14 and 15).
 *
 * The d12 table is checked against the document row by row, and each trait is
 * put on the field and watched. The Coin Imp arrives through the encounter
 * table's own twelve; the Hollow Stalker arrives on the step clock, which is
 * the one monster in the game that the dungeon sends rather than the dice.
 */
import { describe, it, expect } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import { ELITE, applyElite, eliteChance, eliteIds, eliteTrait, makeElite } from '../src/data/elites.js';
import { ELITE_TRAITS } from '../src/engine/elite-traits.js';
import { goldFrom, makeMonster } from '../src/data/monsters.js';
import { rollEncounter } from '../src/data/encounters.js';
import { resolveAttack } from '../src/engine/attack.js';
import { has } from '../src/engine/conditions.js';
import { createRun } from '../src/systems/run.js';
import { createClock, stalkerEscaped } from '../src/dungeon/step-clock.js';
import { pacing } from '../src/data/floors.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  name: 'Harrow',
  hp: 80,
  maxHp: 80,
  atk: 6,
  def: 14,
  protected: true,
  saves: { body: 2, reflex: 2, mind: 2 },
  attack: { name: 'sword', kind: 'melee', damage: '1d8+3 slash' },
  ...extra,
});

/** A fight with one elite of this kind, and the engine's rules on. */
function withElite(type, traitId, { floor = 5, seed = 'elites', hero = {} } = {}) {
  const unit = applyElite(makeMonster(type, { floor }), eliteTrait(traitId));
  const hooks = createHooks();
  const combat = createCombat({
    hero: heroTemplate(hero),
    monsters: [unit],
    rng: createStream(seed, 'combat'),
    hooks,
    surprise: false,
  });
  combat.floor = floor;
  registerRules(combat);
  combat.round = 1;
  combat.difficulty = 'hard';
  return { combat, elite: combat.units.find((one) => one.type === type) };
}

/** A list is a queue: the attack roll and the save it forces are two dice. */
function fixRolls(combat, { d20, die, roll } = {}) {
  const feed = (value) => {
    if (value === undefined) return undefined;
    const queue = Array.isArray(value) ? [...value] : [value];
    return () => (queue.length > 1 ? queue.shift() : queue[0]);
  };
  const twenties = feed(d20);
  const dice = feed(die);
  const rolls = feed(roll);
  if (twenties) combat.rng.d20 = twenties;
  if (dice) combat.rng.die = dice;
  if (rolls) combat.rng.roll = rolls;
}

describe('the d12 table (02 section 15)', () => {
  it('has the twelve the document lists, in its order', () => {
    expect(eliteIds()).toEqual([
      'hulking', 'swift', 'venomous', 'blazing', 'frostbound', 'vampiric',
      'ironhide', 'arcane', 'warded', 'berserker', 'cursed', 'gilded',
    ]);
    for (let roll = 1; roll <= 12; roll += 1) expect(eliteTrait(roll).roll).toBe(roll);
    expect(() => eliteTrait('shiny')).toThrow(/shiny/);
  });

  it('answers every one with a hook or with numbers', () => {
    for (const id of eliteIds()) {
      expect([id, Boolean(ELITE_TRAITS[`elite_${id}`])]).toEqual([id, true]);
    }
  });

  it('is 10% + 2% a floor', () => {
    expect(eliteChance(1)).toBeCloseTo(0.12);
    expect(eliteChance(10)).toBeCloseTo(0.3);
  });

  it('doubles the hit points and the experience, and guarantees a drop', () => {
    const plain = makeMonster('orc', { floor: 3 });
    const elite = applyElite(makeMonster('orc', { floor: 3 }), eliteTrait('ironhide'));

    expect(elite.maxHp).toBe(plain.maxHp * ELITE.hpMultiplier);
    expect(elite.hp).toBe(elite.maxHp);
    expect(elite.xp).toBe(plain.xp * ELITE.xpMultiplier);
    expect(elite.drops.at(-1)).toEqual({ item: 'common', chance: 1 });
    expect(elite.name).toBe('Ironhide Orc');
    expect(elite.dr).toBe(3);
  });

  it('gives Hulking its extra quarter, on top of the double', () => {
    const plain = makeMonster('orc', { floor: 3 });
    const hulk = applyElite(makeMonster('orc', { floor: 3 }), eliteTrait('hulking'));
    expect(hulk.maxHp).toBe(Math.floor(plain.maxHp * 2 * 1.25));
  });

  it('rolls one onto an encounter, at the document’s rate', () => {
    let elites = 0;
    const seen = new Set();
    for (let seed = 0; seed < 400; seed += 1) {
      const rolled = rollEncounter(5, createStream(`e${seed}`, 'encounter'));
      if (!rolled.elite) continue;
      elites += 1;
      seen.add(rolled.monsters.find((one) => one.elite)?.eliteTrait);
    }
    // 20% on floor 5, plus the table's own twelve, which makes one as well.
    expect(elites / 400).toBeGreaterThan(0.18);
    expect(elites / 400).toBeLessThan(0.35);
    // Over four hundred encounters every trait shows up.
    expect(seen.size).toBe(12);
  });
});

describe('what each elite trait does', () => {
  it('Hulking hits for two more', () => {
    const { combat, elite } = withElite('orc', 'hulking');
    fixRolls(combat, { d20: 18, roll: 4 });
    const result = resolveAttack(combat, elite, { ...elite.attack, target: 'hero' });
    const plain = withElite('orc', 'ironhide');
    fixRolls(plain.combat, { d20: 18, roll: 4 });
    const ordinary = resolveAttack(plain.combat, plain.elite, { ...plain.elite.attack, target: 'hero' });
    expect(result.damage.total).toBe(ordinary.damage.total + 2);
  });

  it('Swift takes an extra swing every other round', () => {
    const { combat, elite } = withElite('orc', 'swift');
    expect(elite.init).toBe(makeMonster('orc', { floor: 5 }).init + 4);
    fixRolls(combat, { d20: 18, roll: 3 });

    combat.round = 2;
    const payload = { combat, unit: elite, say: () => {} };
    combat.hooks.fire('turnEnd', payload);
    expect(payload.alsoResolved).toHaveLength(1);

    // And not on the odd rounds.
    combat.round = 3;
    const quiet = { combat, unit: elite, say: () => {} };
    combat.hooks.fire('turnEnd', quiet);
    expect(quiet.alsoResolved).toBe(undefined);
  });

  it('Venomous poisons with the monster’s own DC', () => {
    const { combat, elite } = withElite('orc', 'venomous');
    expect(elite.attack.onHit).toMatchObject({ save: 'body', condition: 'poisoned' });
    // An 18 to hit, then a 2 on the Body save the venom forces.
    fixRolls(combat, { d20: [18, 2], roll: 3 });
    resolveAttack(combat, elite, { ...elite.attack, target: 'hero' });
    expect(has(combat.hero, 'poisoned')).toBe(true);
  });

  it('Blazing and Frostbound add their own element, and shrug it off', () => {
    for (const [id, type] of [['blazing', 'fire'], ['frostbound', 'cold']]) {
      const { combat, elite } = withElite('orc', id);
      expect([id, elite.immunities]).toEqual([id, expect.arrayContaining([type])]);
      fixRolls(combat, { d20: 18, roll: 3 });
      const result = resolveAttack(combat, elite, { ...elite.attack, target: 'hero' });
      expect([id, result.damage.parts.some((part) => part.type === type)]).toEqual([id, true]);
    }
  });

  it('Vampiric drinks half of what it deals', () => {
    const { combat, elite } = withElite('orc', 'vampiric');
    elite.hp = 10;
    fixRolls(combat, { d20: 18, roll: 6 });
    const result = resolveAttack(combat, elite, { ...elite.attack, target: 'hero' });
    expect(elite.hp).toBe(10 + Math.floor(result.damage.total / 2));
  });

  it('Ironhide takes three off every hit', () => {
    const { combat, elite } = withElite('orc', 'ironhide');
    fixRolls(combat, { d20: 18, roll: 6 });
    const hit = resolveAttack(combat, combat.hero, { ...combat.hero.attack, target: elite.id });
    const soft = withElite('orc', 'gilded');
    fixRolls(soft.combat, { d20: 18, roll: 6 });
    const other = resolveAttack(soft.combat, soft.combat.hero, {
      ...soft.combat.hero.attack,
      target: soft.elite.id,
    });
    expect(hit.damage.total).toBe(other.damage.total - 3);
  });

  it('Arcane looses a missile for every three hit dice', () => {
    const { combat, elite } = withElite('ogre', 'arcane', { floor: 7 });
    combat.round = 2;
    const before = combat.hero.hp;
    fixRolls(combat, { roll: 3, die: 3 });
    combat.hooks.fire('turnStart', { combat, unit: elite, phase: 'free', say: () => {} });
    // An Ogre is HD 7: two missiles.
    expect(combat.hero.hp).toBeLessThan(before);
  });

  it('Warded turns one blow a round aside', () => {
    const { combat, elite } = withElite('orc', 'warded');
    fixRolls(combat, { d20: 15, roll: 3 });
    const first = resolveAttack(combat, combat.hero, { ...combat.hero.attack, target: elite.id });
    expect(first.def).toBe(elite.def + 4);
    const second = resolveAttack(combat, combat.hero, { ...combat.hero.attack, target: elite.id });
    expect(second.def).toBe(elite.def);
  });

  it('Berserker rages below half', () => {
    const { combat, elite } = withElite('orc', 'berserker');
    const atk = elite.atk;
    elite.hp = Math.floor(elite.maxHp * 0.4);
    combat.hooks.fire('damageTaken', { combat, target: elite, say: () => {} });
    expect(elite.raging).toBe(true);
    expect(elite.atk).toBe(atk + 3);
  });

  it('Cursed costs the hero a Mind save when it falls', () => {
    const { combat, elite } = withElite('orc', 'cursed');
    fixRolls(combat, { d20: 1 });
    elite.alive = false;
    combat.hooks.fire('kill', {
      combat,
      target: elite,
      unit: elite,
      attacker: combat.hero,
      say: () => {},
    });
    expect(has(combat.hero, 'weakened')).toBe(true);
  });

  it('Gilded is carrying three times the purse, and something good', () => {
    const plain = makeMonster('orc', { floor: 3 });
    const gilded = applyElite(makeMonster('orc', { floor: 3 }), eliteTrait('gilded'));
    expect(goldFrom(gilded, createStream('g', 'loot'))).toBe(
      goldFrom(plain, createStream('g', 'loot')) * 3,
    );
    expect(gilded.drops.at(-1)).toEqual({ item: 'uncommon', chance: 1 });
  });

  it('rolls a trait off the die, and only the twelve', () => {
    for (let roll = 1; roll <= 12; roll += 1) {
      const rng = createStream('t', 'combat');
      rng.die = () => roll;
      const unit = makeElite(rng, makeMonster('orc', { floor: 3 }));
      expect([roll, unit.eliteTrait]).toEqual([roll, eliteTrait(roll).id]);
    }
  });
});

describe('the rare wanderers (02 section 14)', () => {
  it('scales the Coin Imp to the floor it is met on, and lets it run', () => {
    const imp = makeMonster('coin_imp', { floor: 6 });
    expect(imp).toMatchObject({ hd: 6, hp: 24, def: 17, xp: 60 });
    // It never attacks, and it leaves at the end of round 2 (`02` section 14).
    expect(imp.attacks).toEqual([]);
    expect(imp.script.map((rule) => rule.do)).toEqual(['flee', 'wait']);
  });

  it('builds the Hollow Stalker from its hit dice', () => {
    for (const floor of [3, 6, 10]) {
      const stalker = makeMonster('hollow_stalker', { floor });
      expect([floor, stalker.hd]).toEqual([floor, floor + 6]);
      // (floor + 6) x 8 hit points, and triple the normal HD x 10 XP.
      expect([floor, stalker.hp]).toEqual([floor, (floor + 6) * 8]);
      expect([floor, stalker.xp]).toEqual([floor, (floor + 6) * 30]);
      expect([floor, stalker.atk]).toEqual([floor, floor + 8]);
      expect([floor, stalker.def]).toEqual([floor, 14 + floor]);
      expect([floor, stalker.attack.damage]).toEqual([floor, `2d8+${floor} necrotic`]);
      // A guaranteed Rare item, and nothing it can be talked out of.
      expect(stalker.drops).toEqual([{ item: 'rare', chance: 1 }]);
      expect(stalker.immunities).toEqual(expect.arrayContaining(['asleep', 'feared', 'paralyzed']));
    }
  });

  it('is not on any floor’s table: the clock sends it, not the dice', () => {
    const stalker = makeMonster('hollow_stalker', { floor: 5 });
    expect(stalker.wanderer).toBe(true);
    for (let floor = 1; floor <= 10; floor += 1) {
      for (let roll = 1; roll <= 11; roll += 1) {
        const rng = createStream(`f${floor}r${roll}`, 'encounter');
        const queue = [roll];
        const die = rng.die;
        rng.die = (sides) => (queue.length ? queue.shift() : die(sides));
        const rolled = rollEncounter(floor, rng);
        expect(rolled.monsters.every((one) => one.type !== 'hollow_stalker')).toBe(true);
      }
    }
  });
});

describe('the Hollow Stalker on the clock', () => {
  it('warns twice, then sends it at 1,500 steps', () => {
    const run = createRun({ masterSeed: 5, floor: 6 });
    run.ex.steps = 995;
    const seen = [];
    for (let i = 0; i < 600 && !seen.includes('stalker'); i += 1) {
      for (const event of run.press(i % 2 ? 'turnLeft' : 'turnRight').events) {
        if (event.type === 'stalkerWarning') seen.push(`warn${event.at}`);
        if (event.type === 'stalker') seen.push('stalker');
      }
    }
    expect(seen).toContain('warn1000');
    expect(seen).toContain('warn1250');
    expect(seen).toContain('stalker');
    expect(run.ex.steps).toBeGreaterThanOrEqual(pacing.hollowStalkerSteps);
  });

  it('arrives with the fight it is', () => {
    const run = createRun({ masterSeed: 5, floor: 6 });
    run.ex.steps = pacing.hollowStalkerSteps - 2;
    let arrival = null;
    for (let i = 0; i < 20 && !arrival; i += 1) {
      arrival = run.press('turnLeft').events.find((event) => event.type === 'stalker');
    }
    expect(arrival.monsters[0]).toMatchObject({ type: 'hollow_stalker', hd: 12 });
    expect(run.stalker).toMatchObject({ type: 'hollow_stalker' });
  });

  it('comes back a hundred steps after the hero runs', () => {
    const clock = createClock();
    clock.steps = 1600;
    clock.stalkerLoose = true;
    const at = stalkerEscaped(clock);
    expect(at).toBe(1700);
    expect(clock.stalkerLoose).toBe(false);

    const run = createRun({ masterSeed: 5, floor: 6 });
    run.ex.steps = 1600;
    run.ex.stalkerLoose = true;
    run.stalkerEscaped();
    expect(run.stalker).toBe(null);
    run.ex.steps = 1700;
    const again = run.press('turnLeft').events.find((event) => event.type === 'stalker');
    expect(again).toMatchObject({ again: true });
  });
});
