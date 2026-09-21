/**
 * Opening what is shut (`03` section 6).
 *
 * Six ways through a door, and this is all of them: the bash and the matching
 * key Phase 2 built for the minimum hero, and now picking, Knock, Dispel Ward
 * and the two keys that open things by themselves. Each says what it wants,
 * what it rolls, what it costs in steps and what it risks — a jammed lock, a
 * broken pick, a needle, a backlash.
 *
 * Secret doors are here too: `03` section 6 finds them with section 3's own
 * detection rules, so the roll is the traps' and the answer is a door.
 *
 * Every roll is returned rather than acted on, so the caller can commit it
 * before showing it (`05` section 11). No DOM.
 */
import locks from '../data/locks.json' with { type: 'json' };
import { modFor } from '../data/attributes.js';
import { DETECTION } from '../data/traps.js';
import { floorDice, xpFor } from '../data/traps.js';

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

  // A jammed lock can no longer be picked: bashing, Knock or a Skeleton Key
  // are what is left (`03` section 6, Jammed locks).
  const canPick = Boolean(has.lockpicks) && !door.jammed;
  const pickWhy = door.jammed ? 'jammed' : 'noLockpicks';

  switch (door.kind) {
    case 'stuck':
      add('bash', true);
      add('pick', false, 'notPickable'); // 03: "Bash only. Can't be picked"
      break;
    case 'locked':
      add('bash', true);
      add('pick', canPick, pickWhy);
      add('knock', Boolean(has.knock), 'noKnock');
      add('skeletonKey', Boolean(has.skeletonKey), 'noSkeletonKey');
      break;
    case 'keyed':
      add('key', Boolean(door.keyId && keysHeld.has(door.keyId)), 'noKey');
      add('pick', canPick, pickWhy);
      add('knock', Boolean(has.knock), 'noKnock');
      add('skeletonKey', Boolean(has.skeletonKey), 'noSkeletonKey');
      break;
    case 'sealed':
      add('dispelWard', Boolean(has.dispelWard), 'noDispel');
      add('runeKey', Boolean(door.keyId && keysHeld.has(door.keyId)), 'noRuneKey');
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

/**
 * The TN to pick this lock. A Keyed door is picked at Masterwork + 2, because
 * its lock is meant to be opened with its key (`03` section 6).
 * @param {object} door
 * @param {number} floor
 */
export function pickTn(door, floor) {
  const kind = locks.doorKinds[door.kind] ?? {};
  const tier = locks.tiers[kind.tier ?? door.tier] ?? locks.tiers.standard;
  const base = kind.pickTierBonus
    ? tn(locks.tiers.masterwork.pickTn, floor) + kind.pickTierBonus
    : tn(tier.pickTn, floor);
  return base;
}

/** The TN to lift a Sealed door's ward: 14 + F (`03` section 6). */
export function dispelTn(floor) {
  return tn(locks.methods.dispelWard.tn, floor);
}

/** The TN to find a secret door: 12 + F (`03` section 6, Secret Doors). */
export function secretTn(floor) {
  return tn(locks.secretDoors.findTn, floor);
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
  const method = door.kind === 'sealed' ? 'runeKey' : 'key';
  return { method, opened: true, steps: stepsFor(method), keyId: door.keyId, noisy: false };
}

/**
 * Picking a lock: **d20 + AGI mod + Lockpicking vs. the lock's TN**, and four
 * ways to go wrong (`03` section 6).
 *
 *   - any failure: 1 in 6 the picks break, unless Lockpicking rank 2 says not;
 *   - a natural 1, or failing by 10 or more: the lock **jams**, and can never
 *     be picked again;
 *   - failing by 5 or more: a Needle Lock goes off, which the caller fires.
 *
 * @param {import('../engine/rng.js').Stream} rng the combat stream
 * @param {object} door
 * @param {number} floor
 * @param {object} [hero]
 */
/**
 * What the hero adds to a pick: AGI mod and Lockpicking (`03` section 6). The
 * odds the Chest screen's PICK key shows are this against `pickTn`, so the
 * button and the roll cannot disagree.
 */
export function pickBonus(hero = {}) {
  return modFor(hero.attributes?.agility) + (hero.explore?.pick ?? 0);
}

export function rollPick(rng, door, floor, hero = {}) {
  const spec = locks.methods.pick;
  const bonus = pickBonus(hero);
  const target = pickTn(door, floor);
  const roll = rng.d20();
  const total = roll + bonus;
  const natural1 = roll === 1;
  const opened = roll === 20 || (!natural1 && total >= target);
  const by = total - target;

  const out = {
    method: 'pick',
    roll,
    bonus,
    total,
    tn: target,
    opened,
    steps: stepsFor('pick') - (hero.explore?.pickSteps ?? 0),
    noisy: false,
    xp: opened ? xpFor('pickLock', floor, door.tier) : 0,
  };
  if (opened) return out;

  // A pick that never breaks never breaks (Lockpicking rank 2).
  out.broke = !hero.explore?.picksNeverBreak && rng.chance(1 / spec.breakInSix);
  out.jammed = natural1 || by <= -spec.jamOnFailBy;
  if (out.jammed) door.jammed = true;
  // "Failing by 5+ sets off a Needle Lock" — the trap is the caller's to fire.
  out.springsTrap = by <= -5;
  return out;
}

/**
 * Knock: automatic on a Simple or Good lock, a roll on a Masterwork one, and
 * a 1-in-6 noise check either way (`03` section 6).
 */
export function rollKnock(rng, door, floor, hero = {}) {
  const spec = locks.methods.knock;
  const order = locks.lockTierRoll.order;
  const automatic = order.indexOf(door.lock) <= order.indexOf(spec.automaticUpTo);
  const out = { method: 'knock', steps: stepsFor('knock'), noisy: true, opened: true };
  if (automatic) return out;

  const roll = rng.d20();
  const bonus = modFor(hero.attributes?.intellect);
  const target = pickTn(door, floor);
  return {
    ...out,
    roll,
    bonus,
    total: roll + bonus,
    tn: target,
    opened: roll === 20 || (roll !== 1 && roll + bonus >= target),
  };
}

/**
 * Dispel Ward on a Sealed door: **d20 + INT mod + Lore + 4 vs. 14 + F**, and
 * failing by 5 or more costs the hero floor dice of force damage that nothing
 * turns aside (`03` section 6).
 */
export function rollDispel(rng, door, floor, hero = {}) {
  const spec = locks.methods.dispelWard;
  const roll = rng.d20();
  const bonus = modFor(hero.attributes?.intellect) + (hero.explore?.magicTrap ?? 0) + spec.flat;
  const target = dispelTn(floor);
  const total = roll + bonus;
  const opened = roll === 20 || (roll !== 1 && total >= target);
  const out = {
    method: 'dispelWard',
    roll,
    bonus,
    total,
    tn: target,
    opened,
    steps: stepsFor('dispelWard'),
    noisy: false,
    xp: opened ? xpFor('sealed', floor) : 0,
  };
  if (!opened && total - target <= -5) {
    out.backlash = { damage: floorDice(floor), damageType: 'force', unresistable: true };
  }
  return out;
}

/** The Skeleton Key: any lock but Sealed, automatic, and used up. */
export function useSkeletonKey(door) {
  return {
    method: 'skeletonKey',
    opened: true,
    steps: stepsFor('skeletonKey'),
    usedUp: true,
    noisy: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Secret doors (`03` section 6)                                              */
/* -------------------------------------------------------------------------- */

/** What the hero's own sheet adds to finding a secret door. */
export function secretBonus(hero) {
  return hero?.explore?.search ?? 0;
}

/**
 * Looking for a secret door: the traps' own roll against 12 + F, with the
 * same −4 when it is the game looking rather than the hero
 * (`03` sections 3 and 6).
 *
 * @param {import('../engine/rng.js').Stream} rng
 * @param {object} hero
 * @param {object} secret the floor's entry, marked when it is found
 * @param {number} floor
 * @param {{ passive?: boolean, careful?: boolean }} [how]
 */
export function searchSecret(rng, hero, secret, floor, { passive = false, careful = false } = {}) {
  const roll = rng.d20({ advantage: careful && !passive });
  const penalty = passive ? locks.secretDoors.passiveNoticePenalty : 0;
  const total = roll + modFor(hero?.attributes?.wits) + secretBonus(hero) + penalty;
  const target = secretTn(floor);
  const found = roll === 20 || (roll !== 1 && total >= target);
  if (found) secret.found = true;
  return {
    roll,
    total,
    tn: target,
    found,
    passive,
    xp: found ? xpFor('secretDoor', floor) : 0,
  };
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
export function tryOpen({ door, floor, rng, keysHeld, has, hero = {}, bashBonus = 0, method }) {
  const way = method
    ? waysToOpen(door, { keysHeld, has }).find((one) => one.method === method && one.usable)
    : bestWay(door, { keysHeld, has });
  if (!way) return null;

  switch (way.method) {
    case 'key':
    case 'runeKey':
      return useKey(door);
    case 'skeletonKey':
      return useSkeletonKey(door);
    case 'bash':
      return rollBash(rng, door, floor, bashBonus);
    case 'pick':
      return rollPick(rng, door, floor, hero);
    case 'knock':
      return rollKnock(rng, door, floor, hero);
    case 'dispelWard':
      return rollDispel(rng, door, floor, hero);
    /* c8 ignore next 2 -- every way in the table is above */
    default:
      return null;
  }
}

export { locks as lockData };
