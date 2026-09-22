/**
 * When the game writes (`05` section 11, When the Game Saves).
 *
 *   - **commit** — now. Every random outcome, combat turn, inventory, gold or
 *     town change and floor change. The promise resolves once the save is
 *     durable, and a screen showing a random outcome waits for it: the
 *     result is committed before it is shown.
 *   - **soon** — within `stepBatchMs`. A step that rolled nothing.
 *   - **flush** — anything pending, now. The app going to the background.
 *
 * Writes never overlap: each waits for the one before it, and a write that has
 * not started yet is shared by everything that asked for it, since it will
 * snapshot the game as it is when it starts — which already includes them.
 *
 * `after` is the one-call form the screens use: it resolves an action, and if
 * the action drew on any carried random stream it commits before handing the
 * result back; otherwise it batches the write and hands it back at once.
 */
import rules from '../data/saving.json' with { type: 'json' };

export const STEP_BATCH_MS = rules.stepBatchMs;

/**
 * @param {object} options
 * @param {{ write: (slot: string, save: object) => Promise<any> }} options.store
 * @param {() => string | null} options.slot which slot to write, or null for none
 * @param {() => object} options.snapshot the game as a save, taken when a write starts
 * @param {() => string} [options.luck] a fingerprint of the carried streams
 * @param {(fn: () => void, ms: number) => any} [options.setTimer]
 * @param {(handle: any) => void} [options.clearTimer]
 * @param {(error: unknown) => void} [options.onError]
 */
export function createSaver({
  store,
  slot,
  snapshot,
  luck = () => '',
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
  onError = () => {},
}) {
  /** The write in flight, or a resolved promise. */
  let tail = Promise.resolve();
  /** A write that is queued but has not taken its snapshot yet. */
  let queued = null;
  let timer = null;
  let writes = 0;
  let last = null;

  function write() {
    if (queued) return queued;
    queued = tail.then(async () => {
      queued = null;
      const where = slot();
      if (!where) return null;
      try {
        last = await store.write(where, snapshot());
        writes += 1;
        return last;
      } catch (error) {
        onError(error);
        throw error;
      }
    });
    // The chain carries on after a failed write; the caller that asked for it
    // still sees the failure.
    tail = queued.catch(() => {});
    return queued;
  }

  const saver = {
    /** Writes now. Resolves once the save is durable. */
    commit() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      return write();
    },

    /** Writes within the step batch, unless something writes sooner. */
    soon() {
      if (timer !== null || queued) return;
      timer = setTimer(() => {
        timer = null;
        write().catch(() => {});
      }, STEP_BATCH_MS);
    },

    /** Writes anything pending now: the app is going to the background. */
    flush() {
      if (timer === null) return tail;
      return saver.commit();
    },

    /**
     * Resolves an action and saves it the way it needs saving. An action that
     * moved any carried stream rolled something, and is committed before its
     * result is handed back to be shown (`05` section 11).
     * @template T
     * @param {() => T} resolve
     * @returns {Promise<T>}
     */
    async after(resolve) {
      const before = luck();
      const result = resolve();
      if (luck() !== before) await saver.commit();
      else saver.soon();
      return result;
    },

    /** True while a write is waiting or running. */
    get pending() {
      return timer !== null || queued !== null;
    },
    get writes() {
      return writes;
    },
    get last() {
      return last;
    },
  };
  return saver;
}
