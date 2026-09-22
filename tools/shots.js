/**
 * Screenshots: opens every screen of the built game at each device size and
 * saves a picture, so both frames can be eyeballed without a phone in hand.
 * The phone tests in docs/TASKS.md still rule; this only catches the obvious.
 *
 *   npm run shots              every screen at every size
 *   npm run shots -- wide      only sizes whose name contains "wide"
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openChrome, SIZES } from './lib/chrome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = process.env.URL ?? `file://${join(ROOT, 'dist', 'index.html')}`;
const OUT = join(ROOT, 'dist', 'shots');

/** Every screen the shell can open, by its router id. Grows with each phase. */
const SCREENS = [
  'title',
  'settings',
  'newGame',
  'createStats',
  'createOrigin',
  'town',
  'shop',
  'inn',
  'temple',
  'sage',
  'alchemist',
  'stash',
  'gate',
  'explore',
  'pause',
  'map',
  'chest',
  'hero',
  'skillTree',
  'pack',
  'itemDetail',
  'combat',
  'combatSkills',
  'reaction',
  'update',
  'loot',
  'levelUp',
  'death',
  'hall',
];

/**
 * Some screens are only worth looking at with something on them. The page
 * exposes the run at `globalThis.underkeep`, so a shot can put the game into
 * the state it wants first — here, a walked floor for the Automap.
 */
const PREPARE = {
  // A level 7 hero with points spent, so the tiles and the tiers have
  // something to show — the state the mockups are drawn in.
  hero: `(() => globalThis.underkeep.showHero('hero'))()`,
  skillTree: `(() => globalThis.underkeep.showHero('skillTree'))()`,
  // The creation screens are worth looking at with a hero half-made.
  createStats: `(() => {
    globalThis.underkeep.router.go('createStats', { seed: 20260918, rollMode: 'standard' });
  })()`,
  createOrigin: `(() => {
    const { router, newDraft } = globalThis.underkeep;
    router.go('createOrigin', { draft: { ...newDraft(), origin: 'cutpurse', name: 'Harrow' } });
  })()`,
  // A fight is worth looking at with a fight in it, and the Skills sheet with
  // the Combat screen dimmed behind it.
  combat: `(() => {
    const { router } = globalThis.underkeep;
    router.go('combat');
  })()`,
  combatSkills: `(() => {
    const { router } = globalThis.underkeep;
    router.go('combat');
    router.openSheet('combatSkills', { mode: 'skill' });
  })()`,
  // The rewards screens want a fight that is over behind them.
  loot: `(() => globalThis.underkeep.showVictory('loot'))()`,
  levelUp: `(() => globalThis.underkeep.showVictory('levelUp'))()`,
  // The Chest screen is worth looking at with a chest in front of the hero.
  chest: `(() => globalThis.underkeep.showChest())()`,
  map: `(() => {
    const { run, router } = globalThis.underkeep;
    const step = () => run.press('forward').outcome.moved;
    // The left-hand rule covers a floor instead of looping in a corner.
    for (let i = 0; i < 400; i++) {
      run.press('turnLeft');
      if (step()) continue;
      run.press('turnRight'); if (step()) continue;
      run.press('turnRight'); if (step()) continue;
      run.press('turnRight'); step();
    }
    router.render();
    return run.ex.explored.size;
  })()`,
};

if (!process.env.URL && !existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('  no dist/index.html \u2014 run `npm run build` first');
  process.exit(1);
}

const filter = process.argv[2];
const sizes = filter ? SIZES.filter((s) => s.name.includes(filter)) : SIZES;

await mkdir(OUT, { recursive: true });
const chrome = await openChrome();

for (const screen of SCREENS) {
  for (const size of sizes) {
    await chrome.setSize(size.width, size.height);
    await chrome.open(`${PAGE}#${screen}`, 800);
    if (PREPARE[screen]) await chrome.evaluate(PREPARE[screen]);
    await writeFile(join(OUT, `${screen}-${size.name}.png`), await chrome.screenshot());
    console.log(`  dist/shots/${screen}-${size.name}.png`);
  }
}

await chrome.close();
