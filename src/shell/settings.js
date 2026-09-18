/**
 * Player settings. These are shared by every save slot and live in
 * localStorage, not in the save file (00-build-outline.md, "Settings").
 *
 * Difficulty is listed here because the Settings screen shows it, but it is set
 * when a game begins and never changed afterwards, so it is read-only.
 *
 * No DOM: the store takes a storage object, so tests pass a fake one.
 */

const KEY = 'underkeep.settings.v1';

/**
 * Each setting is a label plus a closed set of options, which is exactly what
 * the Settings screen's segmented controls need.
 * @typedef {{ key: string, label: string, options: { value: string, label: string }[], locked?: boolean }} SettingSpec
 */

/** @type {SettingSpec[]} */
export const SETTINGS = [
  {
    key: 'textSize',
    label: 'TEXT SIZE',
    options: [
      { value: 's', label: 'S' },
      { value: 'm', label: 'M' },
      { value: 'l', label: 'L' },
    ],
  },
  {
    key: 'hand',
    label: 'CONTROLS',
    options: [
      { value: 'right', label: 'RIGHT-HAND' },
      { value: 'left', label: 'LEFT-HAND' },
    ],
  },
  {
    key: 'reactions',
    label: 'REACTION PROMPTS',
    options: [
      { value: 'ask', label: 'ASK' },
      { value: 'auto', label: 'AUTO' },
      { value: 'never', label: 'NEVER' },
    ],
  },
  {
    key: 'odds',
    label: 'SHOW ODDS',
    options: [
      { value: 'on', label: 'ON' },
      { value: 'off', label: 'OFF' },
    ],
  },
  {
    key: 'combatSpeed',
    label: 'COMBAT SPEED',
    options: [
      { value: 'normal', label: 'NORMAL' },
      { value: 'fast', label: 'FAST' },
      { value: 'instant', label: 'INSTANT' },
    ],
  },
  {
    key: 'haptics',
    label: 'HAPTICS',
    options: [
      { value: 'on', label: 'ON' },
      { value: 'off', label: 'OFF' },
    ],
  },
  {
    key: 'sound',
    label: 'SOUND',
    options: [
      { value: 'on', label: 'ON' },
      { value: 'off', label: 'OFF' },
    ],
  },
  {
    key: 'colorblind',
    label: 'COLORBLIND ICONS',
    options: [
      { value: 'on', label: 'ON' },
      { value: 'off', label: 'OFF' },
    ],
  },
];

/** The defaults the mockups show as selected. */
export const DEFAULTS = Object.freeze({
  textSize: 'm',
  hand: 'right',
  reactions: 'ask',
  odds: 'on',
  combatSpeed: 'normal',
  haptics: 'on',
  sound: 'on',
  colorblind: 'off',
});

/** @param {Record<string, unknown>} raw */
function clean(raw) {
  const out = { ...DEFAULTS };
  for (const spec of SETTINGS) {
    const value = raw?.[spec.key];
    if (spec.options.some((o) => o.value === value)) out[spec.key] = value;
  }
  return out;
}

/**
 * @param {Storage} [storage]
 */
export function createSettings(storage = globalThis.localStorage) {
  let values = { ...DEFAULTS };
  /** @type {Set<(values: typeof DEFAULTS) => void>} */
  const listeners = new Set();

  try {
    const raw = storage?.getItem(KEY);
    if (raw) values = clean(JSON.parse(raw));
  } catch {
    // A corrupt or unavailable store just means defaults; settings are never
    // important enough to stop the game starting.
  }

  const persist = () => {
    try {
      storage?.setItem(KEY, JSON.stringify(values));
    } catch {
      // Private browsing can refuse writes. The session still works.
    }
  };

  return {
    get all() {
      return { ...values };
    },
    /** @param {string} key */
    get(key) {
      return values[key];
    },
    /**
     * @param {string} key
     * @param {string} value
     * @returns {boolean} false if the key or value is not a real option
     */
    set(key, value) {
      const spec = SETTINGS.find((s) => s.key === key);
      if (!spec || spec.locked) return false;
      if (!spec.options.some((o) => o.value === value)) return false;
      if (values[key] === value) return true;
      values = { ...values, [key]: value };
      persist();
      for (const fn of listeners) fn({ ...values });
      return true;
    },
    reset() {
      values = { ...DEFAULTS };
      persist();
      for (const fn of listeners) fn({ ...values });
    },
    /** @param {(values: typeof DEFAULTS) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** @typedef {ReturnType<typeof createSettings>} SettingsStore */
