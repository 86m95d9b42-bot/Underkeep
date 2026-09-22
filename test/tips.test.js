/**
 * Floor 1's onboarding tips: one short sentence the first time the hero meets
 * a system, once a game, and one system per room (`docs/TASKS.md`).
 */
import { describe, it, expect } from 'vitest';
import { exploreTip, fightTip, offer, tipState, TIP_FLOORS } from '../src/systems/tips.js';
import { createSession } from '../src/systems/session.js';
import { createFight } from '../src/systems/fight.js';
import { makeMonster } from '../src/data/monsters.js';
import { loopHero } from '../tools/lib/looper.js';
import { walkFloor } from '../tools/lib/walker.js';
import { restoreSession, takeSnapshot } from '../src/save/snapshot.js';
import { decode, encode } from '../src/save/codec.js';
import { t } from '../src/data/strings.js';

const room = () => ({ current: null, tipped: false });

describe('which tip a moment calls for', () => {
  it('prefers what is in front of the hero to what they could always do', () => {
    expect(exploreTip([{ type: 'trapSprung' }], { context: 'search' })[0]).toBe('trap');
    expect(exploreTip([], { chestAhead: true, context: 'open' })[0]).toBe('chest');
    expect(exploreTip([{ type: 'blocked', looksLike: 'locked' }])[0]).toBe('door');
    expect(exploreTip([{ type: 'blocked', looksLike: 'wall' }], { context: 'search' })).toEqual(['search']);
    expect(exploreTip([{ type: 'arrived' }, { type: 'waystone' }])).toEqual(['move', 'waystone']);
  });

  it('has a sentence for every tip it can give', () => {
    for (const id of ['move', 'waystone', 'search', 'door', 'chest', 'trap', 'hazard', 'safeRoom', 'stairs', 'wandering', 'hurt', 'fight', 'telegraph', 'slime', 'flee']) {
      expect([id, t(`tips.${id}`)]).toEqual([id, expect.stringMatching(/^Tip: /)]);
    }
  });
});

describe('one system per room, once a game, on floor 1', () => {
  it('teaches only on floor 1', () => {
    expect(TIP_FLOORS).toEqual([1]);
    const state = { seen: [] };
    expect(offer({ state, room: room(), floor: 2, roomId: 'r1', events: [{ type: 'arrived' }] })).toBe(null);
    expect(offer({ state, room: room(), floor: 1, roomId: 'r1', events: [{ type: 'arrived' }] })).toBe('move');
  });

  it('gives each tip once a game', () => {
    const state = { seen: ['move'] };
    expect(offer({ state, room: room(), floor: 1, roomId: 'r1', events: [{ type: 'arrived' }] })).toBe(null);
  });

  it('teaches one system in a room, and the next in the next room', () => {
    const state = { seen: [] };
    const where = room();
    expect(offer({ state, room: where, floor: 1, roomId: 'r1', events: [{ type: 'trapSprung' }] })).toBe('trap');
    // The chest in the same room waits.
    expect(offer({ state, room: where, floor: 1, roomId: 'r1', events: [], here: { chestAhead: true } })).toBe(null);
    // A corridor belongs to the room the hero came out of.
    expect(offer({ state, room: where, floor: 1, roomId: null, events: [], here: { chestAhead: true } })).toBe(null);
    // A new room opens again, and the chest is taught the next time it comes up.
    expect(offer({ state, room: where, floor: 1, roomId: 'r2', events: [], here: { chestAhead: true } })).toBe('chest');
  });

  it('keeps what has been taught in the town, so it is saved', () => {
    const town = {};
    tipState(town).seen.push('move');
    expect(town.tips.seen).toEqual(['move']);
  });
});

describe('on a real walk down floor 1', () => {
  it('opens with how to move, and never teaches two things in one room', () => {
    for (const seed of [4242, 77, 9001]) {
      const game = createSession({ hero: loopHero(seed), seed });
      const run = game.descend({ floor: 1 });
      expect(run.log.at(-1)).toEqual({ text: t('tips.move'), tone: 'tip' });
      const rooms = [];
      let taught = game.town.tips.seen.length;
      walkFloor(seed, 1, {
        run,
        onEvents: () => {
          if (game.town.tips.seen.length > taught) {
            taught = game.town.tips.seen.length;
            const at = run.floor.rooms.find(({ rect: [x, y, w, h] }) => {
              const [px, py] = run.ex.pos;
              return px >= x && px < x + w && py >= y && py < y + h;
            });
            rooms.push(at?.id ?? null);
          }
          return undefined;
        },
      });
      const named = rooms.filter(Boolean);
      expect([seed, new Set(named).size]).toEqual([seed, named.length]);
    }
  });

  it('teaches nothing on floor 2', () => {
    const game = createSession({ hero: loopHero(5), seed: 5 });
    const run = game.descend({ floor: 2 });
    expect(run.log.some((line) => line.tone === 'tip')).toBe(false);
  });

  it('remembers across a save which room last taught, and what has been taught', () => {
    const game = createSession({ hero: loopHero(4242), seed: 4242 });
    game.descend({ floor: 1 });
    const back = restoreSession(decode(encode(takeSnapshot(game))));
    expect(back.town.tips.seen).toEqual(['move']);
    // The restored trip does not greet the hero again.
    expect(back.run.log.filter((line) => line.tone === 'tip')).toHaveLength(1);
  });
});

describe('a fight on floor 1', () => {
  const hero = () => loopHero(12);

  it('teaches targeting in the first fight, and the slime where there is one', () => {
    const first = { seen: [] };
    const plain = createFight({ hero: hero(), monsters: [makeMonster('giant_rat')], floor: 1, masterSeed: 2, surprise: false, tips: first });
    expect(plain.log.some((line) => line.text === t('tips.fight'))).toBe(true);

    const withSlime = { seen: [] };
    const slime = createFight({ hero: hero(), monsters: [makeMonster('green_slime')], floor: 1, masterSeed: 2, surprise: false, tips: withSlime });
    expect(slime.log.some((line) => line.text === t('tips.slime'))).toBe(true);
    expect(withSlime.seen).toEqual(['slime']);
  });

  it('teaches one thing a fight, and nothing without a tip record or off floor 1', () => {
    const state = { seen: [] };
    const fight = createFight({ hero: hero(), monsters: [makeMonster('giant_rat'), makeMonster('kobold')], floor: 1, masterSeed: 2, surprise: false, tips: state, logKept: 1000 });
    for (let i = 0; i < 40 && !fight.over; i += 1) fight.act('defend');
    expect(fight.log.filter((line) => line.tone === 'tip')).toHaveLength(1);

    const none = createFight({ hero: hero(), monsters: [makeMonster('giant_rat')], floor: 1, masterSeed: 2, surprise: false });
    expect(none.log.some((line) => line.tone === 'tip')).toBe(false);
    const deeper = createFight({ hero: hero(), monsters: [makeMonster('giant_rat')], floor: 2, masterSeed: 2, surprise: false, tips: { seen: [] } });
    expect(deeper.log.some((line) => line.tone === 'tip')).toBe(false);
  });

  it('warns of a wind-up at the hero’s turn when it is the first one seen', () => {
    const combat = {
      floor: 1,
      boss: null,
      hero: { hp: 20, maxHp: 20 },
      units: [{ side: 'monsters', alive: true, telegraph: { ability: 'x' } }],
    };
    expect(fightTip({ state: { seen: ['fight'] }, combat, moment: 'turn' })).toBe('telegraph');
    expect(fightTip({ state: { seen: ['fight'] }, combat, moment: 'turn' })).toBe(null);
  });
});
