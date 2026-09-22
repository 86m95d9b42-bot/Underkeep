/**
 * @vitest-environment happy-dom
 *
 * Auto-Fight (`06` section 17): a potion below 30% HP from a quick slot,
 * otherwise a basic attack on the lowest-HP enemy in reach — stopping for a
 * telegraph, a new condition, an elite or boss, or low HP with no potion.
 */
import { describe, it, expect, vi } from 'vitest';
import { autoFight, autoTurn, potionFor, stopReason, whyNotAutoFight, DRINK_BELOW } from '../src/systems/auto-fight.js';
import { createFight } from '../src/systems/fight.js';
import { makeMonster } from '../src/data/monsters.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { createIdentification } from '../src/systems/identification.js';
import { addItem, pin } from '../src/systems/inventory.js';
import { applyCondition } from '../src/engine/conditions.js';
import { pause } from '../src/ui/screens/pause.js';

function hero({ potions = 0 } = {}) {
  const made = finish(setName(chooseOrigin(createDraft({ seed: 9 }), 'sellsword'), 'Harrow'));
  made.identification = createIdentification(9);
  if (potions) {
    const { entry } = addItem(made.pack, 'healing_potion', { count: potions, identified: true });
    pin(made.pack, entry.instanceId);
  }
  return made;
}

function fightWith(who, monsters = ['giant_rat', 'giant_rat', 'kobold']) {
  return createFight({ hero: who, monsters: monsters.map((id) => makeMonster(id)), masterSeed: 21, surprise: false });
}

describe('the two rules', () => {
  it('drinks a Healing Potion from a quick slot below 30% HP', () => {
    const who = hero({ potions: 2 });
    const fight = fightWith(who);
    who.hp = Math.floor(who.maxHp * DRINK_BELOW) - 1;
    expect(potionFor(fight)).toBeTruthy();
    expect(autoTurn(fight)).toBe('potion');
  });

  it('never drinks what it does not know is a Healing Potion', () => {
    const who = hero();
    const { entry } = addItem(who.pack, 'greater_healing_potion', { count: 1, identified: false });
    pin(who.pack, entry.instanceId);
    const fight = fightWith(who);
    expect(potionFor(fight)).toBe(null);
  });

  it('otherwise attacks the lowest-HP enemy it can reach', () => {
    const who = hero();
    const fight = fightWith(who);
    const reach = fight.legality('attack').targets.filter((unit) => unit.alive);
    const weakest = [...reach].sort((a, b) => a.hp - b.hp)[0];
    weakest.hp = 1;
    const act = vi.spyOn(fight, 'act');
    expect(autoTurn(fight)).toBe('attack');
    expect(act).toHaveBeenCalledWith('attack', { target: weakest.id });
  });
});

describe('when it stops (06 section 17)', () => {
  it('stops when a telegraph appears', () => {
    const fight = fightWith(hero());
    fight.combat.units.find((unit) => unit.side === 'monsters').telegraph = { ability: 'x', round: 1, heroTurnsAtWindUp: 0 };
    expect(stopReason(fight)).toBe('telegraph');
  });

  it('stops when the hero gains a condition, not for one they already had', () => {
    const who = hero();
    applyCondition(who, 'poisoned', { source: 'x' });
    const fight = fightWith(who);
    const had = new Set(Object.keys(who.conditions));
    expect(stopReason(fight, had)).toBe(null);
    applyCondition(who, 'weakened', { source: 'x' });
    expect(stopReason(fight, had)).toBe('condition');
  });

  it('will not start against a boss or an elite', () => {
    const boss = createFight({ hero: hero(), boss: 'rat_king', masterSeed: 3, surprise: false });
    expect(whyNotAutoFight(boss)).toBe('boss');
    const elite = makeMonster('kobold', { elite: true });
    const withElite = createFight({ hero: hero(), monsters: [elite], masterSeed: 3, surprise: false });
    if (withElite.combat.units.some((unit) => unit.elite)) expect(whyNotAutoFight(withElite)).toBe('boss');
  });

  it('stops when HP is below 30% with no potion left', () => {
    const who = hero();
    const fight = fightWith(who);
    who.hp = 1;
    expect(stopReason(fight)).toBe('lowHp');
  });

  it("stops for a Reaction prompt, which is the player's question", () => {
    const fight = fightWith(hero());
    Object.defineProperty(fight, 'reaction', { get: () => ({ key: 'r1' }) });
    expect(stopReason(fight)).toBe('reaction');
  });

  it('plays a routine fight until one of those is true, and says which', () => {
    const who = hero({ potions: 3 });
    const fight = fightWith(who, ['giant_rat', 'giant_rat']);
    const played = autoFight(fight);
    expect(played.turns).toBeGreaterThan(0);
    expect(['over', 'condition', 'lowHp', 'telegraph']).toContain(played.stoppedBy);
    if (played.stoppedBy === 'over') expect(fight.over).toBe(true);
  });
});

describe('the Pause Menu in a fight', () => {
  const routerFor = () => ({ has: () => true, go: vi.fn(), closeSheet: vi.fn() });
  const labels = (built) => [...built.sheet.querySelectorAll('button')].map((b) => b.textContent);

  it("offers AUTO-FIGHT in CAMP's place when opened from Combat", () => {
    const fight = fightWith(hero());
    const inFight = pause.build({ router: routerFor(), fight, params: { from: 'combat' } });
    expect(labels(inFight).some((text) => text.includes('AUTO-FIGHT'))).toBe(true);
    expect(labels(inFight).some((text) => text.startsWith('CAMP'))).toBe(false);
    const exploring = pause.build({ router: routerFor(), params: {} });
    expect(labels(exploring).some((text) => text.includes('AUTO-FIGHT'))).toBe(false);
  });

  it('says why it cannot be used against a boss', () => {
    const fight = createFight({ hero: hero(), boss: 'rat_king', masterSeed: 3, surprise: false });
    const built = pause.build({ router: routerFor(), fight, params: { from: 'combat' } });
    const auto = [...built.sheet.querySelectorAll('button')].find((b) => b.textContent.includes('AUTO-FIGHT'));
    expect(auto.disabled).toBe(true);
    expect(auto.textContent).toMatch(/Not against a boss or elite/);
  });

  it('plays the fight and writes why it stopped into the log', () => {
    const fight = fightWith(hero({ potions: 3 }), ['giant_rat']);
    const router = routerFor();
    const built = pause.build({ router, fight, params: { from: 'combat' } });
    [...built.sheet.querySelectorAll('button')].find((b) => b.textContent.includes('AUTO-FIGHT')).click();
    expect(fight.log.at(-1).text).toMatch(/^Auto-Fight stops:/);
    expect(router.closeSheet).toHaveBeenCalled();
  });
});
