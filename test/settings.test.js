import { describe, it, expect } from 'vitest';
import { createSettings, SETTINGS, DEFAULTS } from '../src/shell/settings.js';

/** A stand-in for localStorage, so these tests need no browser. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get size() {
      return map.size;
    },
    raw: map,
  };
}

const KEY = 'underkeep.settings.v1';

describe('settings', () => {
  it('starts from the defaults the mockups show', () => {
    const settings = createSettings(fakeStorage());
    expect(settings.all).toEqual(DEFAULTS);
  });

  it('keeps every setting the Settings screen lists', () => {
    for (const spec of SETTINGS) {
      expect(Object.keys(DEFAULTS)).toContain(spec.key);
      expect(spec.options.map((o) => o.value)).toContain(DEFAULTS[spec.key]);
    }
  });

  it('writes a change straight through to storage', () => {
    const storage = fakeStorage();
    const settings = createSettings(storage);
    expect(settings.set('textSize', 'l')).toBe(true);
    expect(settings.get('textSize')).toBe('l');
    expect(JSON.parse(storage.getItem(KEY)).textSize).toBe('l');
  });

  it('reads a saved value back on the next session', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ ...DEFAULTS, hand: 'left' }) });
    expect(createSettings(storage).get('hand')).toBe('left');
  });

  it('refuses a value that is not one of the options', () => {
    const settings = createSettings(fakeStorage());
    expect(settings.set('textSize', 'xl')).toBe(false);
    expect(settings.get('textSize')).toBe(DEFAULTS.textSize);
  });

  it('refuses a key that is not a setting', () => {
    expect(createSettings(fakeStorage()).set('difficulty', 'easy')).toBe(false);
  });

  it('falls back to defaults when the stored value is rubbish', () => {
    const settings = createSettings(fakeStorage({ [KEY]: '{not json' }));
    expect(settings.all).toEqual(DEFAULTS);
  });

  it('drops a stored value that is no longer an option', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ textSize: 'xxl', sound: 'off' }) });
    const settings = createSettings(storage);
    expect(settings.get('textSize')).toBe(DEFAULTS.textSize);
    expect(settings.get('sound')).toBe('off');
  });

  it('tells subscribers about a change, and only a real one', () => {
    const settings = createSettings(fakeStorage());
    const seen = [];
    settings.subscribe((values) => seen.push(values.sound));
    settings.set('sound', 'off');
    settings.set('sound', 'off');
    expect(seen).toEqual(['off']);
  });

  it('stops telling a subscriber once it unsubscribes', () => {
    const settings = createSettings(fakeStorage());
    let count = 0;
    const off = settings.subscribe(() => (count += 1));
    settings.set('sound', 'off');
    off();
    settings.set('sound', 'on');
    expect(count).toBe(1);
  });

  it('works when there is no storage at all', () => {
    const settings = createSettings(undefined);
    expect(settings.set('haptics', 'off')).toBe(true);
    expect(settings.get('haptics')).toBe('off');
  });

  it('puts everything back with reset', () => {
    const settings = createSettings(fakeStorage());
    settings.set('odds', 'off');
    settings.reset();
    expect(settings.all).toEqual(DEFAULTS);
  });
});
