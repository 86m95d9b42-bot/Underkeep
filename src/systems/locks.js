/**
 * Opening what is shut: doors now, chests in Phase 7 (`03` section 6).
 *
 * Phase 2 implements the two ways the **minimum hero** has — bashing and the
 * matching key — because those are what `05` section 4 assumes when it
 * promises a floor can be finished. Picking needs lockpicks (Phase 5), Knock
 * and Dispel Ward need skills or scrolls (Phase 4 and 5); each is listed here
 * with the reason it cannot be used yet, so the Door screen can show it.
 *
 * No DOM. Every roll comes from the stream it is handed.
 */
import locks from '../data/locks.json' with { type: 'json' };

/** @param {{ base: number, perFloor: number }} rule @param {number} floor */
export function tn(rule, floor) {
  return rule.base + rule.perFloor * floor;
}

/** What a method costs in steps (`03` section 1). */
export function stepsFor(method) {
  const spec = locks.methods[method];
  if (!spec) throw new Error(`no opening method: ${method}`);
  return spec.steps;
}

/**
 * The target number to bash a door: a stuck door has its own TN of 8 + F, and
 * a locked one uses its lock tier's TN plus 2 (`03` section 6).
 *
 * @param {object} door the floor's door entry
 * @param {number} floor
 */
export function bashTn(door, floor) {
  if (door.kind === 'stuck') {
    return door.bashTn ?? tn(locks.doorKinds.stuck.bashTn, floor);
  }
  const tier = locks.tiers[door.tier] ?? locks.tiers.standard;
  return tn(tier.pickTn, floor) + locks.methods.bash.tnBonus;
}

/**
 * Every way of opening this door, and for each whether the hero can use it
 * now. `why` is the reason it cannot be, ready for a disabled button.
 *
 * @param {object} door
 * @param {object} options
 * @param {Set<string>} [options.keysHeld] ids of keys picked up on this floor
 * @param {Record<string, boolean>} [options.has] lockpicks, skills, scrolls
 */
export function waysToOpen(door, { keysHeld = new Set(), has = {} } = {}) {
  const ways = [];
  const add = (method, usable, why) => ways.push({ method, usable, why });

  switch (door.kind) {
    case 'stuck':
      add('bash', true);
      add('pick', false, 'notPickable'); // 03: "Bash only. Can't be picked"
      break;
    case 'locked':
      add('bash', true);
      add('pick', Boolean(has.lockpicks), 'noLockpicks');
      add('knock', Boolean(has.knock), 'noKnock');
      add('skeletonKey', Boolean(has.skeletonKey), 'noSkeletonKey');
      break;
    case 'keyed':
      add('key', Boolean(door.keyId && keysHeld.has(door.keyId)), 'noKey');
      add('pick', Boolean(has.lockpicks), 'noLockpicks');
      break;
    case 'sealed':
      add('dispelWard', Boolean(has.dispelWard), 'noDispel');
      add('runeKey', Boolean(has.runeKey), 'noRuneKey');
      break;
    case 'barred':
      // Only from the other side; there is nothing to try from here.
      add('fromFarSide', false, 'barred');
      break;
    default:
      break;
  }
  return ways;
}

/** The best method the hero can actually use, or null. */
export function bestWay(door, options) {
  const usable = waysToOpen(door, options).filter((way) => way.usable);
  // A key or a spell beats breaking the door down: cheaper, and quiet.
  const order = ['key', 'skeletonKey', 'knock', 'dispelWard', 'pick', 'bash'];
  usable.sort((a, b) => order.indexOf(a.method) - order.indexOf(b.method));
  return usable[0] ?? null;
}

/**
 * Bashes a door: d20 + the hero's bonus against the door's TN + 2
 * (`03` section 6). The roll is returned rather than acted on, so the caller
 * can save it before showing it (`05` section 11).
 *
 * The noise check that follows is the caller's, on the encounter stream:
 * bashing is 2-in-6 to bring something (`step-clock.js`).
 *
 * @param {import('../engine/rng.js').Stream} rng the combat stream
 * @param {object} door
 * @param {number} floor
 * @param {number} [bonus] MIG mod + Brute Force + crowbar
 */
export function rollBash(rng, door, floor, bonus = 0) {
  const target = bashTn(door, floor);
  const roll = rng.d20();
  return {
    method: 'bash',
    roll,
    bonus,
    total: roll + bonus,
    tn: target,
    opened: roll + bonus >= target,
    steps: stepsFor('bash'),
    noisy: true,
  };
}

/** Using the matching key: automatic, one step, no risk (`03` section 6). */
export function useKey(door) {
  return { method: 'key', opened: true, steps: stepsFor('key'), keyId: door.keyId, noisy: false };
}

/**
 * Opens a door by the best means the hero has. Returns what happened, or null
 * when there is nothing they can do.
 *
 * @param {object} options
 * @param {object} options.door
 * @param {number} options.floor
 * @param {import('../engine/rng.js').Stream} options.rng the combat stream
 * @param {Set<string>} [options.keysHeld]
 * @param {Record<string, boolean>} [options.has]
 * @param {number} [options.bashBonus]
 */
export function tryOpen({ door, floor, rng, keysHeld, has, bashBonus = 0 }) {
  const way = bestWay(door, { keysHeld, has });
  if (!way) return null;
  if (way.method === 'key') return useKey(door);
  if (way.method === 'bash') return rollBash(rng, door, floor, bashBonus);
  // Every other method arrives with the phase that gives the hero the means.
  return null;
}

export { locks as lockData };
