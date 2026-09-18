/**
 * Renders the dungeon view in a real browser and checks what came out
 * (`07` section 4).
 *
 *   npm run view-check
 *   npm run view-check -- --shot   also saves dist/shots/view.png
 *
 * A canvas is the only thing that can answer whether the raycaster drew
 * anything, so this is a tool rather than a test. It checks:
 *   - a real floor draws, with depth shading rather than a flat fill
 *   - the canvas never goes past its pixel cap, however big the region
 *   - a Dark Zone's fog really does close the view down
 *   - wall height is the same share of the canvas in both frames
 *
 * The derivation of the wide field of view is exact arithmetic, so it is
 * tested in test/view.test.js rather than here: a wrong value fails that test
 * to twelve decimal places, while its effect on a rendered frame is a sideways
 * stretch that pixel counting measures only crudely.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { build } from 'esbuild';
import { openChrome } from './lib/chrome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, 'dist', 'view-check');
const PORT = 5211;

/** Runs in the page: draws a few views and reports what landed on the canvas.
 *  Imports are relative to the project root, which is the bundler's resolveDir. */
const PROBE = `
import { buildFloor, TILE } from './src/dungeon/floor-builder.js';
import { layoutStream } from './src/engine/rng.js';
import { createView, poseFor, doorOffsets } from './src/dungeon/view.js';

const results = {};

// A straight corridor, so the wall ahead sits at a known distance and the two
// frames can be compared like for like.
const W = 21, H = 5;
const straight = Array.from({ length: H }, () => new Array(W).fill(TILE.WALL));
for (let x = 1; x <= 10; x++) straight[2][x] = TILE.FLOOR;
const corridor = { map: straight, width: W, height: H };

/** How much was drawn, and how tall the lit part of the centre column is. */
function measure(canvas) {
  const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const colours = new Set();
  let top = -1, bottom = -1;
  const col = Math.floor(canvas.width / 2);
  for (let i = 0; i < px.length; i += 4) colours.add(px[i] + ',' + px[i+1] + ',' + px[i+2]);
  for (let y = 0; y < canvas.height; y++) {
    const i = (y * canvas.width + col) * 4;
    if (px[i] + px[i+1] + px[i+2] > 30) { if (top === -1) top = y; bottom = y; }
  }
  return {
    colours: colours.size,
    width: canvas.width,
    height: canvas.height,
    wallHeightShare: top === -1 ? 0 : (bottom - top + 1) / canvas.height,
  };
}

function draw(frame, availW, availH, state) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const view = createView({ canvas, frame, light: state.light ?? 'torch' });
  view.resize(availW, availH);
  view.render(state.render);
  return { canvas, view, ...measure(canvas) };
}

// 1. Both frames, same corridor, same pose.
for (const [frame, w, h] of [['tall', 360, 320], ['wide', 480, 240]]) {
  results[frame] = draw(frame, w, h, { render: { floor: corridor, pose: poseFor([1, 2], 1) } });
  delete results[frame].canvas;
  delete results[frame].view;
}

// 2. The pixel cap holds even when the region on screen is huge.
const huge = draw('wide', 4000, 2000, { render: { floor: corridor, pose: poseFor([1, 2], 1) } });
results.capped = { width: huge.width, height: huge.height };

// 3. Darkness closes the view down.
const dark = draw('tall', 360, 320, { light: 'darkness', render: { floor: corridor, pose: poseFor([1, 2], 1) } });
results.darkColours = dark.colours;

// 4. A real generated floor draws, from where the hero actually arrives.
const floor = buildFloor(1, 20260918, layoutStream);
const real = draw('tall', 360, 320, {
  render: { floor, pose: poseFor(floor.start.pos, floor.start.facing), doors: doorOffsets(floor.doors) },
});
results.realFloor = { colours: real.colours, width: real.width, height: real.height };

document.body.dataset.results = JSON.stringify(results);
document.title = 'OK';
`;

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await writeFile(join(WORK, 'probe.js'), PROBE);

// The probe imports by absolute path, so it is bundled against the real source.
await build({
  stdin: { contents: PROBE, resolveDir: ROOT, loader: 'js' },
  bundle: true,
  format: 'esm',
  outfile: join(WORK, 'probe.built.js'),
  absWorkingDir: ROOT,
});

await writeFile(
  join(WORK, 'index.html'),
  `<!doctype html><meta charset="utf-8"><body style="background:#14110F;margin:0">
<script>window.__err='none';addEventListener('error',e=>window.__err=(e.error&&e.error.stack)||e.message);</script>
<script type="module" src="./probe.built.js"></script>`,
);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(WORK, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const chrome = await openChrome();
await chrome.setSize(900, 700, 1);
await chrome.open(`http://localhost:${PORT}/`, 2500);

const error = await chrome.evaluate('window.__err');
const raw = await chrome.evaluate('document.body.dataset.results || ""');
if (process.argv.includes('--shot')) {
  await mkdir(join(ROOT, 'dist', 'shots'), { recursive: true });
  await writeFile(join(ROOT, 'dist', 'shots', 'view.png'), await chrome.screenshot());
}
await chrome.close();
server.close();

if (error !== 'none' || !raw) {
  console.error(`  the view failed to draw:\n${error}`);
  process.exit(1);
}

const r = JSON.parse(raw);
/** @type {string[]} */
const problems = [];

// Depth shading means many colours; a flat fill or a blank canvas means few.
for (const frame of ['tall', 'wide']) {
  console.log(
    `  ${frame.padEnd(5)} ${r[frame].width}x${r[frame].height}  ${String(r[frame].colours).padStart(3)} colours  wall ${(r[frame].wallHeightShare * 100).toFixed(1)}% of canvas`,
  );
  if (r[frame].colours < 8) problems.push(`the ${frame} frame drew only ${r[frame].colours} colours`);
}

// 07 section 4: wall height must not jump when the frame changes. This is a
// sanity check on the rendered frame, not a proof of the field of view: the
// renderer takes its vertical field of view from canvas height, so this holds
// on its own and would not catch a wrong horizontal one. test/view.test.js is
// what checks that.
const drift = Math.abs(r.tall.wallHeightShare - r.wide.wallHeightShare);
console.log(`  wall height drift between frames: ${(drift * 100).toFixed(2)} percentage points`);
if (drift > 0.02) problems.push(`wall height moves by ${(drift * 100).toFixed(1)} points between frames`);

console.log(`  capped canvas: ${r.capped.width}x${r.capped.height}`);
if (Math.max(r.capped.width, r.capped.height) > 480) problems.push('the canvas went past its pixel cap');

console.log(`  darkness drew ${r.darkColours} colours (torch drew ${r.tall.colours})`);
if (r.darkColours >= r.tall.colours) problems.push('darkness did not close the view down');

console.log(`  a real floor drew ${r.realFloor.colours} colours at ${r.realFloor.width}x${r.realFloor.height}`);
if (r.realFloor.colours < 8) problems.push('a generated floor did not draw');

if (problems.length > 0) {
  console.error('\n  problems:');
  for (const problem of problems) console.error(`    - ${problem}`);
  process.exit(1);
}
console.log('\n  the view draws correctly in both frames');
