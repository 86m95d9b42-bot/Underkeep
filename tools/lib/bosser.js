/**
 * Playing every boss to the end, and checking what happened against `02`.
 *
 * The fight audit (`tools/lib/fighter.js`) already checks that a fight obeys
 * `06`: every roll, every line, every death. This adds what only a boss has —
 * the mechanics the document builds each fight around — and reports on each
 * one, because a boss whose gimmick never fires is a boss nobody fought.
 *
 * What it watches for, boss by boss:
 *
 *   - the Rat King steps forward once its swarm is gone;
 *   - the Bone Warden raises its shield and cleaves;
 *   - Grukk begs at a quarter of his hit points;
 *   - the Brood Mother's eggs hatch;
 *   - the Hydra grows heads back, and its body is shielded while three live;
 *   - Veyra ascends into the front row below half;
 *   - a coolant valve stuns the Colossus;
 *   - the Grimoire turns a page every round and is warded while wraiths live;
 *   - Malgorath re-forms while the Phylactery stands;
 *   - Vyrmathrax runs its three phases and its flight cycle.
 */
import { playFight } from './fighter.js';
import { standInHero } from '../../src/systems/fight.js';
import { BOSSES, bossIds } from '../../src/data/bosses.js';

/**
 * A hero who can actually finish a deep boss: the numbers a level 15 hero in
 * good gear has, not the Phase 3 stand-in. The simulator of the next task is
 * what measures a real build; this one only needs the fight to run.
 */
export function bossHero(floor) {
  const scale = Math.max(1, floor);
  return standInHero({
    id: 'hero',
    name: 'Harrow',
    level: Math.min(20, 2 + scale * 2),
    hp: 60 + scale * 40,
    maxHp: 60 + scale * 40,
    fp: 10 + scale * 2,
    maxFp: 10 + scale * 2,
    atk: 4 + scale,
    def: 12 + Math.floor(scale * 0.8),
    saves: { body: scale, reflex: scale, mind: scale },
    attack: { name: 'sword', kind: 'melee', damage: `${Math.max(1, Math.ceil(scale / 2))}d8+${5 + scale} slash` },
  });
}

/** What the fight showed, boss by boss. */
function watchBoss(combat, id, seen) {
  const hooks = combat.hooks;
  const note = (what) => seen.add(what);

  hooks.on('roundStart', (payload) => {
    const boss = payload.combat.units.find((unit) => unit.type === id);
    if (!boss) return;
    if (boss.phase > 1) note(`phase${boss.phase}`);
    if (boss.state) note(`state:${boss.state}`);
    if (boss.page) note('page');
    if (boss.row === 'front' && BOSSES[id].row === 'back') note('steppedForward');
    if (boss.stoked) note('stoked');
    if (boss.tempered) note('tempered');
    if (boss.begged) note('begged');
    if (payload.combat.offer) note('offer');
  }, { name: 'audit', order: 99, source: 'audit' });

  hooks.on('kill', (payload) => {
    if (payload.target?.summoned) note('summonKilled');
    if (payload.target?.part) note('partKilled');
    if (payload.target?.object) note('objectBroken');
  }, { name: 'audit', order: 99, source: 'audit' });

  hooks.on('zeroHP', (payload) => {
    if (payload.unit?.type === id && payload.fallen) note('reformed');
  }, { name: 'audit', order: 99, source: 'audit' });

  hooks.on('roundEnd', (payload) => {
    const born = payload.combat.units.filter((unit) => unit.summoned).length;
    if (born > 0) note('summoned');
    const heads = payload.combat.units.filter((unit) => unit.part && unit.alive).length;
    if (heads > 3) note('regrew');
  }, { name: 'audit', order: 99, source: 'audit' });
}

/** One boss, played to the end. */
export function playBoss(id, { seed = 4242, hero = null, difficulty = 'normal' } = {}) {
  const block = BOSSES[id];
  const seen = new Set();
  const out = playFight({
    seed,
    boss: id,
    floor: block.floor,
    difficulty,
    hero: hero ?? bossHero(block.floor),
    watch: (combat) => watchBoss(combat, id, seen),
  });
  return { ...out, id, saw: [...seen] };
}

/** What each boss has to show before the fight counts as built. */
export const MUST_SHOW = {
  rat_king: ['summoned'],
  bone_warden: [],
  grukk: ['tempered'],
  brood_mother: ['summoned'],
  hydra: ['partKilled'],
  veyra: ['summoned'],
  forge_colossus: [],
  bound_grimoire: ['page'],
  malgorath: ['summoned'],
  vyrmathrax: ['phase2'],
};

/**
 * Plays every boss over a handful of seeds.
 * @param {{ seeds?: number[] }} [options]
 */
export function playEveryBoss({ seeds = [11, 4242, 90210] } = {}) {
  const rows = [];
  for (const id of bossIds()) {
    const saw = new Set();
    let wins = 0;
    let problems = [];
    for (const seed of seeds) {
      const played = playBoss(id, { seed });
      for (const what of played.saw) saw.add(what);
      if (played.outcome === 'victory') wins += 1;
      problems = [...problems, ...(played.problems ?? []).map((line) => `seed ${seed}: ${line}`)];
    }
    const missing = (MUST_SHOW[id] ?? []).filter((what) => !saw.has(what));
    rows.push({ id, wins, of: seeds.length, saw: [...saw], missing, problems });
  }
  return rows;
}
