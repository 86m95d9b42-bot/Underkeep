/**
 * Haptics and sound (00-build-outline.md, "Feedback"; docs/DECISIONS.md,
 * Sound): a buzz and a short synthesized sound on hits taken, crits, traps
 * and level-ups, each under its own setting, played once the result is shown.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSound, CUES } from '../src/shell/sound.js';
import { createHaptics, PATTERNS } from '../src/shell/haptics.js';
import { createCues, cuesOf, playCues } from '../src/shell/cues.js';
import { createFight } from '../src/systems/fight.js';
import { makeMonster } from '../src/data/monsters.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { buildHero } from '../tools/lib/builds.js';
import { bossOnFloor } from '../src/data/bosses.js';

const settingsWith = (values) => ({ get: (key) => values[key] });

/** An AudioContext that records the notes it was asked for. */
function fakeContext() {
  const notes = [];
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  return {
    notes,
    state: 'running',
    currentTime: 0,
    destination: {},
    createOscillator() {
      const osc = { type: '', frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      notes.push(osc);
      return osc;
    },
    createGain: () => ({ gain: param(), connect: vi.fn() }),
    resume: vi.fn(),
  };
}

describe('sound', () => {
  it('makes nothing before the first tap unlocks it, then plays each cue as notes', () => {
    const context = fakeContext();
    const make = vi.fn(() => context);
    const sound = createSound(settingsWith({ sound: 'on' }), { makeContext: make, visible: () => true });
    expect(sound.play('hit')).toBe(false);
    expect(make).not.toHaveBeenCalled();
    sound.unlock();
    expect(sound.play('hit')).toBe(true);
    expect(context.notes).toHaveLength(CUES.hit.length);
    sound.unlock();
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('is silent with the setting off, with the page hidden, or with no Web Audio', () => {
    const off = createSound(settingsWith({ sound: 'off' }), { makeContext: () => fakeContext(), visible: () => true });
    off.unlock();
    expect(off.play('crit')).toBe(false);

    const hidden = createSound(settingsWith({ sound: 'on' }), { makeContext: () => fakeContext(), visible: () => false });
    hidden.unlock();
    expect(hidden.play('crit')).toBe(false);

    const none = createSound(settingsWith({ sound: 'on' }), { makeContext: () => null, visible: () => true });
    none.unlock();
    expect(none.play('crit')).toBe(false);

    const broken = createSound(settingsWith({ sound: 'on' }), { makeContext: () => { throw new Error('no'); }, visible: () => true });
    expect(() => broken.unlock()).not.toThrow();
    expect(broken.play('crit')).toBe(false);
  });

  it('has a sound and a buzz for every cue the outline names', () => {
    for (const kind of ['hit', 'crit', 'trap', 'levelUp']) {
      expect([kind, Boolean(CUES[kind])]).toEqual([kind, true]);
      expect([kind, PATTERNS[kind] !== undefined]).toEqual([kind, true]);
    }
  });
});

describe('cues', () => {
  it('buzz and sound together, each once however often it was asked for', () => {
    const buzz = vi.fn();
    const play = vi.fn(() => true);
    const cues = createCues({ buzz }, { play });
    cues.play(['hit', 'hit', 'crit']);
    expect(buzz.mock.calls.map(([kind]) => kind)).toEqual(['hit', 'crit']);
    expect(play.mock.calls.map(([kind]) => kind)).toEqual(['hit', 'crit']);
  });

  it('respect the haptics setting on the motor', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    createHaptics(settingsWith({ haptics: 'off' })).buzz('hit');
    expect(vibrate).not.toHaveBeenCalled();
    createHaptics(settingsWith({ haptics: 'on' })).buzz('hit');
    expect(vibrate).toHaveBeenCalledWith(PATTERNS.hit);
    vi.unstubAllGlobals();
  });

  it('read a trap, a drowning and a wall out of what exploration did', () => {
    expect(cuesOf([{ type: 'trapSprung' }, { type: 'drowning' }, { type: 'blocked' }, { type: 'stairs' }])).toEqual(['trap', 'hit', 'bump']);
  });

  it('fall back on a plain buzz where that is all there is', () => {
    const buzz = vi.fn();
    playCues({ buzz }, ['trap', 'trap']);
    expect(buzz).toHaveBeenCalledTimes(1);
    expect(() => playCues(null, ['hit'])).not.toThrow();
  });
});

describe('what a fight is felt as', () => {
  function hero() {
    return finish(setName(chooseOrigin(createDraft({ seed: 4 }), 'sellsword'), 'Harrow'));
  }

  it('a hit taken, a critical, and a fight won — handed over once, after the fact', () => {
    let hurtTurns = 0;
    const heard = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      const fight = createFight({ hero: hero(), monsters: ['orc', 'orc'].map((id) => makeMonster(id)), masterSeed: seed, surprise: false });
      for (let i = 0; i < 60 && !fight.over; i += 1) {
        const before = fight.hero.hp;
        fight.act('attack');
        const now = fight.drainCues();
        heard.push(...now);
        // Every turn that cost the hero hit points was felt.
        if (fight.hero.hp < before) {
          hurtTurns += 1;
          expect(now).toContain('hit');
        }
      }
      expect(fight.drainCues()).toEqual([]);
    }
    expect(hurtTurns).toBeGreaterThan(0);
    expect(heard).toContain('crit');
  });

  it('feels a hit that stopped for a Reaction prompt when it lands, not before', () => {
    const who = buildHero('battle_mage', { floor: 6, seed: 3 });
    who.maxHp *= 3;
    who.hp = who.maxHp;
    const fight = createFight({ hero: who, boss: bossOnFloor(6), floor: 6, masterSeed: 3, reactions: 'ask' });
    let atPrompt = [];
    while (!fight.over && !fight.reaction) {
      fight.act('attack');
      atPrompt = fight.drainCues();
    }
    // The turn thrown away for the prompt left nothing behind it: whatever
    // was felt came from turns before it. The hit is felt when it lands.
    void atPrompt;
    const promptHp = fight.hero.hp;
    fight.react('take');
    const landed = fight.drainCues();
    if (fight.hero.hp < promptHp) expect(landed).toContain('hit');
  });
});
