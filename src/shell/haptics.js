/**
 * A short buzz on hits taken, crits, traps, and level-ups
 * (00-build-outline.md, "Feedback"). Silent when the setting is off or the
 * device has no vibration motor, which covers iOS Safari.
 */

/** Patterns in milliseconds, one per kind of event. */
const PATTERNS = {
  tap: 8,
  hit: 18,
  crit: [22, 40, 22],
  trap: [30, 60, 30],
  levelUp: [14, 50, 14, 50, 30],
  warn: [10, 40, 10],
};

/** @param {import('./settings.js').SettingsStore} settings */
export function createHaptics(settings) {
  return {
    /** @param {keyof typeof PATTERNS} kind */
    buzz(kind) {
      if (settings.get('haptics') !== 'on') return;
      const pattern = PATTERNS[kind];
      if (!pattern) return;
      try {
        navigator.vibrate?.(pattern);
      } catch {
        // Nothing to do: haptics are decoration.
      }
    },
  };
}
