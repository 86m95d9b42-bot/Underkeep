/**
 * Save version 1 is locked (`00`, Launch checklist).
 *
 * `fixtures/save-v1.json` is a real save written by the first shipped build:
 * floor 1, a dozen steps in, one turn into a fight. Every later build must
 * still open it — directly while the game writes version 1, through the
 * migration chain once it writes version 2. If this fails after a change to
 * what a save holds, the fix is a new version and a migration
 * (`src/save/migrations.js`), never a new fixture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decode, verify } from '../src/save/codec.js';
import { migrate } from '../src/save/migrations.js';
import { restoreSession } from '../src/save/snapshot.js';
import { flyOneTurn } from '../tools/lib/simulator.js';

const text = readFileSync(new URL('./fixtures/save-v1.json', import.meta.url), 'utf8');

describe('a version 1 save from the first build', () => {
  it('is still a sealed, whole version 1 save', async () => {
    const save = decode(text);
    expect(save.version).toBe(1);
    expect(await verify(save)).toBe(true);
  });

  it('opens in this build, back in the fight it was saved in', () => {
    const { save } = migrate(decode(text));
    const game = restoreSession(save);
    expect(game.hero.name).toBe(save.hero.name);
    expect(game.run.floor.floor).toBe(1);
    expect(game.run.ex.pos).toEqual(save.location.pos);
    expect(game.fight).toBeTruthy();
    expect(game.fight.log).toEqual(save.combat.log);
  });

  it('plays on from there to the end of the fight', () => {
    const game = restoreSession(migrate(decode(text)).save);
    for (let turn = 0; turn < 200 && !game.fight.over; turn += 1) flyOneTurn(game.fight);
    expect(game.fight.over).toBe(true);
  });
});
