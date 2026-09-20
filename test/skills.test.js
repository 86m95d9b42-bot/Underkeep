/**
 * The skill tree (`01` section 6).
 *
 * The document's own counts are the spine of this file: four Paths, four
 * tiers, 51 skills, 68 points, and every skill in the section's tables with
 * the ranks it lists. The rest is the effect vocabulary — that a passive which
 * is a number really lands on the hero's sheet, and that a hook effect names
 * an event the engine fires.
 */
import { describe, it, expect } from 'vitest';
import { equipNew } from '../src/systems/inventory.js';
import { rebuildSheet } from '../src/systems/levelling.js';
import {
  CROSSROADS,
  PATHS,
  SKILLS,
  TIERS,
  actionOf,
  amountOf,
  gateFor,
  handlerNames,
  hookEffects,
  isCrossroads,
  requirementOf,
  sheetEffects,
  skill,
  skillFor,
  skillIds,
  skillsOfPath,
  skillsOfTier,
  totalSkillPoints,
} from '../src/data/skills.js';
import {
  HANDLERS,
  PENDING,
  applySkillSheet,
  isLive,
  registerSkills,
} from '../src/engine/skill-hooks.js';
import { EVENTS } from '../src/engine/hooks.js';
import { createHooks } from '../src/engine/hooks.js';
import { createCombat } from '../src/engine/field.js';
import { registerRules } from '../src/engine/rules.js';
import { makeMonster } from '../src/data/monsters.js';
import { carriedStreams } from '../src/engine/rng.js';
import { resolveAttack } from '../src/engine/attack.js';
import { zeroHp } from '../src/engine/defeat.js';
import { finish, setName, chooseOrigin, createDraft } from '../src/systems/creation.js';

/** A level 1 hero with a known sheet, before any skill touches it. */
function hero(skills = []) {
  const made = finish(
    setName(
      chooseOrigin(
        {
          ...createDraft({ seed: 1 }),
          scores: { might: 15, agility: 12, vigor: 14, intellect: 9, wits: 13, luck: 8 },
        },
        'sellsword',
      ),
      'Harrow',
    ),
  );
  // A hero who already knows these, the way a loaded save arrives: the sheet
  // is recomputed and nothing is healed by it, so the hero starts full.
  made.skills = skills;
  applySkillSheet(made);
  made.hp = made.maxHp;
  made.fp = made.maxFp;
  return made;
}

describe('the shape of the tree (01 section 6)', () => {
  it('is four Paths of four tiers, plus the Crossroads', () => {
    expect(Object.keys(PATHS)).toEqual(['blade', 'shadow', 'arcana', 'spirit']);
    expect(TIERS.map((row) => row.tier)).toEqual([1, 2, 3, 4]);
    expect(CROSSROADS).toEqual({ cost: 1, pointsInEachPath: 4 });
  });

  it('opens a tier at 0, 3, 6 and 10 points spent in the Path', () => {
    expect([1, 2, 3, 4].map(gateFor)).toEqual([0, 3, 6, 10]);
    expect(() => gateFor(5)).toThrow(/no tier/);
  });

  it('holds 51 skills and the 68 points the document counts', () => {
    expect(skillIds()).toHaveLength(51);
    expect(totalSkillPoints()).toBe(68);
  });

  it('holds each Path’s own skills, in the numbers the tables give', () => {
    // Blade 11 skills and 17 points, Shadow 12 and 19, Arcana 12 and 14,
    // Spirit 10 and 12 — which is 62, and six Crossroads make 68.
    const counted = (path) => {
      const ids = skillsOfPath(path);
      return [ids.length, ids.reduce((total, id) => total + SKILLS[id].ranks, 0)];
    };
    expect(counted('blade')).toEqual([11, 17]);
    expect(counted('shadow')).toEqual([12, 19]);
    expect(counted('arcana')).toEqual([12, 14]);
    expect(counted('spirit')).toEqual([10, 12]);
    expect(skillsOfPath('crossroads')).toHaveLength(6);
  });

  it('names the skills the document names, tier by tier', () => {
    expect(skillsOfTier('blade', 1)).toEqual([
      'weapon_training',
      'power_strike',
      'toughness',
      'brute_force',
    ]);
    expect(skillsOfTier('blade', 4)).toEqual(['juggernaut']);
    expect(skillsOfTier('arcana', 2)).toEqual(['sleep', 'frost_shard', 'dispel_ward', 'arcane_shield']);
    expect(skillsOfTier('spirit', 3)).toEqual(['regeneration', 'spirit_ward', 'smite']);
  });

  it('gives every capstone its attribute of 15', () => {
    const capstones = skillIds().filter((id) => SKILLS[id].tier === 4);
    expect(capstones).toEqual(['juggernaut', 'death_strike', 'archmage', 'undying']);
    for (const id of capstones) {
      expect([id, requirementOf(id)]).toEqual([
        id,
        { attribute: expect.any(String), score: 15 },
      ]);
    }
  });

  it('makes each Crossroads skill join two Paths for 1 point', () => {
    const hybrids = skillsOfPath('crossroads');
    expect(hybrids).toEqual([
      'duelist',
      'spellblade',
      'crusader',
      'arcane_trickster',
      'ranger',
      'mystic',
    ]);
    for (const id of hybrids) {
      expect(isCrossroads(id)).toBe(true);
      expect([id, skill(id).paths]).toEqual([id, [expect.any(String), expect.any(String)]]);
      expect([id, skill(id).ranks]).toEqual([id, 1]);
    }
  });

  it('gives every active skill a cost and something to do', () => {
    for (const id of skillIds()) {
      if (SKILLS[id].type !== 'active') continue;
      expect([id, typeof skill(id).fp]).toEqual([id, 'number']);
      expect([id, Boolean(actionOf(id))]).toEqual([id, true]);
    }
  });

  it('carries the words a player reads in strings.json', () => {
    const marksman = skillFor('marksman');
    expect(marksman.name).toBe('MARKSMAN');
    expect(marksman.effect).toContain('ranged');
    expect(() => skill('sword_dancing')).toThrow(/unknown skill/);
  });
});

describe('the effect vocabulary', () => {
  it('hangs every hook effect on an event 06 section 16 fires', () => {
    for (const id of skillIds()) {
      for (const effect of skill(id).effects ?? []) {
        if (!effect.hook) continue;
        expect([id, EVENTS.includes(effect.hook)]).toEqual([id, true]);
      }
    }
  });

  it('gives every handler an implementation or a reason it waits', () => {
    for (const name of handlerNames()) {
      expect([name, Boolean(HANDLERS[name] || PENDING[name])]).toEqual([name, true]);
    }
  });

  it('counts a per-rank effect by the rank, and a flat one once', () => {
    const toughness = sheetEffects('toughness', 3)[0];
    expect(amountOf(toughness, 1)).toBe(5);
    expect(amountOf(toughness, 3)).toBe(15);
    const juggernaut = sheetEffects('juggernaut')[0];
    expect(amountOf(juggernaut)).toBe(2);
  });

  it('holds back an effect until its rank', () => {
    // Keen Senses R2 is what stops the hero being surprised.
    expect(sheetEffects('keen_senses', 1).map((effect) => effect.sheet)).toEqual([]);
    expect(sheetEffects('keen_senses', 2).map((effect) => effect.sheet)).toEqual([
      'cannotBeSurprised',
    ]);
  });
});

describe('what a skill does to the sheet', () => {
  it('adds hit points, and hands over the ones it added', () => {
    const plain = hero();
    const tough = hero([{ id: 'toughness', rank: 2 }]);
    expect(tough.maxHp).toBe(plain.maxHp + 10);
    expect(tough.hp).toBe(tough.maxHp);
  });

  it('adds Focus, attack, Defense and saves', () => {
    const plain = hero();
    const learned = hero([
      { id: 'arcane_well', rank: 2 },
      { id: 'weapon_training', rank: 3 },
      { id: 'marksman', rank: 1 },
      { id: 'evasion', rank: 1 },
      { id: 'resilience', rank: 2 },
    ]);
    expect(learned.maxFp).toBe(plain.maxFp + 6);
    expect(learned.atk).toBe(plain.atk + 3);
    expect(learned.attacks.ranged).toBe(plain.attacks.ranged + 1);
    expect(learned.def).toBe(plain.def + 1);
    expect(learned.saves.body).toBe(plain.saves.body + 4);
    expect(learned.saves.mind).toBe(plain.saves.mind + 4);
  });

  it('widens the critical range and triples the dice, for Weapon Mastery', () => {
    const master = hero([{ id: 'weapon_mastery', rank: 1 }]);
    expect(master.critFrom).toBe(19);
    expect(master.critDice).toBe(3);
  });

  it('gives Juggernaut two attacks, and Sneak a wider surprise', () => {
    expect(hero([{ id: 'juggernaut', rank: 1 }]).attacksPerAction).toBe(2);
    expect(hero([{ id: 'sneak', rank: 1 }]).surpriseOn).toBe(2);
    expect(hero([{ id: 'keen_senses', rank: 2 }]).cannotBeSurprised).toBe(true);
  });

  it('is applied from the same base every time, so nothing compounds', () => {
    const learning = hero([{ id: 'toughness', rank: 1 }]);
    const once = learning.maxHp;
    applySkillSheet(learning);
    applySkillSheet(learning);
    expect(learning.maxHp).toBe(once);
  });

  it('applies a conditional bonus only while the pack says it holds', () => {
    // Duelist's +1 DEF is "while not using a shield", and the pack is what
    // knows (`01` section 6, `04` section 1).
    const plain = hero();
    const duelist = hero([{ id: 'duelist', rank: 1 }]);
    expect(duelist.def).toBe(plain.def + 1);
    expect(duelist.lightWeaponAttribute).toBe('agility');

    equipNew(duelist.pack, 'shield');
    rebuildSheet(duelist);
    expect(duelist.def).toBe(plain.def + 1); // the shield's own +1, not Duelist's
  });
});

describe('what a skill does in a fight', () => {
  /** A fight with the hero's skills registered, as the game registers them. */
  function fightWith(skills) {
    const hooks = createHooks();
    const rng = carriedStreams(5);
    const combat = createCombat({
      hero: hero(skills),
      monsters: [makeMonster('giant_rat', { floor: 1 })],
      rng: rng.combat,
      hooks,
      surprise: false,
    });
    combat.round = 1;
    // `registerRules` registers the hero's own skills and gear as well now,
    // which is how a real fight is set up (`06` section 16).
    registerRules(combat);
    return combat;
  }

  it('gives Mana Siphon its Focus back on a kill', () => {
    const combat = fightWith([{ id: 'mana_siphon', rank: 1 }]);
    combat.hero.fp = 0;
    combat.rng.d20 = () => 18;
    resolveAttack(combat, combat.hero, { target: 'giant_rat-1', damage: '2d6+4 slash' });
    expect(combat.units[1].alive).toBe(false);
    expect(combat.hero.fp).toBe(1);
  });

  it('heals the Crusader on every melee hit, and not on a miss', () => {
    const combat = fightWith([{ id: 'crusader', rank: 1 }]);
    combat.hero.hp = 10;
    combat.rng.d20 = () => 2;
    resolveAttack(combat, combat.hero, { target: 'giant_rat-1', damage: '1d4 slash' });
    expect(combat.hero.hp).toBe(10);

    combat.rng.d20 = () => 18;
    resolveAttack(combat, combat.hero, { target: 'giant_rat-1', damage: '1 slash' });
    expect(combat.hero.hp).toBe(12);
  });

  it('heals Regeneration at the start of the hero’s turn', () => {
    const combat = fightWith([{ id: 'regeneration', rank: 1 }]);
    combat.hero.hp = 5;
    combat.hooks.fire('turnStart', { combat, unit: combat.hero, phase: 'start', rng: combat.rng });
    expect(combat.hero.hp).toBe(6);
    // And never past the maximum.
    combat.hero.hp = combat.hero.maxHp;
    combat.hooks.fire('turnStart', { combat, unit: combat.hero, phase: 'start', rng: combat.rng });
    expect(combat.hero.hp).toBe(combat.hero.maxHp);
  });

  it('catches the hero with Undying, once per rest', () => {
    const combat = fightWith([{ id: 'undying', rank: 1 }]);
    combat.hero.hp = 0;
    expect(zeroHp(combat, combat.hero)).toMatchObject({ saved: true, savedBy: 'undying' });
    expect(combat.hero.hp).toBe(Math.floor(combat.hero.maxHp / 2));
    expect(combat.hero.alive).toBe(true);

    // The second time, nothing catches them: the limit is per rest.
    combat.hero.hp = 0;
    expect(zeroHp(combat, combat.hero)).toMatchObject({ died: true });
  });

  it('registers nothing for a skill whose handler is still waiting', () => {
    const combat = fightWith([{ id: 'cleave', rank: 1 }]);
    expect(combat.hooks.count('kill')).toBeGreaterThan(0);
    expect(isLive('cleave')).toBe(false);
    expect(PENDING.cleave).toMatch(/Phase/);
  });

  it('refuses a handler that is neither written nor listed', () => {
    const combat = fightWith([]);
    combat.hero.skills = [{ id: 'weapon_training', rank: 1 }];
    // A skill whose effects are all sheet effects registers nothing at all.
    expect(() => registerSkills(combat)).not.toThrow();
  });
});
