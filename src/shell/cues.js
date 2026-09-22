/**
 * Feedback cues: one call, a buzz and a sound (00-build-outline.md,
 * "Feedback": a short haptic buzz on hits taken, crits, traps and level-ups).
 * Each half answers to its own setting. The screens call `buzz(kind)`, as they
 * did when there was only the motor, and get the sound with it.
 *
 * `cuesOf` turns what an action produced into cues, so the screens play them
 * once the result is on the page — resolve first, render second.
 */

/**
 * @param {{ buzz: (kind: string) => void }} haptics
 * @param {{ play: (kind: string) => boolean, unlock?: () => void }} sound
 */
export function createCues(haptics, sound) {
  return {
    /** @param {string} kind */
    buzz(kind) {
      haptics.buzz(kind);
      sound.play(kind);
    },
    /** Several at once, each played once, in order. */
    play(kinds = []) {
      for (const kind of new Set(kinds)) this.buzz(kind);
    },
    unlock() {
      sound.unlock?.();
    },
  };
}

/**
 * The cues an exploration or chest action earned: a trap going off, deep
 * water or a foul fountain hurting, a wall walked into.
 * @param {object[]} events
 * @returns {string[]}
 */
export function cuesOf(events = []) {
  const out = [];
  for (const event of events) {
    if (event.type === 'trapSprung') out.push('trap');
    else if (event.type === 'drowning' || event.type === 'backlash') out.push('hit');
    else if (event.type === 'fountain' && (event.result === 'poisoned' || event.result === 'condition')) out.push('hit');
    else if (event.type === 'blocked') out.push('bump');
  }
  return out;
}

/**
 * Plays cues on whatever feedback the screen was handed: the game's cues,
 * or — in a test or an older host — a plain `buzz`.
 * @param {{ play?: (kinds: string[]) => void, buzz?: (kind: string) => void } | null | undefined} target
 * @param {string[]} kinds
 */
export function playCues(target, kinds = []) {
  if (!target || kinds.length === 0) return;
  if (typeof target.play === 'function') target.play(kinds);
  else for (const kind of new Set(kinds)) target.buzz?.(kind);
}

