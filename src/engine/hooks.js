/**
 * Event hooks (`06` section 16).
 *
 * The engine's second principle: skills, traits, conditions and items get no
 * special code paths. Each registers a hook on a named event, and the engine
 * fires the events in a fixed order. Anything that reads "if the hero has
 * Lucky…" inside the combat loop belongs here instead.
 *
 * Two orderings matter, and both come from `06` section 16:
 *
 *   - **Between events**: the engine fires them in the order of `EVENTS`.
 *   - **Within one event**: the target's hooks, then the attacker's, then the
 *     field's; and inside each group, the order the section's table lists them
 *     ("Poison, Burning, Bleeding, Latch, Regeneration…"). A hook whose name
 *     the table doesn't list runs after the listed ones, in the order it was
 *     registered.
 *
 * No DOM, no randomness: firing an event only calls what was registered.
 */
import combat from '../data/combat.json' with { type: 'json' };

/** Every event the engine fires, in the order `06` section 16 lists them. */
export const EVENTS = /** @type {const} */ ([
  'combatStart',
  'roundStart',
  'turnStart',
  'beforeAction',
  'attackRoll',
  'hit',
  'miss',
  'damageCalc',
  'damageTaken',
  'zeroHP',
  'kill',
  'turnEnd',
  'roundEnd',
  'combatEnd',
]);

/**
 * The hook names `06` section 16 lists under each event, in its order. A hook
 * registered with one of these names sorts itself; anything else runs after.
 *
 * `roundStart` and `roundEnd` come from `combat.json` rather than from this
 * table: `06` section 3 sets out those two rounds' steps in a finer order than
 * section 16's examples column, and the step list is the one that runs.
 */
export const ORDER = /** @type {Record<string, string[]>} */ ({
  combatStart: ['sneak', 'ambush', 'ceilingDrop', 'pounce'],
  roundStart: combat.roundStartOrder.hooks,
  turnStart: [
    'poisoned',
    'burning',
    'bleeding',
    'latch',
    'regeneration',
    'trollRegeneration',
    'aura',
    'recharge',
  ],
  beforeAction: ['legality', 'counterspell', 'guardian'],
  attackRoll: ['lucky', 'arcaneShield', 'shieldBlock', 'blink'],
  hit: ['rider', 'vampiric', 'crusader', 'divide', 'latch', 'pickpocket'],
  miss: ['riposte'],
  damageCalc: ['crit', 'backstab', 'weakened', 'resistance', 'dr', 'telegraphHalving'],
  damageTaken: ['wake', 'grabRelease', 'phase', 'morale'],
  zeroHP: ['undying', 'phylacteryShard', 'ferocity', 'relentless', 'wontStayDown', 'reform'],
  kill: ['cleave', 'manaSiphon', 'whisper', 'martyrsFlame', 'rotBloom', 'rowMovement', 'morale'],
  turnEnd: ['saves', 'durations'],
  roundEnd: combat.roundEndOrder.hooks,
  combatEnd: ['bloodstone', 'forager', 'xp', 'loot'],
});

/** Where a hook sits in its event's documented order. */
export function orderOf(event, name) {
  const index = ORDER[event]?.indexOf(name ?? '') ?? -1;
  // Unlisted hooks run after the listed ones, in registration order.
  return index === -1 ? ORDER[event]?.length ?? 0 : index;
}

/** The three groups of `06` section 16, in the order they run. */
export const GROUPS = /** @type {const} */ (['target', 'attacker', 'field']);

/**
 * Which group a hook belongs to for this firing: a hook owned by the event's
 * target goes first, then one owned by its attacker, then everything else.
 */
function groupOf(hook, payload) {
  if (hook.owner != null && hook.owner === payload?.target?.id) return 0;
  if (hook.owner != null && hook.owner === payload?.attacker?.id) return 1;
  return 2;
}

/**
 * @typedef {object} HookOptions
 * @property {string} [name]   a name from `ORDER`, which sets where it runs
 * @property {string} [owner]  the unit whose hook this is; absent means the field
 * @property {number} [order]  overrides the documented order
 * @property {boolean} [once]  unregisters itself after it fires once
 * @property {{ uses: number, per: 'turn' | 'round' | 'combat' | 'rest' }} [limit]
 * @property {string} [source] what registered it, for the log and for removal
 */

/**
 * A register of hooks. One per combat; the engine fires into it.
 */
export function createHooks() {
  /** @type {Map<string, object[]>} */
  const registered = new Map();
  let nextSeq = 0;

  /**
   * @param {typeof EVENTS[number]} event
   * @param {(payload: object, hook: object) => any} handler
   * @param {HookOptions} [options]
   * @returns {() => void} removes the hook
   */
  function on(event, handler, options = {}) {
    if (!EVENTS.includes(event)) throw new Error(`no such event: ${event}`);
    const hook = {
      event,
      handler,
      name: options.name,
      owner: options.owner,
      order: options.order ?? orderOf(event, options.name),
      once: Boolean(options.once),
      limit: options.limit ? { ...options.limit, used: 0 } : null,
      source: options.source,
      seq: nextSeq++,
    };
    const list = registered.get(event) ?? [];
    list.push(hook);
    registered.set(event, list);
    return () => off(hook);
  }

  /** Removes one hook. */
  function off(hook) {
    const list = registered.get(hook.event);
    if (!list) return false;
    const index = list.indexOf(hook);
    if (index === -1) return false;
    list.splice(index, 1);
    return true;
  }

  /** Removes every hook an owner or a source registered: a unit dying, say. */
  function offAll({ owner, source } = {}) {
    let removed = 0;
    for (const list of registered.values()) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const hook = list[i];
        if ((owner != null && hook.owner === owner) || (source != null && hook.source === source)) {
          list.splice(i, 1);
          removed += 1;
        }
      }
    }
    return removed;
  }

  /** The hooks on an event, in the order they would run for this payload. */
  function list(event, payload) {
    return [...(registered.get(event) ?? [])].sort(
      (a, b) =>
        groupOf(a, payload) - groupOf(b, payload) || a.order - b.order || a.seq - b.seq,
    );
  }

  /**
   * Fires an event.
   *
   * The payload is the event: hooks read and change it in place, so a
   * `damageCalc` hook adjusts `payload.amount` and the next one sees the new
   * figure. `payload.cancel()` stops the rest of the chain, which is how
   * Counterspell and Blink work.
   *
   * @param {typeof EVENTS[number]} event
   * @param {object} [payload]
   * @returns {object} the payload, with `cancelled`, `log` and `fired`
   */
  function fire(event, payload = {}) {
    if (!EVENTS.includes(event)) throw new Error(`no such event: ${event}`);

    payload.event = event;
    payload.log ??= [];
    payload.fired ??= [];
    payload.cancelled ??= false;
    payload.cancel ??= (why) => {
      payload.cancelled = true;
      payload.cancelledBy = why;
      return payload;
    };
    payload.say ??= (line) => {
      payload.log.push(line);
      return payload;
    };

    for (const hook of list(event, payload)) {
      if (payload.cancelled) break;
      if (hook.limit && hook.limit.used >= hook.limit.uses) continue;

      const result = hook.handler(payload, hook);
      payload.fired.push(hook.name ?? hook.source ?? 'hook');
      if (hook.limit) hook.limit.used += 1;
      if (hook.once) off(hook);
      // A handler may cancel by returning false, which reads better than
      // calling cancel() from a one-line hook.
      if (result === false) payload.cancel(hook.name ?? hook.source);
    }
    return payload;
  }

  /**
   * Resets the hooks limited to a turn, a round, a combat or a rest. The
   * engine calls this at the start of each of those (`06` section 3 step 2
   * resets the per-round reaction flags this way).
   * @param {'turn' | 'round' | 'combat' | 'rest'} per
   */
  function resetLimits(per) {
    let reset = 0;
    for (const list of registered.values()) {
      for (const hook of list) {
        if (hook.limit?.per === per && hook.limit.used > 0) {
          hook.limit.used = 0;
          reset += 1;
        }
      }
    }
    return reset;
  }

  /** How many hooks are registered, all told or on one event. */
  function count(event) {
    if (event) return registered.get(event)?.length ?? 0;
    let total = 0;
    for (const list of registered.values()) total += list.length;
    return total;
  }

  /** Starts a fresh register: a new fight. */
  function clear() {
    registered.clear();
    nextSeq = 0;
  }

  return { on, off, offAll, fire, list, resetLimits, count, clear };
}
