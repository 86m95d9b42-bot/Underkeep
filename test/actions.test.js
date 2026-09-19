/**
 * Action legality (`06` section 4, *Action Legality* and *Free Actions*).
 *
 * Every row of the section's table, and the rule the UI depends on: an illegal
 * action comes back with the reason, because a disabled button always says why.
 */
import { describe, it, expect } from 'vitest';
import combatData from '../src/data/combat.json' with { type: 'json' };
import strings from '../src/data/strings.json' with { type: 'json' };
import { createStream } from '../src/engine/rng.js';
import { createCombat } from '../src/engine/field.js';
import { legalityOf, menuFor, tagsOf, targetsFor } from '../src/engine/actions.js';
import { applyCondition } from '../src/engine/conditions.js';

const hero = (extra = {}) => ({ id: 'hero', hp: 12, maxHp: 12, fp: 4, maxFp: 4, protected: true, ...extra });
const monster = (type, extra = {}) => ({ type, hp: 6, maxHp: 6, row: 'front', ...extra });

function fight(monsters = [monster('rat')], heroExtra = {}) {
  return createCombat({
    hero: hero(heroExtra),
    monsters,
    rng: createStream('actions', 'combat'),
    surprise: false,
  });
}

const attack = { id: 'attack', kind: 'melee' };
const bowShot = { id: 'attack', kind: 'ranged' };
const meleeSkill = { id: 'skill', kind: 'melee', tags: ['attack'], fp: 2 };
const mend = { id: 'skill', tags: ['spirit'], fp: 2 };

describe('Feared', () => {
  it('blocks melee attacks and melee skills, and nothing else', () => {
    const combat = fight();
    applyCondition(combat.hero, 'feared', { dc: 12 });
    expect(legalityOf(combat, combat.hero, attack)).toMatchObject({ legal: false, why: 'feared' });
    expect(legalityOf(combat, combat.hero, meleeSkill)).toMatchObject({ legal: false, why: 'feared' });
    expect(legalityOf(combat, combat.hero, bowShot).legal).toBe(true);
    expect(legalityOf(combat, combat.hero, mend).legal).toBe(true);
  });
});

describe('Webbed', () => {
  it('blocks attacks, fleeing and swapping', () => {
    const combat = fight();
    applyCondition(combat.hero, 'webbed');
    for (const action of [attack, bowShot, meleeSkill, { id: 'flee' }, { id: 'swap' }]) {
      expect(legalityOf(combat, combat.hero, action)).toMatchObject({ legal: false, why: 'webbed' });
    }
  });

  it('allows Break Free, Defend, potions and non-attack skills', () => {
    const combat = fight();
    applyCondition(combat.hero, 'webbed');
    for (const action of [{ id: 'breakFree' }, { id: 'defend' }, { id: 'item' }, mend]) {
      expect(legalityOf(combat, combat.hero, action).legal).toBe(true);
    }
  });

  it('is the only time Break Free is on the menu', () => {
    const combat = fight();
    expect(legalityOf(combat, combat.hero, { id: 'breakFree' })).toMatchObject({
      legal: false,
      why: 'notWebbed',
    });
  });
});

describe('Grabbed', () => {
  it('blocks fleeing and swapping, but not attacking', () => {
    const combat = fight();
    applyCondition(combat.hero, 'grabbed', { source: 'rat-1' });
    expect(legalityOf(combat, combat.hero, { id: 'flee' }).why).toBe('grabbed');
    expect(legalityOf(combat, combat.hero, { id: 'swap' }).why).toBe('grabbed');
    expect(legalityOf(combat, combat.hero, attack).legal).toBe(true);
  });
});

describe('Blinded, Sickened and Knocked Down', () => {
  it('block nothing: they only give disadvantage', () => {
    const combat = fight();
    for (const id of ['blinded', 'sickened', 'knockedDown']) applyCondition(combat.hero, id);
    for (const action of [attack, bowShot, meleeSkill, { id: 'flee' }, { id: 'swap' }]) {
      expect(legalityOf(combat, combat.hero, action).legal).toBe(true);
    }
  });
});

describe('an Anti-Magic Field', () => {
  it('silences Arcana, Spirit and scrolls, and leaves steel alone', () => {
    const combat = fight();
    combat.antiMagic = true;
    expect(legalityOf(combat, combat.hero, mend).why).toBe('antiMagic');
    expect(legalityOf(combat, combat.hero, { id: 'skill', tags: ['arcana'], fp: 1 }).why).toBe('antiMagic');
    expect(legalityOf(combat, combat.hero, { id: 'item', tags: ['scroll'] }).why).toBe('antiMagic');
    expect(legalityOf(combat, combat.hero, attack).legal).toBe(true);
  });
});

describe('Focus', () => {
  it('dims a skill the hero cannot pay for', () => {
    const combat = fight();
    combat.hero.fp = 1;
    expect(legalityOf(combat, combat.hero, mend)).toMatchObject({ legal: false, why: 'notEnoughFp' });
    combat.hero.fp = 2;
    expect(legalityOf(combat, combat.hero, mend).legal).toBe(true);
  });
});

describe('fleeing', () => {
  it('is impossible in a boss fight', () => {
    const combat = fight();
    combat.boss = 'ratKing';
    expect(legalityOf(combat, combat.hero, { id: 'flee' })).toMatchObject({
      legal: false,
      why: 'noEscape',
    });
  });

  it('is impossible while a Frozen Revenant stands', () => {
    const combat = fight([monster('revenant', { preventsFlight: true })]);
    expect(legalityOf(combat, combat.hero, { id: 'flee' }).why).toBe('noEscape');
    combat.units[1].alive = false;
    expect(legalityOf(combat, combat.hero, { id: 'flee' }).legal).toBe(true);
  });
});

describe('targets', () => {
  it('keep a melee attack to the front row while anyone stands there', () => {
    const combat = fight([monster('rat'), monster('archer', { row: 'back' })]);
    expect(targetsFor(combat, combat.hero, attack).map((u) => u.id)).toEqual(['rat-1']);
    // A bow reaches both rows; the −2 cover is the attack rules' business.
    expect(targetsFor(combat, combat.hero, bowShot).map((u) => u.id)).toEqual(['rat-1', 'archer-1']);
  });

  it('let a melee attack reach the back row once the front row is empty', () => {
    const combat = fight([monster('rat'), monster('archer', { row: 'back' })]);
    combat.units[1].alive = false;
    expect(targetsFor(combat, combat.hero, attack).map((u) => u.id)).toEqual(['archer-1']);
  });

  it('let a Reach weapon hit the back row over the front', () => {
    const combat = fight([monster('rat'), monster('archer', { row: 'back' })]);
    const reach = { ...attack, reach: true };
    expect(targetsFor(combat, combat.hero, reach).map((u) => u.id)).toEqual(['rat-1', 'archer-1']);
  });

  it('dim an attack with nothing to hit', () => {
    const combat = fight([monster('rat')]);
    combat.units[1].alive = false;
    expect(legalityOf(combat, combat.hero, attack)).toMatchObject({ legal: false, why: 'noTarget' });
  });

  it('refuse a target the action cannot reach', () => {
    const combat = fight([monster('rat'), monster('archer', { row: 'back' })]);
    expect(legalityOf(combat, combat.hero, { ...attack, target: 'archer-1' }).why).toBe('badTarget');
    expect(legalityOf(combat, combat.hero, { ...attack, target: 'rat-1' }).legal).toBe(true);
  });

  it('aim a monster at the hero', () => {
    const combat = fight();
    expect(targetsFor(combat, combat.units[1], attack).map((u) => u.id)).toEqual(['hero']);
  });
});

describe('free actions', () => {
  it('are one a turn', () => {
    const combat = fight();
    const free = { id: 'item', free: true };
    expect(legalityOf(combat, combat.hero, free).legal).toBe(true);
    combat.hero.turn = { freeUsed: 1 };
    expect(legalityOf(combat, combat.hero, free)).toMatchObject({ legal: false, why: 'freeUsed' });
    // The main action is unaffected.
    expect(legalityOf(combat, combat.hero, attack).legal).toBe(true);
  });
});

describe('the menu the screen draws', () => {
  it('answers for every action, and never hides one', () => {
    const combat = fight();
    applyCondition(combat.hero, 'webbed');
    const menu = menuFor(combat, combat.hero, [attack, { id: 'defend' }, { id: 'flee' }]);
    expect(menu).toHaveLength(3);
    expect(menu.map((row) => row.legal)).toEqual([false, true, false]);
    expect(menu.map((row) => row.why)).toEqual(['webbed', undefined, 'webbed']);
  });

  it('has a line to show for every reason that is not a condition', () => {
    for (const reason of combatData.legality.reasons) {
      expect(strings.combat.illegal[reason]).toBeTruthy();
    }
  });

  it('refuses an action it has never heard of', () => {
    expect(legalityOf(fight(), hero(), { id: 'dance' })).toEqual({ legal: false, why: 'unknown' });
  });
});

describe('tags', () => {
  it('carry the action, the table, the kind and the caller together', () => {
    expect([...tagsOf(meleeSkill)].sort()).toEqual(['attack', 'melee', 'skill']);
    expect(tagsOf({ id: 'attack' }).has('melee')).toBe(true);
  });
});
