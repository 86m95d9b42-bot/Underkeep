/**
 * Force-closes in a real browser (Phase 8's "done when": a full playthrough
 * survives repeated force-closes with no lost progress; `05` section 11:
 * "The game can be closed at any moment, including mid-combat, and reopens
 * at exactly the same spot").
 *
 *   npm run build && npm run force-close            40 closes in each mode
 *   npm run force-close -- 100                       100 closes in each mode
 *
 * Plays through the page's own buttons — the movement pad, ATTACK, the Loot
 * and Level Up CONTINUE, a chest's LEAVE — a few taps at a time, then
 * crashes the page's renderer (`Page.crash`: no unload, no last-moment save,
 * as when a phone kills the app) and opens it again. Continue must put the
 * game back exactly as it stood: the screen, the floor, the tile and facing,
 * the step clock, hit points, XP, gold, the fight to its last hit point, and
 * the random streams, so no outcome can be rolled twice.
 *
 * It waits out the step batch before each crash (`saving.json`, 250 ms): a
 * quiet step is allowed to be written that late (`05` section 11's table),
 * and everything random was already written before it was shown. The whole
 * game from floor 1 to the dragon is `npm run playthrough`'s; this checks the
 * same promise through IndexedDB, the saver and the screens.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openChrome, wait } from './lib/chrome.js';
import saving from '../src/data/saving.json' with { type: 'json' };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = `file://${join(ROOT, 'dist', 'index.html')}`;
const closes = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 40);
/** Past the step batch, with room for the write itself. */
const SETTLE_MS = saving.stepBatchMs + 250;

/** A small seeded shuffle, so a failure can be played again (not game code). */
function picker(seed) {
  let s = seed >>> 0;
  return (n) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}

/** What must come back exactly as it was. */
const STATE = `JSON.stringify((() => {
  const game = underkeep.session;
  const run = game?.run ?? null;
  const fight = game?.fight ?? null;
  return {
    screen: underkeep.router.current.id,
    floor: run?.floor.floor ?? null,
    pos: run?.ex.pos ?? null,
    facing: run?.ex.facing ?? null,
    steps: run?.ex.steps ?? null,
    hp: game?.hero.hp,
    xp: game?.hero.xp,
    gold: game?.hero.gold,
    pack: game?.hero.pack.items.map((e) => e.baseId + 'x' + (e.count ?? 1)).sort().join(','),
    day: game?.town.day,
    bosses: game?.town.bosses.join(','),
    fight: fight ? { round: fight.round, over: fight.over, field: fight.combat.units.map((u) => [u.id, u.hp, u.alive]) } : null,
    luck: underkeep.luck?.() ?? null,
  };
})())`;

/** The buttons a player would reach for on this screen, by label. */
const CHOICES = {
  explore: ['Move forward', 'Move forward', 'Move forward', 'Turn left', 'Turn right', 'Strafe left', 'Strafe right'],
  combat: ['ATTACK', 'ATTACK', 'ATTACK', 'DEFEND', 'CONTINUE'],
  loot: ['TAKE ALL', 'CONTINUE'],
  levelUp: ['CONTINUE', 'DONE'],
  chest: ['LEAVE'],
  death: ['CONTINUE', 'WAKE', 'TOWN', 'TITLE'],
  town: ['DUNGEON', 'GATE'],
  gate: ['DESCEND'],
};

async function soak(chrome, mode, seed) {
  const problems = [];
  const pick = picker(seed);
  const tapFirst = (labels) =>
    chrome.evaluate(`(() => {
      const labels = ${JSON.stringify(labels)};
      const buttons = [...document.querySelectorAll('button')].filter((b) => !b.disabled);
      for (const label of labels) {
        const button = buttons.find((b) => (b.getAttribute('aria-label') || b.textContent).includes(label));
        if (button) {
          button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          button.click();
          return label;
        }
      }
      return null;
    })()`);

  await chrome.open(PAGE, 800);
  await chrome.evaluate(`underkeep.newGame({ seed: ${seed}, mode: ${JSON.stringify(mode)} })`);
  await wait(500);
  let tapped = 0;
  let screens = new Set();

  for (let close = 1; close <= closes; close += 1) {
    const taps = 1 + pick(6);
    for (let i = 0; i < taps; i += 1) {
      const screen = await chrome.evaluate('underkeep.router.current.id');
      screens.add(screen);
      const choices = CHOICES[screen] ?? [];
      if (!choices.length) {
        // Anything else — a sheet, a card — goes back to the dungeon.
        await chrome.evaluate(`underkeep.router.go(underkeep.session?.fight && !underkeep.session.fight.over ? 'combat' : 'explore')`);
      } else {
        const first = choices[pick(choices.length)];
        await tapFirst([first, ...choices]);
        tapped += 1;
      }
      await wait(60);
    }
    await wait(SETTLE_MS);
    const before = JSON.parse(await chrome.evaluate(STATE));
    if (before.screen === 'death' && mode === 'ironman') {
      screens.add('death');
      break;
    }

    // Kill it the way a phone does: no unload, no last save.
    chrome.page('Page.crash').catch(() => {});
    await wait(400);
    await chrome.open(PAGE, 900);
    await chrome.evaluate('underkeep.saves.continueGame()');
    await wait(500);
    const after = JSON.parse(await chrome.evaluate(STATE));

    const differs = Object.keys(before).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (differs.length) {
      problems.push(
        `close ${close}: ${differs.map((key) => `${key} ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`).join('; ').slice(0, 400)}`,
      );
      if (problems.length >= 5) break;
    }
  }
  return { problems, tapped, screens: [...screens] };
}

const chrome = await openChrome();
const all = [];
try {
  await chrome.setSize(390, 844);
  for (const [mode, seed] of [['adventurer', 7919], ['ironman', 104729]]) {
    const { problems, tapped, screens } = await soak(chrome, mode, seed);
    console.log(`\n  ${mode}: ${closes} force-closes, ${tapped} taps, screens ${screens.join(' ')}`);
    for (const line of problems) console.log(`    - ${line}`);
    all.push(...problems);
  }
} finally {
  await chrome.close();
}
console.log(all.length ? '\n  a force-close lost something\n' : '\n  every force-close came back exactly where it was\n');
process.exit(all.length ? 1 : 0);
