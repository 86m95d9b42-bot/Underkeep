/**
 * The ten bosses (`02` sections 4 to 13, `06` sections 12 and 13).
 *
 * The stat blocks are checked against the document, and each boss's own
 * mechanic is put on the field and watched: the swarm the Rat King hides in,
 * the head that grows back double, the valve that douses the Colossus, the
 * phylactery that will not let the Lich die.
 */
import { describe, it, expect } from 'vitest';
import { createStream } from '../src/engine/rng.js';
import { createHooks } from '../src/engine/hooks.js';
import { createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import { BOSSES, BOSS_TUNING, bossIds, bossOnFloor, bossParty, bossTuning, makeBoss, rewardOf } from '../src/data/bosses.js';
import { createFight, standInHero } from '../src/systems/fight.js';
import { answerOffer, applyQueuedPhases, phaseFor, queuePhase, stateAction, summon, turnThePage } from '../src/engine/boss.js';
import { BOSS_TRAITS } from '../src/engine/boss-traits.js';
import { zeroHp } from '../src/engine/defeat.js';
import { evaluate, spend } from '../src/engine/ai.js';
import { has } from '../src/engine/conditions.js';
import { item } from '../src/data/items.js';
import { playBoss } from '../tools/lib/bosser.js';

const heroTemplate = (extra = {}) => ({
  id: 'hero',
  name: 'Harrow',
  hp: 200,
  maxHp: 200,
  fp: 20,
  maxFp: 20,
  atk: 10,
  def: 18,
  protected: true,
  saves: { body: 4, reflex: 4, mind: 4 },
  attack: { name: 'sword', kind: 'melee', damage: '2d8+6 slash' },
  ...extra,
});

/** A boss fight with the engine's own rules registered. */
function arena(id, { hero = {}, seed = 'bosses' } = {}) {
  const hooks = createHooks();
  const rng = createStream(seed, 'combat');
  const { units } = bossParty(id);
  const combat = createCombat({
    hero: heroTemplate(hero),
    monsters: units,
    rng,
    hooks,
    surprise: false,
  });
  combat.floor = BOSSES[id].floor;
  combat.boss = id;
  registerRules(combat);
  combat.round = 1;
  combat.difficulty = 'hard';
  return combat;
}

const find = (combat, type) => combat.units.find((unit) => unit.type === type);
// A part and an object are both on the field without being counted enemies
// (`06` section 13), so the field itself is what this reads.
const living = (combat, type) =>
  combat.units.filter((one) => one.side === 'monsters' && one.alive && one.type === type);

describe('the ten stat blocks (02 sections 4 to 13)', () => {
  it('has one boss for every floor', () => {
    expect(bossIds()).toHaveLength(10);
    for (let floor = 1; floor <= 10; floor += 1) {
      expect([floor, Boolean(bossOnFloor(floor))]).toEqual([floor, true]);
    }
  });

  it('transcribes the numbers, boss by boss', () => {
    const rows = [
      ['rat_king', { hd: 3, hp: 30, atk: 4, def: 13, xp: 100 }],
      ['bone_warden', { hd: 5, hp: 50, atk: 6, def: 16, xp: 250 }],
      ['grukk', { hd: 6, hp: 70, atk: 7, def: 15, xp: 400 }],
      ['brood_mother', { hd: 8, hp: 110, atk: 9, def: 16, xp: 600 }],
      ['hydra', { hd: 10, hp: 60, def: 16, xp: 800 }],
      ['veyra', { hd: 11, hp: 150, def: 17, xp: 1000 }],
      ['forge_colossus', { hd: 13, hp: 220, atk: 12, def: 18, xp: 1300 }],
      ['bound_grimoire', { hd: 14, hp: 200, atk: 11, def: 17, xp: 1500 }],
      ['malgorath', { hd: 16, hp: 180, atk: 12, def: 18, xp: 1800 }],
      ['vyrmathrax', { hd: 15, hp: 330, atk: 15, def: 20, xp: 2500 }],
    ];
    for (const [id, numbers] of rows) {
      expect([id, makeBoss(id)]).toEqual([id, expect.objectContaining(numbers)]);
    }
  });

  it('carries the one item each is holding', () => {
    for (const id of bossIds()) {
      const reward = rewardOf(id);
      expect([id, Boolean(reward.item)]).toEqual([id, true]);
      // Every one of them is a unique (`04` section 13).
      expect([id, item(reward.item).rarity]).toEqual([id, 'unique']);
    }
    expect(rewardOf('vyrmathrax').ending).toBe(true);
  });

  it('brings its escort, its parts and its arena objects (06 section 13)', () => {
    expect(bossParty('rat_king').units.map((one) => one.type)).toEqual([
      'rat_king',
      'giant_rat',
      'giant_rat',
    ]);
    // The Hydra starts with three heads, each a unit on the body's initiative.
    const hydra = bossParty('hydra');
    expect(hydra.units.filter((one) => one.part)).toHaveLength(3);
    expect(hydra.units[1].init).toBe(hydra.boss.init);
    // The Colossus's valves and the Lich's phylactery are objects: they are
    // hit, they never act.
    expect(bossParty('forge_colossus').units.filter((one) => one.object)).toHaveLength(2);
    expect(bossParty('malgorath').units.find((one) => one.object)?.type).toBe('phylactery');
    expect(bossParty('bone_warden').units).toHaveLength(1);
  });

  it('anchors what 06 section 13 anchors', () => {
    for (const id of ['hydra', 'veyra', 'bound_grimoire']) {
      expect([id, makeBoss(id).anchored]).toEqual([id, true]);
    }
    for (const unit of bossParty('malgorath').units.filter((one) => one.object)) {
      expect(unit.anchored).toBe(true);
    }
  });

  it('answers every trait it names', () => {
    for (const id of bossIds()) {
      for (const entry of BOSSES[id].traits ?? []) {
        const trait = typeof entry === 'string' ? entry : entry.id;
        expect([id, trait, Boolean(BOSS_TRAITS[trait])]).toEqual([id, trait, true]);
      }
    }
  });
});

describe('phases (06 section 3 step 5)', () => {
  it('queues the change and applies it at the start of the next round', () => {
    const combat = arena('veyra');
    const veyra = find(combat, 'veyra');
    expect(veyra.phase).toBe(1);
    expect(veyra.row).toBe('back');

    veyra.hp = Math.floor(veyra.maxHp * 0.4);
    expect(phaseFor(veyra)).toBe(2);
    expect(queuePhase(veyra)).toBe(2);
    // Still phase 1: the hero has a turn between the threshold and what
    // follows it.
    expect(veyra.phase).toBe(1);

    const changes = applyQueuedPhases(combat);
    expect(changes[0]).toMatchObject({ unit: veyra.id, phase: 2 });
    expect(veyra.phase).toBe(2);
    // Ascension: she steps down, stops being anchored, and stops caring
    // about fire (`02` section 9).
    expect(veyra.row).toBe('front');
    expect(veyra.anchored).toBe(false);
    expect(veyra.immunities).toContain('fire');
    expect(veyra.attack.attacks).toBe(2);
  });

  it('runs the dragon through all three (02 section 13)', () => {
    const combat = arena('vyrmathrax');
    const dragon = find(combat, 'vyrmathrax');
    dragon.hp = Math.floor(dragon.maxHp * 0.5);
    queuePhase(dragon);
    applyQueuedPhases(combat);
    expect(dragon.phase).toBe(2);

    dragon.hp = Math.floor(dragon.maxHp * 0.2);
    queuePhase(dragon);
    applyQueuedPhases(combat);
    expect(dragon.phase).toBe(3);
    expect(dragon.state).toBe('grounded');
  });
});

describe('the state machine (06 section 12)', () => {
  it('flies the cycle the table gives, and lands stunned', () => {
    const combat = arena('vyrmathrax');
    const dragon = find(combat, 'vyrmathrax');
    dragon.phase = 3;
    dragon.state = 'grounded';
    dragon.stateTurns = 0;

    // Grounded for two turns.
    expect(stateAction(combat, dragon)?.id).toBe('attack');
    expect(dragon.state).toBe('grounded');
    stateAction(combat, dragon);
    expect(dragon.state).toBe('takeoff');

    // Up, and winding up the breath.
    const rising = stateAction(combat, dragon);
    expect(rising).toMatchObject({ id: 'telegraph', ability: 'ash_breath' });
    expect(dragon.row).toBe('back');
    expect(dragon.state).toBe('air1');

    // The breath resolves itself, then the dive is wound up and resolved.
    expect(stateAction(combat, dragon)).toBe(null);
    expect(dragon.state).toBe('air2');
    expect(stateAction(combat, dragon)).toMatchObject({ id: 'telegraph', ability: 'dive' });
    expect(dragon.state).toBe('air3');
    expect(stateAction(combat, dragon)).toBe(null);

    // Down again, stunned: the hero's window (`06` section 12).
    expect(dragon.row).toBe('front');
    expect(dragon.state).toBe('grounded');
    expect(has(dragon, 'stunned')).toBe(true);
  });
});

describe('summons (06 section 13)', () => {
  it('fills the row it names, up to the ability’s own maximum', () => {
    const combat = arena('rat_king');
    const king = find(combat, 'rat_king');
    const spec = { id: 'giant_rat', count: '1d3', max: 4, row: 'front' };

    const first = summon(combat, king, spec);
    expect(first.length).toBeGreaterThan(0);
    for (const rat of first) {
      expect(rat.summoned).toBe(true);
      expect(rat.row).toBe('front');
    }
    // Never past four rats, however often it is called.
    for (let i = 0; i < 6; i += 1) summon(combat, king, spec);
    expect(living(combat, 'giant_rat').length).toBeLessThanOrEqual(4);
  });

  it('tops the Lich’s front row back up rather than doubling it', () => {
    const combat = arena('malgorath');
    const lich = find(combat, 'malgorath');
    living(combat, 'frozen_revenant')[0].alive = false;
    const arrived = summon(combat, lich, {
      id: 'frozen_revenant',
      count: '2',
      max: 2,
      row: 'front',
      refill: true,
    });
    expect(arrived).toHaveLength(1);
    expect(living(combat, 'frozen_revenant')).toHaveLength(2);
  });
});

describe('what each boss is built around', () => {
  it('hides the Rat King behind its swarm, and puts it out front when they fall', () => {
    const combat = arena('rat_king');
    const king = find(combat, 'rat_king');
    const rats = living(combat, 'giant_rat');

    combat.hooks.fire('combatStart', { combat });
    // Every rat squeaks a little louder (`02` section 4).
    expect(rats[0].atk).toBe(3);
    expect(king.anchored).toBe(true);
    expect(king.row).toBe('back');

    for (const rat of rats) rat.alive = false;
    combat.hooks.fire('kill', { combat, target: rats[0], unit: rats[0], say: () => {} });
    expect(king.anchored).toBe(false);
    expect(king.row).toBe('front');
  });

  it('keeps the Hydra’s body out of reach while three heads live', () => {
    const combat = arena('hydra');
    const body = find(combat, 'hydra');
    const payload = {
      combat,
      attacker: combat.hero,
      target: body,
      attack: { kind: 'melee' },
      phase: 'redirect',
    };
    combat.hooks.fire('beforeAction', payload);
    expect(payload.target.type).toBe('hydra_head');

    // A spell reaches it at any time (`02` section 8).
    const spell = { combat, attacker: combat.hero, target: body, attack: { kind: 'spell' }, phase: 'redirect' };
    combat.hooks.fire('beforeAction', spell);
    expect(spell.target).toBe(body);
  });

  it('grows two heads back for one, unless the stump was burned', () => {
    const combat = arena('hydra');
    const head = living(combat, 'hydra_head')[0];
    head.alive = false;
    head.lastDamageTypes = ['slash'];
    combat.hooks.fire('kill', { combat, target: head, unit: head, say: () => {} });
    // The round it fell in, nothing grows: that is the hero's turn to sear it.
    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    expect(living(combat, 'hydra_head').length).toBe(2);
    // The round after, two come back.
    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    expect(living(combat, 'hydra_head').length).toBe(4);

    // Fire seals it (`02` section 8, and section 2's torches).
    const burned = living(combat, 'hydra_head')[0];
    burned.alive = false;
    burned.lastDamageTypes = ['fire'];
    combat.hooks.fire('kill', { combat, target: burned, unit: burned, say: () => {} });
    const before = living(combat, 'hydra_head').length;
    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    expect(living(combat, 'hydra_head').length).toBe(before);
  });

  it('lets a torch sear a stump in the round after the head fell', async () => {
    const { sear } = await import('../src/engine/item-actions.js');
    const combat = arena('hydra');
    const head = living(combat, 'hydra_head')[0];
    head.alive = false;
    head.lastDamageTypes = ['slash'];
    combat.hooks.fire('kill', { combat, target: head, unit: head, say: () => {} });
    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    expect(sear(combat).seared).toBeTruthy();
    combat.hooks.fire('roundEnd', { combat, say: () => {} });
    expect(living(combat, 'hydra_head').length).toBe(2);
  });

  it('kills every head with the body', () => {
    const combat = arena('hydra');
    const body = find(combat, 'hydra');
    body.alive = false;
    combat.hooks.fire('kill', { combat, target: body, unit: body, say: () => {} });
    expect(living(combat, 'hydra_head')).toHaveLength(0);
  });

  it('lets Grukk beg, and answers him both ways', () => {
    const combat = arena('grukk');
    const grukk = find(combat, 'grukk');
    grukk.hp = Math.floor(grukk.maxHp * 0.2);
    combat.hooks.fire('damageTaken', { combat, target: grukk, say: () => {} });
    expect(combat.offer).toMatchObject({ kind: 'cowardsGold', gold: 200 });

    // Taking it: the gold, and he is gone — no XP, no unique item.
    const taken = answerOffer(combat, true);
    expect(taken).toMatchObject({ accepted: true, gold: 200 });
    expect(combat.hero.gold).toBe(200);
    expect(grukk.fled).toBe(true);
    expect(grukk.alive).toBe(false);

    // Refusing is the rest of the fight.
    const other = arena('grukk');
    const king = find(other, 'grukk');
    king.hp = Math.floor(king.maxHp * 0.2);
    other.hooks.fire('damageTaken', { combat: other, target: king, say: () => {} });
    expect(answerOffer(other, false)).toMatchObject({ accepted: false });
    expect(king.alive).toBe(true);
    expect(other.offer).toBe(null);
  });

  it('douses the Colossus when a valve breaks, once each', () => {
    const combat = arena('forge_colossus');
    const colossus = find(combat, 'forge_colossus');
    colossus.hp = Math.floor(colossus.maxHp * 0.4);
    combat.hooks.fire('damageTaken', { combat, target: colossus, say: () => {} });
    expect(colossus.stoked).toBe(true);

    const valve = combat.units.find((one) => one.type === 'coolant_valve');
    valve.alive = false;
    combat.hooks.fire('kill', { combat, target: valve, unit: valve, say: () => {} });
    expect(colossus.stoked).toBe(false);
    expect(has(colossus, 'stunned')).toBe(true);
    // And the furnace stays out.
    combat.hooks.fire('damageTaken', { combat, target: colossus, say: () => {} });
    expect(colossus.stoked).toBe(false);
  });

  it('wards the Grimoire while a wraith stands, and turns a page a round', () => {
    const combat = arena('bound_grimoire');
    const book = find(combat, 'bound_grimoire');
    const payload = { combat, target: book, parts: [], allPartsMultiplier: 1 };
    combat.hooks.fire('damageCalc', payload);
    expect(payload.allPartsMultiplier).toBe(0.5);

    for (const wraith of living(combat, 'ink_wraith')) wraith.alive = false;
    const clear = { combat, target: book, parts: [], allPartsMultiplier: 1 };
    combat.hooks.fire('damageCalc', clear);
    expect(clear.allPartsMultiplier).toBe(1);

    const page = turnThePage(combat, book, { rerolls: 1 });
    expect(page.page).toBeGreaterThanOrEqual(1);
    expect(page.page).toBeLessThanOrEqual(6);
    expect(book.page).toBe(page.id);
  });

  it('re-forms the Lich while the Phylactery is whole', () => {
    const combat = arena('malgorath');
    const lich = find(combat, 'malgorath');
    const vessel = combat.units.find((one) => one.type === 'phylactery');

    lich.hp = 0;
    expect(zeroHp(combat, lich, { cause: 'test' })).toMatchObject({ fallen: true });
    expect(lich.fallen).toMatchObject({ hp: lich.maxHp });

    // With the vessel broken, he dies like anything else.
    vessel.alive = false;
    const other = arena('malgorath');
    const second = find(other, 'malgorath');
    other.units.find((one) => one.type === 'phylactery').alive = false;
    second.hp = 0;
    expect(zeroHp(other, second, { cause: 'test' })).toMatchObject({ died: true });
  });

  it('rests the Gaze two rounds after it is used (06 section 12)', () => {
    const combat = arena('malgorath');
    const lich = find(combat, 'malgorath');
    const ready = (round) => evaluate('ready(paralyzing_gaze)', { combat: { ...combat, round }, unit: lich });
    expect(ready(1)).toBe(true);
    spend(lich, 'paralyzing_gaze', 1);
    expect([ready(2), ready(3), ready(4)]).toEqual([false, false, true]);
  });

  it('halves what the Phylactery takes while the Lich stands', () => {
    const combat = arena('malgorath');
    const vessel = combat.units.find((one) => one.type === 'phylactery');
    const guarded = { combat, target: vessel, parts: [], allPartsMultiplier: 1 };
    combat.hooks.fire('damageCalc', guarded);
    expect(guarded.allPartsMultiplier).toBe(0.5);

    find(combat, 'malgorath').alive = false;
    const open = { combat, target: vessel, parts: [], allPartsMultiplier: 1 };
    combat.hooks.fire('damageCalc', open);
    expect(open.allPartsMultiplier).toBe(1);
  });
});

describe('every boss fights to the end', () => {
  it.each(bossIds().map((id) => [id]))('%s', (id) => {
    const played = playBoss(id, { seed: 4231 });
    expect([id, played.problems]).toEqual([id, []]);
    expect(['victory', 'defeat', 'fled']).toContain(played.outcome);
    if (played.outcome === 'victory') {
      // The XP is the boss's own, plus whatever came with it.
      expect(played.summary.xp).toBeGreaterThanOrEqual(BOSSES[id].xp);
      expect(played.summary.loot.some((drop) => drop.baseId === rewardOf(id).item)).toBe(true);
    }
  });
});

describe('the balance pass (docs/DECISIONS.md)', () => {
  it('lays each boss’s own scales over the shared ones', () => {
    for (const id of bossIds()) {
      expect(bossTuning(id)).toEqual({ ...BOSS_TUNING, ...(BOSSES[id].tuning ?? {}) });
    }
  });

  it('scales the boss’s side, its arena objects, and what it deals — never the hero', () => {
    const hero = () => standInHero({ name: 'Harrow', hp: 200, maxHp: 200, level: 16 });
    const scaled = createFight({ hero: hero(), boss: 'malgorath', masterSeed: 3, surprise: false });
    const plain = createFight({ hero: hero(), boss: 'malgorath', masterSeed: 3, surprise: false, bossTuning: { hpScale: 1, objectHpScale: 1, damageScale: 1 } });
    const { hpScale, objectHpScale } = bossTuning('malgorath');
    const lich = (fight) => fight.combat.units.find((unit) => unit.type === 'malgorath');
    const vessel = (fight) => fight.combat.units.find((unit) => unit.type === 'phylactery');
    expect(lich(plain).maxHp).toBe(180);
    expect(lich(scaled).maxHp).toBe(Math.round(180 * hpScale));
    expect(vessel(scaled).maxHp).toBe(Math.round(60 * objectHpScale));
    expect(scaled.combat.units.find((unit) => unit.side === 'hero').maxHp).toBe(200);
  });
});
