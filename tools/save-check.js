/**
 * Saving, checked in a real browser (`05` section 11; `00`, Testing: "Save
 * tests").
 *
 *   npm run build && npm run save-check
 *
 * Plays a new game through the page's own buttons, closes the page, opens it
 * again and continues — the hero must be standing exactly where they were,
 * with the same steps and log. Then it closes the page in the middle of a
 * fight: Continue must open that fight, at the same round, showing its last
 * three lines (`05` section 13). Then it corrupts the main save: the backup
 * must load, and the log must say so. Then a game is exported from Settings,
 * its save deleted, and the file imported: the hero must be back where they
 * stood. Last, an Ironman falls in a fight: the
 * Death screen shows their tombstone, the save is gone, the Hall has their
 * record, and the Title screen no longer offers Continue.
 *
 * Needs the built page and headless Chrome (set CHROME if it isn't at the
 * usual macOS path), like `npm run check`.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openChrome, wait } from './lib/chrome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = `file://${join(ROOT, 'dist', 'index.html')}`;

/** The moves played, through the Exploration screen's own buttons. */
const MOVES = [
  'Move forward', 'Move forward', 'Turn left', 'Move forward', 'Move forward',
  'Turn right', 'Move forward', 'Move forward', 'Strafe left', 'Move forward',
  'Move forward', 'Turn left', 'Move forward', 'Move back', 'Move forward',
];

const problems = [];
const chrome = await openChrome();

/** Taps a button by its label, the way a finger would. */
const tap = (label) =>
  chrome.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') || b.textContent).includes(${JSON.stringify(label)}),
    );
    if (!button || button.disabled) return false;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    button.click();
    return true;
  })()`);

/**
 * Where the hero is and what the log on screen last said: the fight's log
 * when a wandering monster found them on the way, the corridor's otherwise.
 */
const where = async () =>
  JSON.parse(
    await chrome.evaluate(`JSON.stringify({
      screen: underkeep.router.current.id,
      pos: underkeep.run.ex.pos,
      facing: underkeep.run.ex.facing,
      steps: underkeep.run.ex.steps,
      log: (underkeep.session.fight && !underkeep.session.fight.over
        ? underkeep.session.fight.log
        : underkeep.run.log
      ).slice(-3).map((line) => line.text),
    })`),
  );

try {
  await chrome.setSize(390, 844);
  await chrome.open(PAGE, 800);

  /* -- play, close, continue ------------------------------------------ */

  await chrome.evaluate('underkeep.newGame({ seed: 7919 })');
  await wait(400);
  const slot = await chrome.evaluate('underkeep.saves.slot');
  if (!slot) problems.push('a new game was given no save slot');

  for (const label of MOVES) {
    if (!(await tap(label))) problems.push(`no "${label}" button to tap`);
    await wait(40);
  }
  const before = await where();
  // Past the step batch, so a quiet step has had its chance to be written.
  await wait(400);

  await chrome.open(PAGE, 900);
  const card = await chrome.evaluate(`document.querySelector('[data-region="title.lastPlayed"]')?.textContent ?? ''`);
  if (!card.includes('Harrow')) problems.push(`the Title screen does not show the saved hero: "${card}"`);
  await chrome.evaluate('underkeep.saves.continueGame()');
  await wait(400);
  const after = await where();

  if (after.screen !== before.screen) problems.push(`Continue opened ${after.screen}, not ${before.screen}`);
  if (after.pos.join() !== before.pos.join()) problems.push(`the hero was at ${before.pos}, and came back at ${after.pos}`);
  if (after.facing !== before.facing) problems.push('the hero came back facing another way');
  if (after.steps !== before.steps) problems.push(`the step clock was at ${before.steps}, and came back at ${after.steps}`);
  if (after.log.join('|') !== before.log.join('|')) problems.push('the log came back different');

  /* -- mid-combat: close in the middle of a fight --------------------- */

  // Any fight the walk ran into is fought out first, so this one is fresh.
  await chrome.evaluate(`(() => {
    const game = underkeep.session;
    for (let i = 0; i < 200 && game.fight && !game.fight.over; i += 1) game.fight.act('attack');
    game.endFight();
    game.hero.hp = game.hero.maxHp;
    game.hero.alive = true;
    game.startFight();
    underkeep.router.go('combat');
  })()`);
  await wait(200);
  for (let i = 0; i < 2; i += 1) {
    if (!(await tap('ATTACK'))) problems.push('no ATTACK button to tap');
    await wait(80);
  }
  const fightState = `JSON.stringify({
    screen: underkeep.router.current.id,
    over: underkeep.session.fight?.over ?? null,
    round: underkeep.session.fight?.round ?? null,
    field: (underkeep.session.fight?.combat.units ?? []).map((u) => [u.id, u.hp, u.alive]),
    log: (underkeep.session.fight?.log ?? []).slice(-3).map((l) => l.text),
    shown: [...document.querySelectorAll('[data-region="combat.log"] .log__line')].map((n) => n.textContent),
  })`;
  const inFight = JSON.parse(await chrome.evaluate(fightState));
  await wait(100);
  await chrome.open(PAGE, 900);
  await chrome.evaluate('underkeep.saves.continueGame()');
  await wait(400);
  const resumed = JSON.parse(await chrome.evaluate(fightState));
  if (inFight.over) {
    problems.push('the fight ended before the page was closed; pick another seed');
  } else {
    if (resumed.screen !== 'combat') problems.push(`a mid-fight Continue opened ${resumed.screen}, not combat`);
    if (resumed.round !== inFight.round) problems.push(`the fight was on round ${inFight.round}, and came back on ${resumed.round}`);
    if (JSON.stringify(resumed.field) !== JSON.stringify(inFight.field)) problems.push('the field came back different');
    if (resumed.log.join('|') !== inFight.log.join('|')) problems.push('the last three lines came back different');
    if (resumed.shown.length !== 3) problems.push(`the resumed Combat screen shows ${resumed.shown.length} log lines, not the last three`);
  }

  /* -- corrupt the main save ------------------------------------------ */

  await chrome.evaluate(`(async () => {
    const store = underkeep.saves.store;
    const text = await store.raw(${JSON.stringify(slot)});
    await store.poke(${JSON.stringify(slot)}, 'main', text.slice(0, text.length - 40));
  })()`);
  await chrome.open(PAGE, 900);
  await chrome.evaluate('underkeep.saves.continueGame()');
  await wait(400);
  const recovered = await where();
  if (!['explore', 'combat'].includes(recovered.screen)) problems.push('the backup did not load into the game');
  if (!recovered.log.at(-1)?.includes('damaged')) problems.push('the player was not told the backup was loaded');

  /* -- an Ironman falls ----------------------------------------------- */

  await chrome.open(PAGE, 800);
  await chrome.evaluate(`underkeep.newGame({ seed: 4099, mode: 'ironman' })`);
  await wait(400);
  const ironSlot = await chrome.evaluate('underkeep.saves.slot');
  if (!String(ironSlot).startsWith('ironman-')) problems.push(`an Ironman was given slot ${ironSlot}, not one of their own`);
  // A fight they cannot survive, fought through the Combat screen's buttons.
  await chrome.evaluate(`(() => {
    const game = underkeep.session;
    game.hero.hp = 1;
    game.startFight();
    underkeep.router.go('combat');
  })()`);
  await wait(200);
  for (let i = 0; i < 40 && !(await chrome.evaluate('underkeep.session.fight?.over ?? true')); i += 1) {
    await tap('DEFEND');
    await wait(60);
  }
  if (!(await tap('YOU HAVE FALLEN'))) problems.push('the Combat screen offered no way to the Death screen');
  await wait(400);
  const grave = JSON.parse(
    await chrome.evaluate(`(async () => JSON.stringify({
      screen: underkeep.router.current.id,
      stone: document.querySelector('[data-region="death.stone"]')?.textContent ?? '',
      saved: (await underkeep.saves.store.read(${JSON.stringify(ironSlot)})).save !== null,
      hall: (await underkeep.saves.store.hall()).length,
    }))()`),
  );
  if (grave.screen !== 'death') problems.push(`an Ironman's fall opened ${grave.screen}, not the Death screen`);
  if (!grave.stone.includes('HERE LIES')) problems.push('the Death screen shows no tombstone');
  if (grave.saved) problems.push("the dead Ironman's save was not deleted");
  if (grave.hall !== 1) problems.push(`the Hall of the Dead holds ${grave.hall} records, not 1`);
  // The Hall reads what the burial wrote.
  if (!(await tap('HALL OF THE DEAD'))) problems.push('no way from the Death screen to the Hall of the Dead');
  await wait(300);
  const listed = await chrome.evaluate(`document.querySelector('[data-region="hall.list"]')?.textContent ?? ''`);
  if (!listed.includes('HARROW')) problems.push(`the Hall of the Dead does not list the fallen Ironman: "${listed.slice(0, 80)}"`);
  if (!(await tap('BACK TO TITLE'))) problems.push('no BACK TO TITLE button in the Hall');
  await wait(200);
  if (!(await chrome.evaluate(`underkeep.router.current.id === 'title'`))) problems.push('BACK TO TITLE did not reach the Title screen');
  const continueOff = await chrome.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('CONTINUE'))?.disabled ?? null`);
  if (continueOff !== true) problems.push('Continue is still offered after an Ironman fell');

  /* -- export, lose the save, import it back ----------------------------- */

  await chrome.open(PAGE, 800);
  await chrome.evaluate(`underkeep.newGame({ seed: 6001 })`);
  await wait(300);
  for (const label of MOVES.slice(0, 8)) {
    await tap(label);
    await wait(40);
  }
  const exported = JSON.parse(await chrome.evaluate(`JSON.stringify({ pos: underkeep.run.ex.pos, slot: underkeep.saves.slot })`));
  // Catch the file EXPORT hands the browser, and the picker IMPORT opens.
  await chrome.evaluate(`(() => {
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__exported = blob; return make(blob); };
    const create = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      const node = create(tag, ...rest);
      if (tag === 'input') window.__picker = node;
      if (tag === 'a') node.click = () => {};
      return node;
    };
  })()`);
  {
    await chrome.evaluate(`underkeep.router.go('settings')`);
    await wait(200);
    if (!(await tap('EXPORT'))) problems.push('EXPORT could not be tapped');
    await wait(400);
  }
  const text = await chrome.evaluate(`window.__exported ? window.__exported.text() : null`);
  if (!text?.startsWith('UNDERKEEP:1:')) problems.push('EXPORT gave no save file');
  // Lose the save outright, then bring it back from the file.
  await chrome.evaluate(`underkeep.saves.store.remove(${JSON.stringify(exported.slot)})`);
  if (!(await tap('IMPORT'))) problems.push('IMPORT could not be tapped');
  await wait(200);
  await chrome.evaluate(`(() => {
    const data = new DataTransfer();
    data.items.add(new File([${JSON.stringify(text ?? '')}], 'save.txt', { type: 'text/plain' }));
    window.__picker.files = data.files;
    window.__picker.dispatchEvent(new Event('change'));
  })()`);
  await wait(800);
  const imported = JSON.parse(await chrome.evaluate(`JSON.stringify({ screen: underkeep.router.current.id, pos: underkeep.run?.ex?.pos ?? null })`));
  if (imported.pos?.join() !== exported.pos.join()) problems.push(`the imported game stood at ${imported.pos}, not ${exported.pos}`);

  console.log(`\n  played ${MOVES.length} moves, closed the page, and continued: ${after.pos} facing ${after.facing}, ${after.steps} steps`);
  console.log(`  closed the page mid-fight on round ${inFight.round}: Continue opened ${resumed.screen}, showing "${resumed.shown.at(-1) ?? ''}" and two lines before it`);
  console.log(`  corrupted the main save: the backup loaded, and the log says "${recovered.log.at(-1)}"`);
  console.log(`  exported a game, deleted its save, imported the file: back on ${imported.screen} at ${imported.pos}`);
  console.log(`  an Ironman fell: the Death screen showed their stone, the save is gone, the Hall holds ${grave.hall} and lists them\n`);
} finally {
  await chrome.close();
}

if (problems.length > 0) {
  console.log('  what is wrong:\n');
  for (const line of problems) console.log(`    - ${line}`);
  console.log('');
  process.exit(1);
}
console.log('  saving holds\n');
