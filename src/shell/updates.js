/**
 * Watching for a new build of the game.
 *
 * The release is one cached page (`public/sw.js`), so a player who installed
 * the game keeps running the build they have until the page is reloaded. The
 * service worker fetches the new one quietly; this notices when it has, and
 * the Update sheet asks the player whether to restart now
 * (`docs/DECISIONS.md`, 2026-09-22).
 *
 * This is a shell module: it talks to the browser, never to game state. The
 * container is passed in so the whole thing can be driven by a fake in tests.
 */

/** How long to wait before asking the server for a new build again. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * Registers the service worker and reports once, the first time a build other
 * than this one is ready to take over.
 *
 * Three things say so, and any of them is enough, because which one fires
 * depends on where the browser was in the install when the page opened:
 *
 *   - a worker already `waiting` when the page registers,
 *   - one reaching `installed` while this page still has a controller, and
 *   - the controller changing under a page that already had one.
 *
 * The first install of all is none of them: there is no controller until it
 * claims the page, and nothing has been replaced.
 *
 * @param {object} options
 * @param {ServiceWorkerContainer} options.container `navigator.serviceWorker`
 * @param {() => void} options.onReady called once, when a new build is ready
 * @param {string} [options.url] the worker to register
 * @param {number} [options.every] how often `check()` may really ask
 * @param {() => number} [options.now]
 */
export function watchForUpdates({
  container,
  onReady,
  url = './sw.js',
  every = CHECK_EVERY_MS,
  now = () => Date.now(),
}) {
  /** @type {ServiceWorkerRegistration | null} */
  let registration = null;
  let told = false;
  let lastCheck = now();
  // A page that had no controller is a first install, not an update.
  const hadController = Boolean(container?.controller);

  const ready = () => {
    if (told) return;
    told = true;
    onReady();
  };

  const watchWorker = (worker) => {
    if (!worker) return;
    worker.addEventListener?.('statechange', () => {
      if (worker.state === 'installed' && container.controller) ready();
    });
  };

  container?.addEventListener?.('controllerchange', () => {
    if (hadController) ready();
  });

  const started = Promise.resolve(container?.register?.(url))
    .then((found) => {
      registration = found ?? null;
      if (!registration) return null;
      if (registration.waiting && container.controller) ready();
      watchWorker(registration.installing);
      registration.addEventListener?.('updatefound', () => watchWorker(registration.installing));
      return registration;
    })
    // Offline play is a bonus; a failed registration must never stop a game.
    .catch(() => null);

  return {
    started,
    /**
     * Asks the server whether there is a new build, at most once every
     * `every` milliseconds. Called when the game comes back to the front,
     * which on a phone is the only moment a player would notice the answer.
     */
    check() {
      if (told || !registration || now() - lastCheck < every) return false;
      lastCheck = now();
      registration.update?.()?.catch?.(() => {});
      return true;
    },
  };
}
