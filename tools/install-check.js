/**
 * Phase 1's "done when", as far as a machine can take it (`docs/TASKS.md`):
 * installs on iOS and Android, opens fullscreen in both orientations, rotates
 * without losing state, and nothing scrolls or zooms outside `.scroll` panels.
 *
 *   npm run build && npm run install-check
 *
 * Serves the built page from localhost (a secure origin, as a real host is)
 * and asks headless Chrome what it asks before it offers to install:
 *
 *   - installability: Chrome's own verdict, which Android uses, and the
 *     parsed manifest — fullscreen, any orientation, 192, 512 and maskable
 *     icons — plus the tags iOS reads instead of a manifest;
 *   - offline: the service worker takes the page, and the page loads with
 *     the network off;
 *   - rotation: a game in progress turned tall → wide → tall keeps every bit
 *     of its state and the screen it was on;
 *   - no scroll, no zoom: the page cannot be scrolled or pinched on any of
 *     several screens, in either frame;
 *   - notched phones: with an iPhone's safe-area insets emulated, the frame
 *     sits wholly inside the safe area in both frames.
 *
 * What it cannot do is hold a phone. The last step — Add to Home Screen on a
 * real iPhone and a real Android phone — is on the checklist it prints.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { openChrome, wait } from './lib/chrome.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = 5217;
const ORIGIN = `http://localhost:${PORT}`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.json': 'application/json',
};

/**
 * Flipped on for the last check: from then on the server hands out a service
 * worker with a different version stamp, which is exactly what a deploy looks
 * like to a browser that already has the game.
 */
let deployed = false;

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    let body = await readFile(join(DIST, path));
    if (deployed && path === '/sw.js') {
      body = Buffer.from(String(body).replace(/underkeep-/, 'underkeep-next-'));
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      // A worker the browser is told it may reuse would never be fetched
      // again, and the update check below would have nothing to find.
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

const problems = [];
const seen = [];
const chrome = await openChrome();

try {
  await chrome.setSize(390, 844, 3);
  await chrome.page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await chrome.open(`${ORIGIN}/`, 1200);

  /* -- the service worker takes the page -------------------------------- */

  const controlled = await chrome.evaluate(`(async () => {
    const ready = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
    ]);
    if (!ready) return 'never';
    return Boolean(navigator.serviceWorker.controller) || 'ready';
  })()`);
  if (controlled === 'never') problems.push('no service worker registered within 10 s, so there is no offline copy');
  // The first load registers it; a reload is what it controls.
  await chrome.open(`${ORIGIN}/`, 1200);
  const nowControlled = await chrome.evaluate('Boolean(navigator.serviceWorker.controller)');
  if (!nowControlled) problems.push('the service worker does not control the page after a reload');
  else seen.push(`service worker: registered (${controlled === true ? 'controlling' : 'ready'}), controlling after a reload`);

  /* -- installability: what Chrome (and Android) checks ------------------ */

  const { installabilityErrors = [] } = await chrome.page('Page.getInstallabilityErrors');
  if (installabilityErrors.length) {
    problems.push(`Chrome will not offer to install it: ${installabilityErrors.map((e) => e.errorId).join(', ')}`);
  } else {
    seen.push('installable: Chrome reports no installability errors');
  }

  const { data, errors = [] } = await chrome.page('Page.getAppManifest');
  if (errors.length) problems.push(`the manifest has errors: ${errors.map((e) => e.message).join('; ')}`);
  const manifest = JSON.parse(data || '{}');
  if (manifest.display !== 'fullscreen') problems.push(`the manifest opens "${manifest.display}", not fullscreen`);
  if (!['any', undefined].includes(manifest.orientation)) {
    problems.push(`the manifest locks the orientation to "${manifest.orientation}"; both frames must open`);
  }
  const sizes = (manifest.icons ?? []).map((icon) => `${icon.sizes}:${icon.purpose ?? 'any'}`);
  for (const wanted of ['192x192:any', '512x512:any', '192x192:maskable', '512x512:maskable']) {
    if (!sizes.includes(wanted)) problems.push(`the manifest has no ${wanted} icon`);
  }
  seen.push(`manifest: display ${manifest.display}, orientation ${manifest.orientation ?? 'any'}, icons ${sizes.join(', ')}`);

  /* -- what iOS reads instead -------------------------------------------- */

  const ios = JSON.parse(await chrome.evaluate(`(async () => {
    const meta = (name) => document.querySelector('meta[name="' + name + '"]')?.content ?? null;
    const touch = document.querySelector('link[rel="apple-touch-icon"]')?.href ?? null;
    const icon = touch ? await fetch(touch).then((r) => r.ok ? r.blob() : null) : null;
    const size = icon ? await createImageBitmap(icon).then((b) => b.width + 'x' + b.height) : null;
    return JSON.stringify({
      capable: meta('apple-mobile-web-app-capable'),
      bar: meta('apple-mobile-web-app-status-bar-style'),
      title: meta('apple-mobile-web-app-title'),
      viewport: meta('viewport'),
      touchIcon: size,
    });
  })()`));
  if (ios.capable !== 'yes') problems.push('iOS will not open it fullscreen: apple-mobile-web-app-capable is missing');
  if (ios.bar !== 'black-translucent') problems.push('iOS keeps its status bar over the game: the status bar style is not black-translucent');
  if (ios.touchIcon !== '180x180') problems.push(`the Home Screen icon for iOS is ${ios.touchIcon ?? 'missing'}, not 180x180`);
  for (const part of ['user-scalable=no', 'viewport-fit=cover', 'width=device-width']) {
    if (!ios.viewport?.includes(part)) problems.push(`the viewport tag lacks ${part}`);
  }
  seen.push(`iOS: capable ${ios.capable}, status bar ${ios.bar}, touch icon ${ios.touchIcon}, viewport "${ios.viewport}"`);

  /* -- offline -------------------------------------------------------------- */

  await chrome.page('Network.enable');
  await chrome.page('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await chrome.open(`${ORIGIN}/`, 1200);
  const offlineTitle = await chrome.evaluate(`document.querySelector('[data-region^="title."]') ? 'title' : document.body.textContent.slice(0, 40)`);
  if (offlineTitle !== 'title') problems.push(`offline, the page shows "${offlineTitle}" instead of the Title screen`);
  else seen.push('offline: the Title screen loads with the network off');
  await chrome.page('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  /* -- rotation keeps everything ----------------------------------------- */

  await chrome.evaluate(`underkeep.newGame({ seed: 8123 })`);
  await wait(400);
  for (const command of ['forward', 'forward', 'turnLeft', 'forward', 'turnRight', 'forward']) {
    await chrome.evaluate(`underkeep.run.press(${JSON.stringify(command)})`);
  }
  await chrome.evaluate(`underkeep.router.go('pack')`);
  await wait(200);
  const state = `JSON.stringify({
    frame: document.getElementById('app').classList.contains('wide') ? 'wide' : 'tall',
    screen: underkeep.router.current.id,
    params: underkeep.router.current.params,
    pos: underkeep.run.ex.pos,
    facing: underkeep.run.ex.facing,
    steps: underkeep.run.ex.steps,
    log: underkeep.run.log.map((l) => l.text),
    hero: underkeep.session.hero,
  })`;
  const before = JSON.parse(await chrome.evaluate(state));
  const frames = [before.frame];
  for (const [w, h] of [[844, 390], [390, 844]]) {
    await chrome.setSize(w, h, 3);
    await wait(300);
    const now = JSON.parse(await chrome.evaluate(state));
    frames.push(now.frame);
    const { frame: _a, ...kept } = now;
    const { frame: _b, ...was } = before;
    if (JSON.stringify(kept) !== JSON.stringify(was)) problems.push(`turning the phone to ${w}x${h} changed the game's state`);
  }
  if (frames.join() !== 'tall,wide,tall') problems.push(`the frame went ${frames.join(' → ')}, not tall → wide → tall`);
  else seen.push(`rotation: tall → wide → tall on the Pack screen, hero, floor, log and screen unchanged`);

  /* -- no scroll, no zoom -------------------------------------------------- */

  for (const [w, h] of [[390, 844], [844, 390]]) {
    await chrome.setSize(w, h, 3);
    for (const screen of ['title', 'explore', 'combat', 'pack', 'settings', 'hall']) {
      // The Combat screen is only ever reached from a fight, so it gets one.
      await chrome.evaluate(`(() => {
        if (${JSON.stringify(screen)} === 'combat' && !underkeep.session.fight) underkeep.session.startFight();
        underkeep.router.go(${JSON.stringify(screen)});
      })()`);
      await wait(150);
      const moved = JSON.parse(await chrome.evaluate(`(() => {
        window.scrollTo(0, 400);
        document.scrollingElement.scrollTop = 400;
        document.body.scrollTop = 400;
        const pinch = new Event('gesturestart', { cancelable: true, bubbles: true });
        document.dispatchEvent(pinch);
        return JSON.stringify({
          scrollY: window.scrollY,
          scrollTop: document.scrollingElement.scrollTop,
          tallerThanScreen: document.documentElement.scrollHeight > window.innerHeight + 1,
          widerThanScreen: document.documentElement.scrollWidth > window.innerWidth + 1,
          pinchRefused: pinch.defaultPrevented,
          scale: window.visualViewport?.scale ?? 1,
          touchAction: getComputedStyle(document.body).touchAction,
        });
      })()`));
      const where = `${screen} at ${w}x${h}`;
      if (moved.scrollY || moved.scrollTop) problems.push(`${where}: the page scrolled`);
      if (moved.tallerThanScreen || moved.widerThanScreen) problems.push(`${where}: the page is bigger than the screen`);
      if (!moved.pinchRefused) problems.push(`${where}: a pinch is not refused`);
      if (moved.scale !== 1) problems.push(`${where}: the page is zoomed to ${moved.scale}`);
      if (!/manipulation|none/.test(moved.touchAction)) problems.push(`${where}: double-tap zoom is not off (touch-action ${moved.touchAction})`);
    }
  }
  seen.push('no scroll, no zoom: 6 screens in both frames; the page never moved, a pinch is refused, double-tap zoom is off');

  /* -- notched phones: the frame stays inside the safe area -------------- */

  // An iPhone with a Dynamic Island, held both ways: the notch and the home
  // indicator eat the top and bottom tall, the sides and bottom wide.
  const notched = [
    { w: 393, h: 852, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
    { w: 852, h: 393, insets: { top: 0, bottom: 21, left: 59, right: 59 } },
  ];
  for (const { w, h, insets } of notched) {
    await chrome.setSize(w, h, 3);
    await chrome.page('Emulation.setSafeAreaInsetsOverride', { insets });
    await chrome.evaluate(`underkeep.router.go('explore')`);
    await wait(250);
    const box = JSON.parse(await chrome.evaluate(`JSON.stringify(document.getElementById('app').getBoundingClientRect())`));
    const where = `${w}x${h} with a notch`;
    const slack = 0.5; // sub-pixel rounding
    if (box.top < insets.top - slack) problems.push(`${where}: the frame starts ${(insets.top - box.top).toFixed(1)} px under the notch`);
    if (box.bottom > h - insets.bottom + slack) problems.push(`${where}: the frame runs ${(box.bottom - (h - insets.bottom)).toFixed(1)} px under the home indicator`);
    if (box.left < insets.left - slack || box.right > w - insets.right + slack) problems.push(`${where}: the frame runs into a side inset`);
    // The frame should fill the safe area along its tighter side.
    const fills = Math.max(box.height / (h - insets.top - insets.bottom), box.width / (w - insets.left - insets.right));
    if (fills < 0.98) problems.push(`${where}: the frame uses only ${Math.round(fills * 100)}% of the safe area`);
  }
  await chrome.page('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
  seen.push('notched phones: the frame sits inside the safe area, tall and wide, and fills it');

  /* -- a new build tells the player (DECISIONS, 2026-09-22) -------------- */

  // A deploy, as the installed game meets one: the page is already controlled
  // by the old worker, the server starts serving a new one, and the game asks
  // whether to restart. Nothing is reloaded here — that is the whole point.
  await chrome.setSize(390, 844, 3);
  await chrome.open(`${ORIGIN}/`, 1200);
  deployed = true;
  const asked = await chrome.evaluate(`(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'no registration';
    await registration.update();
    for (let i = 0; i < 40; i += 1) {
      const sheet = document.querySelector('[data-region="update.sheet"]');
      if (sheet) return sheet.textContent.includes('RESTART NOW') ? 'asked' : 'wrong sheet';
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return 'never asked';
  })()`);
  if (asked !== 'asked') problems.push(`a new build did not reach the player: ${asked}`);
  else seen.push('a new build: the game notices the deploy and offers a restart');

  // And RESTART NOW puts the player on it: the page comes back fresh, with
  // nothing left to ask about and the Title screen up.
  if (asked === 'asked') {
    await chrome.evaluate(`[...document.querySelectorAll('[data-region="update.sheet"] button')]
      .find((node) => node.textContent.includes('RESTART NOW')).click()`);
    await wait(2000);
    const after = JSON.parse(await chrome.evaluate(`JSON.stringify({
      asked: underkeep.updates.asked,
      controlled: Boolean(navigator.serviceWorker.controller),
      screen: document.querySelector('[data-region]')?.dataset.region ?? 'none',
    })`));
    if (after.asked) problems.push('RESTART NOW did not reload the page');
    else if (!after.controlled || !after.screen.startsWith('title.')) {
      problems.push(`after RESTART NOW the game came back as ${after.screen}, controlled: ${after.controlled}`);
    } else seen.push('RESTART NOW: the page reloads onto the new build and opens on the Title screen');
  }
} finally {
  await chrome.close();
  server.close();
}

console.log('');
for (const line of seen) console.log(`  ok  ${line}`);
console.log(`
  Still needs a hand on a real phone (Chrome cannot hold one):
    - iPhone, Safari: Share → Add to Home Screen; open it from the icon — no Safari bars, turn the phone both ways.
    - Android, Chrome: menu → Install app (or the install banner); open it — fullscreen, turn both ways.
    - On both: flight mode on, open from the icon — the Title screen still loads.
    - On a notched iPhone: nothing sits under the notch or the home indicator, held either way.
    - On a real tablet: every screen in both orientations (00, Launch checklist).
    - Two phones: EXPORT on one (Settings), IMPORT the file on the other, and play on.
`);
if (problems.length) {
  console.log('  what is wrong:\n');
  for (const line of problems) console.log(`    - ${line}`);
  console.log('');
  process.exit(1);
}
console.log('  install check holds\n');
