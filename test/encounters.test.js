/**
 * What a step on the map leads to (`05` section 1, `03` sections 4, 5 and 7,
 * `02` section 14): the fights the dungeon starts, and the stairs between
 * floors. `session.follow` reads what a step or a use handed back and does it.
 */
import { describe, it, expect } from 'vitest';
import { createSession } from '../src/systems/session.js';
import { createCombat } from '../src/engine/field.js';
import { createStream } from '../src/engine/rng.js';
import { makeMonster } from '../src/data/monsters.js';
import { loopHero } from '../tools/lib/looper.js';
import { walkFloor } from '../tools/lib/walker.js';
import * as inventory from '../src/systems/inventory.js';

function game(seed = 4242, floor = 1) {
  const session = createSession({ hero: loopHero(seed), seed });
  session.descend({ floor });
  return session;
}

describe('the fights the dungeon starts', () => {
  it('does nothing for a step that called nothing up', () => {
    const session = game();
    expect(session.follow({ events: [{ type: 'wanderingCheck', encounter: false }] })).toEqual({ next: null });
    expect(session.fight).toBe(null);
  });

  it('starts a wandering fight from the floor’s own table', () => {
    const session = game();
    expect(session.follow({ events: [{ type: 'wanderingCheck', encounter: true }] })).toEqual({ next: 'combat' });
    expect(session.fight.combat.units.some((unit) => unit.side === 'monsters')).toBe(true);
    expect(session.fight.combat.boss ?? null).toBe(null);
  });

  it('gives a noisy trap’s monsters the ambush (03 section 4)', () => {
    const session = game();
    session.follow({ events: [{ type: 'noiseCheck', encounter: true, surprise: true }] });
    expect(session.fight.combat.monsterSurpriseOn).toBe(6);
  });

  it('wakes a Mimic, a Sarcophagus’s dead, and the Hollow Stalker', () => {
    const mimic = game();
    mimic.follow({ events: [], mimic: true, outcome: { surprise: true } });
    expect(mimic.fight.combat.units.find((unit) => unit.side === 'monsters').type).toBe('mimic');

    const tomb = game();
    tomb.follow({ events: [], fight: ['skeleton'] });
    expect(tomb.fight.combat.units.find((unit) => unit.side === 'monsters').type).toBe('skeleton');

    const stalked = game();
    stalked.follow({ events: [{ type: 'stalker', monsters: [makeMonster('hollow_stalker', { floor: 1 })] }] });
    expect(stalked.fight.combat.units.find((unit) => unit.side === 'monsters').type).toBe('hollow_stalker');
  });

  it('answers the fight already under way rather than starting another', () => {
    const session = game();
    session.follow({ events: [{ type: 'wanderingCheck', encounter: true }] });
    const first = session.fight;
    expect(session.follow({ events: [{ type: 'wanderingCheck', encounter: true }] })).toEqual({ next: 'combat' });
    expect(session.fight).toBe(first);
  });
});

describe('the boss arena (05 section 1, Boss gates)', () => {
  it('meets the boss at the arena door, and never again once it has fallen', () => {
    const session = game();
    let arena = null;
    walkFloor(4242, 1, {
      run: session.run,
      onEvents: (events) => {
        const met = events.find((event) => event.type === 'arena');
        if (met) {
          arena = met;
          return 'stop';
        }
        return undefined;
      },
    });
    expect(arena).toEqual({ type: 'arena', floor: 1 });
    expect(session.follow({ events: [arena] })).toEqual({ next: 'combat' });
    expect(session.fight.combat.boss).toBe('rat_king');

    session.endFight();
    session.bossBeaten(1);
    expect(session.follow({ events: [arena] })).toEqual({ next: null });
  });
});

describe('the stairs (05 section 1)', () => {
  it('goes down only past a beaten boss, and down is the same trip', () => {
    const session = game();
    const trips = session.town.trips;
    expect(session.follow({ events: [{ type: 'stairs', direction: 'down' }] })).toEqual({ next: null });
    session.bossBeaten(1);
    expect(session.follow({ events: [{ type: 'stairs', direction: 'down' }] })).toEqual({ next: 'floor' });
    expect(session.run.floor.floor).toBe(2);
    expect(session.run.ex.pos).toEqual(session.run.floor.stairs.up);
    expect(session.town.trips).toBe(trips);
  });

  it('goes up onto the down stairs of the floor above, facing out of the alcove', () => {
    const session = game(4242, 2);
    expect(session.follow({ events: [{ type: 'stairs', direction: 'up' }] })).toEqual({ next: 'floor' });
    const { floor, ex } = session.run;
    expect(floor.floor).toBe(1);
    expect(ex.pos).toEqual(floor.stairs.down);
    const ahead = [[0, -1], [1, 0], [0, 1], [-1, 0]][ex.facing];
    expect(floor.map[ex.pos[1] + ahead[1]][ex.pos[0] + ahead[0]]).not.toBe(1);
  });

  it('leaves for town by floor 1’s up stairs', () => {
    const session = game();
    expect(session.follow({ events: [{ type: 'stairs', direction: 'up' }] })).toEqual({ next: 'town' });
    expect(session.inDungeon).toBe(false);
  });
});

describe('an ambush (03 sections 4, 5 and 7)', () => {
  it('lets the monsters surprise on any roll, unless the hero cannot be surprised', () => {
    const hero = { id: 'hero', name: 'Harrow', hp: 10, maxHp: 10 };
    for (let i = 0; i < 20; i += 1) {
      const combat = createCombat({ hero, monsters: [makeMonster('giant_rat')], rng: createStream(`ambush-${i}`, 'combat'), ambush: true });
      // Only the hero's own 1 on the die can cancel it: both sides surprised is no surprise.
      expect(combat.surprise.heroSurprised).toBe(true);
    }
    const wary = { ...hero, cannotBeSurprised: true };
    const combat = createCombat({ hero: wary, monsters: [makeMonster('giant_rat')], rng: createStream('ambush-wary', 'combat'), ambush: true });
    expect(combat.surprise.heroSurprised).toBe(false);
  });
});

describe('camping (01 section 9, Resting)', () => {
  const withRations = (session, count = 3) => {
    const { addItem } = inventory;
    addItem(session.hero.pack, 'ration', { count, identified: true });
    return session;
  };

  it('needs a ration, and says so', () => {
    const session = game();
    session.hero.pack.items = session.hero.pack.items.filter((entry) => entry.baseId !== 'ration');
    expect(session.run.campReason).toBe('noRation');
    expect(session.camp()).toMatchObject({ why: 'noRation', next: null });
  });

  it('gives back half the hero’s HP and all FP, or a fight on a 1-2', () => {
    let rested = 0;
    let interrupted = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const session = withRations(game(seed));
      const { hero } = session;
      hero.hp = 1;
      hero.fp = 0;
      const rations = () => hero.pack.items.filter((e) => e.baseId === 'ration').reduce((n, e) => n + (e.count ?? 1), 0);
      const before = rations();
      const result = session.camp();
      expect(rations()).toBe(before - 1);
      if (result.next === 'combat') {
        interrupted += 1;
        // Interrupted before anything is recovered: the fight's first blows
        // may already have landed, but nothing came back.
        expect(result.events.map((event) => event.type)).toContain('campInterrupted');
        expect(result.events.some((event) => event.type === 'camped')).toBe(false);
        expect(hero.hp).toBeLessThanOrEqual(1);
        expect(hero.fp).toBe(0);
      } else {
        rested += 1;
        expect(hero.hp).toBe(1 + Math.floor(hero.maxHp / 2));
        expect(hero.fp).toBe(hero.maxFp);
      }
    }
    // A 1-2 on a d6: a third of the time, near enough.
    expect(interrupted).toBeGreaterThan(3);
    expect(rested).toBeGreaterThan(interrupted);
  });

  it('is never interrupted in the Safe Room (05 section 5)', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const session = withRations(game(seed));
      const room = session.run.floor.rooms.find((one) => one.role === 'safeRoom');
      const [x, y, w, h] = room.rect;
      session.run.ex.pos = [x + Math.floor(w / 2), y + Math.floor(h / 2)];
      session.hero.hp = 1;
      expect(session.camp().next).toBe(null);
    }
  });
});
