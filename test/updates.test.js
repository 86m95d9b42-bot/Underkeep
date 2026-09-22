/**
 * Watching for a new build (`src/shell/updates.js`; DECISIONS, 2026-09-22).
 *
 * The browser can be at any point in the install when the page opens, so the
 * watch has three ways of noticing. What matters is that every one of them
 * reports exactly once, and that the very first install — where there was no
 * build to replace — reports nothing at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { CHECK_EVERY_MS, watchForUpdates } from '../src/shell/updates.js';

/** The smallest thing that behaves like an EventTarget. */
function emitter(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(name, fn) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
    emit(name) {
      for (const fn of listeners.get(name) ?? []) fn();
    },
  };
}

/** A fake `navigator.serviceWorker` with one registration behind it. */
function container({ controller = null, waiting = null, installing = null } = {}) {
  const registration = emitter({ waiting, installing, update: vi.fn(() => Promise.resolve()) });
  const self = emitter({
    controller,
    register: vi.fn(() => Promise.resolve(registration)),
  });
  return { self, registration };
}

describe('noticing a new build', () => {
  it('reports when a worker installs under a page that already had one', async () => {
    const worker = emitter({ state: 'installing' });
    const { self, registration } = container({ controller: {} });
    const onReady = vi.fn();

    const watch = watchForUpdates({ container: self, onReady });
    await watch.started;
    registration.installing = worker;
    registration.emit('updatefound');
    expect(onReady).not.toHaveBeenCalled();

    worker.state = 'installed';
    worker.emit('statechange');
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('reports a worker that was already waiting when the page opened', async () => {
    const { self } = container({ controller: {}, waiting: {} });
    const onReady = vi.fn();
    await watchForUpdates({ container: self, onReady }).started;
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('reports when the controller changes under a page that had one', async () => {
    const { self } = container({ controller: {} });
    const onReady = vi.fn();
    await watchForUpdates({ container: self, onReady }).started;
    self.emit('controllerchange');
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('says nothing on the first install of all', async () => {
    // No controller: nothing was replaced, so there is nothing to tell.
    const worker = emitter({ state: 'installed' });
    const { self, registration } = container({ controller: null, installing: worker });
    const onReady = vi.fn();

    await watchForUpdates({ container: self, onReady }).started;
    worker.emit('statechange');
    self.emit('controllerchange');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('only ever reports once, however many ways it hears', async () => {
    const worker = emitter({ state: 'installed' });
    const { self, registration } = container({ controller: {}, waiting: {}, installing: worker });
    const onReady = vi.fn();

    await watchForUpdates({ container: self, onReady }).started;
    worker.emit('statechange');
    self.emit('controllerchange');
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('registers the worker, and a refused registration is not fatal', async () => {
    const { self } = container();
    await watchForUpdates({ container: self, onReady: vi.fn() }).started;
    expect(self.register).toHaveBeenCalledWith('./sw.js');

    const refused = emitter({ controller: null, register: () => Promise.reject(new Error('no')) });
    await expect(
      watchForUpdates({ container: refused, onReady: vi.fn() }).started,
    ).resolves.toBe(null);
  });
});

describe('asking the server again', () => {
  it('asks at most once every half hour, and never once a build is ready', async () => {
    let clock = 0;
    const { self, registration } = container({ controller: {} });
    const watch = watchForUpdates({ container: self, onReady: vi.fn(), now: () => clock });
    await watch.started;

    expect(watch.check()).toBe(false);
    clock += CHECK_EVERY_MS;
    expect(watch.check()).toBe(true);
    expect(registration.update).toHaveBeenCalledOnce();
    expect(watch.check()).toBe(false);

    clock += CHECK_EVERY_MS;
    self.emit('controllerchange');
    // The sheet is already asking; there is nothing more to find out.
    expect(watch.check()).toBe(false);
  });
});
