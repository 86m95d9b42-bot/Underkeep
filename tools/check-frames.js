/**
 * Frame check: opens every screen of the built game at every device size and
 * confirms the shell rules hold.
 *
 *   npm run check
 *
 * What it checks, from 00-build-outline.md and CLAUDE.md's UI rules:
 *   - the page itself never scrolls, in either direction
 *   - the frame fits inside the viewport, so any leftover space is letterbox
 *   - --u is the expected size and never passes the 72 px cap
 *   - the right frame is chosen for the viewport's shape
 *   - nothing overflows sideways or downwards outside a .scroll panel
 *   - every tap target is at least 2 rows tall
 *   - every button has a label or an aria-label, and every disabled one a reason
 *
 * A real phone is still the test that counts (docs/TASKS.md); this catches what
 * a machine can catch, on every screen, in a few seconds.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openChrome, SIZES } from './lib/chrome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'dist', 'index.html');

/** Every screen the shell can open, by its router id. Grows with each phase. */
const SCREENS = [
  'title',
  'settings',
  'newGame',
  'createStats',
  'createOrigin',
  'explore',
  'pause',
  'map',
  'hero',
  'skillTree',
  'combat',
  'combatSkills',
];

if (!existsSync(PAGE)) {
  console.error('  no dist/index.html — run `npm run build` first');
  process.exit(1);
}

/** Runs in the page: measures the shell and returns everything worth checking. */
const PROBE = `(() => {
  const root = document.documentElement;
  const app = document.getElementById('app');
  const box = app.getBoundingClientRect();
  const wide = app.classList.contains('wide');
  const rows = wide ? 9 : 18;
  const unit = box.width / (wide ? 18 : 9);

  // A region spanning two rows is two row tracks plus the gap between them,
  // not two eighteenths of the frame: the frame's padding and gaps come off
  // first. Measure the real tracks so the rule is checked against the grid.
  const style = getComputedStyle(app);
  const track = parseFloat(style.gridTemplateRows.split(' ')[0]);
  const gap = parseFloat(style.rowGap) || 0;
  const twoRows = track * 2 + gap;

  const regions = [...app.querySelectorAll('[data-region]')];
  const tapTargets = regions.filter((r) => r.querySelector('.btn, .listrow') || r.matches('.btn'));

  return {
    screen: regions[0]?.dataset.region.split('.')[0] ?? null,
    frame: wide ? 'wide' : 'tall',
    unit: Math.round(unit * 100) / 100,
    rowHeight: Math.round((box.height / rows) * 100) / 100,
    pageScrollY: root.scrollHeight - root.clientHeight,
    pageScrollX: root.scrollWidth - root.clientWidth,
    fits: box.width <= innerWidth + 0.5 && box.height <= innerHeight + 0.5,
    scrollPanels: app.querySelectorAll('.scroll, .scroll-x').length,
    // Anything wider than its box that is not inside a scrolling panel would
    // clip text or push the frame sideways. A .scroll-x panel is the sideways
    // kind (the Automap's legend), and is allowed to be wider than its box.
    overflowing: regions
      .filter((r) => !r.closest('.scroll, .scroll-x') && r.scrollWidth > r.clientWidth + 1)
      .map((r) => r.dataset.region),
    // The same downwards: content taller than its region overlaps whatever is
    // under it, which is a layout bug however good it looks in one frame.
    spilling: regions
      .filter((r) => !r.classList.contains('scroll') && !r.closest('.scroll'))
      .filter((r) => r.scrollHeight > r.clientHeight + 1)
      .map((r) => r.dataset.region),
    twoRows: Math.round(twoRows * 100) / 100,
    shortTargets: tapTargets
      .filter((r) => r.getBoundingClientRect().height < twoRows - 1)
      .map((r) => r.dataset.region + ' (' + Math.round(r.getBoundingClientRect().height) + 'px)'),
    namelessButtons: [...app.querySelectorAll('button')]
      .filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label')).length,
    unexplainedDisabled: [...app.querySelectorAll('button[disabled]')]
      .filter((b) => !b.querySelector('.hint')).length,
  };
})()`;

const chrome = await openChrome();
let failures = 0;

for (const screen of SCREENS) {
  for (const size of SIZES) {
    await chrome.setSize(size.width, size.height, 1);
    await chrome.open(`file://${PAGE}#${screen}`, 600);
    const r = await chrome.evaluate(PROBE);

    const expectedFrame = size.width / size.height >= 1.2 ? 'wide' : 'tall';
    const expectedUnit = Math.min(
      size.width / (expectedFrame === 'wide' ? 18 : 9),
      size.height / (expectedFrame === 'wide' ? 9 : 18),
      72,
    );

    /** @type {string[]} */
    const problems = [];
    if (r.screen !== screen) problems.push(`showed "${r.screen}"`);
    if (r.frame !== expectedFrame) problems.push(`chose the ${r.frame} frame`);
    if (Math.abs(r.unit - expectedUnit) > 0.5) problems.push(`--u is ${r.unit}, expected ${expectedUnit.toFixed(1)}`);
    if (r.unit > 72.5) problems.push(`--u passed the 72 px cap at ${r.unit}`);
    if (r.pageScrollY !== 0 || r.pageScrollX !== 0) problems.push('the page scrolls');
    if (!r.fits) problems.push('the frame is bigger than the viewport');
    if (r.overflowing.length) problems.push(`overflows sideways: ${r.overflowing.join(', ')}`);
    if (r.spilling.length) problems.push(`spills over what is under it: ${r.spilling.join(', ')}`);
    if (r.shortTargets.length) problems.push(`tap targets under 2 rows: ${r.shortTargets.join(', ')}`);
    if (r.namelessButtons) problems.push(`${r.namelessButtons} button(s) with no label`);
    if (r.unexplainedDisabled) problems.push(`${r.unexplainedDisabled} disabled button(s) with no reason`);

    const head = `${screen.padEnd(9)} ${String(size.width).padStart(4)}x${String(size.height).padEnd(4)} ${r.frame.padEnd(4)} u=${String(r.unit).padStart(5)}`;
    if (problems.length === 0) {
      console.log(`  ok    ${head}  ${r.scrollPanels} scroll panel(s)`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${head}`);
      for (const problem of problems) console.log(`          - ${problem}`);
    }
  }
}

await chrome.close();
if (failures > 0) {
  console.error(`\n  ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\n  ${SCREENS.length} screen(s) x ${SIZES.length} size(s): all good`);
