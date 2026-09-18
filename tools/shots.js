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
const SCREENS = ['title', 'settings', 'explore', 'pause'];

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
    await writeFile(join(OUT, `${screen}-${size.name}.png`), await chrome.screenshot());
    console.log(`  dist/shots/${screen}-${size.name}.png`);
  }
}

await chrome.close();
