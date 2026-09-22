/**
 * Phase 8's "done when": a full playthrough survives repeated force-closes
 * with no lost progress (`05` section 11: "Nothing is ever lost to closing the
 * app").
 *
 *   npm run playthrough                  both modes, a force-close after every action
 *   npm run playthrough -- --every=5     a force-close every fifth action
 *   npm run playthrough -- --seed=7      another game
 *   npm run playthrough -- --mode=ironman
 *
 * Plays a whole game — floor 1 to Vyrmathrax, every boss, every fight on the
 * way, the Inn, deaths and graves for an Adventurer — through the same
 * session the screens drive (`tools/lib/player.js`). After every action the
 * game is force-closed the way the saver would leave it: the save is written
 * as it is at that moment, the live game is thrown away, and play carries on
 * from the save alone. Two things are checked each time:
 *
 *   - **nothing lost:** the restored game saves back exactly what was saved —
 *     hero, pack, town, floor changes, the fight to its last hit point, and
 *     the random streams, so no outcome can ever be rolled again;
 *   - **it plays on as if never closed:** the same game played alongside
 *     without a single close must be in exactly the same state at every
 *     close, so nothing the save leaves out can change what happens next;
 *   - **it reaches the end** from nothing but its saves, and the finished
 *     game is recorded for the Hall, score doubled.
 *
 * The hero is the Pure Warrior at level 20 with ten times the hit points and
 * a purse for potions and the Inn, so the game is about surviving the closes
 * rather than about the climb. The Adventurer falls once on purpose on floor 4,
 * so a death, a grave and a morning in town are closed on as well.
 * A real close in a browser is `npm run save-check`'s.
 */
import { createSession } from '../src/systems/session.js';
import { restoreSession, takeSnapshot } from '../src/save/snapshot.js';
import { decode, encode, stableStringify } from '../src/save/codec.js';
import { buildHero } from './lib/builds.js';
import { playOne } from './lib/player.js';
import { applySkillSheet } from '../src/engine/skill-hooks.js';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;
const every = Math.max(1, Number(flag('every') ?? 1));
const seed = Number(flag('seed') ?? 20260921);
const modes = flag('mode') ? [flag('mode')] : ['adventurer', 'ironman'];
/** A game that has not ended by now is stuck somewhere. */
const ACTION_CAP = 200000;
/**
 * The test hero's purse: enough for the Inn and a stack of potions every trip,
 * so the game is about surviving the closes, not about floor 9's encounters.
 */
const PURSE = 50000;
/**
 * The test hero's hit points, times what the rules give. The Pure Warrior at
 * level 20 still falls on floor 9's ordinary encounters often enough that no
 * Ironman game reached the end (docs/DECISIONS.md, Open questions); this is a
 * test of saving, so the hero is made to last. Everything else is the rules.
 */
const HP_BOOST = Number(flag('boost') ?? 10);
/** An Adventurer falls once on purpose, here, so a death and a grave are closed on too. */
const FALL_ON_FLOOR = 4;

/** The save as it would be written, without the moment it was written. */
function saved(game) {
  const { savedAt: _at, checksum: _sum, ...rest } = takeSnapshot(game);
  return rest;
}

/** Force-close: write, forget the live game, come back from the file alone. */
function forceClose(game) {
  const text = encode(takeSnapshot(game));
  const back = restoreSession(decode(text), { go: () => {} });
  return { back, text };
}

/**
 * A save with its clock times blanked: two games played side by side record
 * the same moment a millisecond apart, and the wall clock is not game state.
 */
function timeless(save) {
  return JSON.parse(stableStringify(save), (_key, value) =>
    typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) ? 'time' : value,
  );
}

/** The first thing two saves disagree on, as a path, for the report. */
function firstDifference(a, b, path = '') {
  if (stableStringify(a) === stableStringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference(a[key], b[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path || '(root)'}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`;
}

/** A new game with the test hero. */
function newGame(mode) {
  // Floor 10's Shop gear, at the level cap, so no level-up rebuilds the sheet.
  const hero = buildHero('pure_warrior', { floor: 10, level: 20, seed });
  hero.mode = mode;
  hero.gold = PURSE;
  // On the base the skill sheet is rebuilt from, so every rebuild keeps it.
  hero.baseSheet.maxHp = Math.round(hero.baseSheet.maxHp * HP_BOOST);
  applySkillSheet(hero);
  hero.hp = hero.maxHp;
  return createSession({ hero, seed, go: () => {} });
}

/** One action, with the Adventurer's one fall on purpose. */
function act(game, mode, fell) {
  if (mode === 'adventurer' && !fell.done && !game.fight && game.run?.floor.floor === FALL_ON_FLOOR) {
    // The same call the Death screen's fall makes: a grave, half the gold,
    // and waking in town (`05` section 9).
    game.heroFell({ cause: null });
    fell.done = true;
    return 'fell on purpose';
  }
  return playOne(game);
}

function play(mode) {
  let game = newGame(mode);
  // The same game, never closed. The closed one must play out exactly as it
  // does: anything the save forgot would change what happens next.
  const shadow = newGame(mode);
  const fell = { done: false };
  const shadowFell = { done: false };

  const tally = {};
  const problems = [];
  const deaths = [];
  let closes = 0;
  let bytes = 0;
  let outcome = 'unfinished';

  for (let action = 1; action <= ACTION_CAP; action += 1) {
    const fightBefore = game.fight;
    const did = act(game, mode, fell);
    const shadowDid = act(shadow, mode, shadowFell);
    if (shadowDid !== did) {
      problems.push(`action ${action}: the closed game did "${did}" where the unclosed one did "${shadowDid}"`);
      break;
    }
    tally[did] = (tally[did] ?? 0) + 1;
    if (did === 'fell' || did === 'dead' || did === 'fell on purpose') {
      const cause = fightBefore?.causeOfDeath ?? game.run?.causeOfDeath ?? null;
      const who = fightBefore ? fightBefore.combat.units.filter((u) => u.side === 'monsters').map((u) => u.type).join(' ') : 'exploring';
      deaths.push(`floor ${fightBefore?.combat.floor ?? '?'}: ${who}${cause ? ` (${cause.name ?? cause.kind ?? ''})` : ''}`);
    }
    if (did === 'done' || did === 'dead' || did === 'stuck') {
      outcome = did;
      if (did === 'stuck' && game.fight) {
        const units = game.fight.combat.units.map((u) => `${u.id}${u.alive ? `:${u.hp}` : u.fallen ? ':fallen' : ':dead'}`).join(' ');
        problems.push(`stuck in a fight on floor ${game.fight.combat.floor}, round ${game.fight.round}: ${units}`);
      }
      break;
    }
    if (action % every !== 0) continue;

    const before = saved(game);
    const { back, text } = forceClose(game);
    closes += 1;
    bytes = Math.max(bytes, text.length);
    const lost = firstDifference(before, saved(back));
    if (lost) {
      problems.push(`action ${action} (${did}): the save came back different at ${lost}`);
      if (problems.length >= 5) break;
    }
    const drifted = firstDifference(timeless(saved(shadow)), timeless(before));
    if (drifted) {
      problems.push(`action ${action} (${did}): the closed game has drifted from the unclosed one at ${drifted}`);
      break;
    }
    game = back;
  }

  const finished = game.town.finished;
  if (outcome === 'done' && !finished) problems.push('every boss fell, but the finished game was not recorded');
  if (outcome !== 'done') problems.push(`the game did not reach the end: ${outcome}`);
  return { mode, outcome, tally, closes, bytes, finished, problems, deaths, town: game.town, hero: game.hero };
}

const started = Date.now();
let failed = false;
for (const mode of modes) {
  const result = play(mode);
  const moves = Object.entries(result.tally)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  console.log(`\n  ${mode}, seed ${seed}: ${result.outcome}`);
  console.log(`    ${result.closes} force-closes, largest save ${(result.bytes / 1024).toFixed(1)} KB`);
  console.log(`    bosses ${result.town.bosses.join(' ')}, day ${result.town.day}, trips ${result.town.trips}, hero level ${result.hero.level}`);
  if (result.finished) console.log(`    recorded for the Hall: score ${result.finished.score}`);
  console.log(`    ${moves}`);
  if (result.deaths.length) {
    const counted = {};
    for (const line of result.deaths) counted[line] = (counted[line] ?? 0) + 1;
    console.log(`    fell ${result.deaths.length} times: ${Object.entries(counted).map(([k, v]) => `${k} x${v}`).join('; ')}`);
  }
  for (const line of result.problems) console.log(`    - ${line}`);
  if (result.problems.length) failed = true;
}
console.log(`\n  ${failed ? 'the playthrough did not hold' : 'every close came back whole, and both games reached the end'} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
process.exit(failed ? 1 : 0);
