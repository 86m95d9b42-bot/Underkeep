/**
 * @vitest-environment happy-dom
 *
 * Export and import (`05` section 11): a slot out as one line of text — the
 * file and the copyable string are the same line — and back in, checked the
 * way a slot is checked when it loads. Adventurer only.
 */
import { describe, it, expect, vi } from 'vitest';
import { EXPORT_PREFIX, exportName, exportText, importSlot, importText, whyNotExport } from '../src/save/transfer.js';
import { SAVE_VERSION } from '../src/save/migrations.js';
import { takeSnapshot, restoreSession } from '../src/save/snapshot.js';
import { encode, seal, stableStringify } from '../src/save/codec.js';
import { createSession } from '../src/systems/session.js';
import { settings as settingsScreen } from '../src/ui/screens/settings.js';
import { loopHero } from '../tools/lib/looper.js';

function aSave(mode = 'adventurer') {
  const hero = loopHero(4242);
  hero.mode = mode;
  const session = createSession({ hero, seed: 4242 });
  session.descend({ floor: 1 });
  for (let i = 0; i < 12; i += 1) session.run.press(i % 3 ? 'forward' : 'turnLeft');
  return takeSnapshot(session, { now: new Date('2026-09-21T10:00:00Z') });
}

describe('a save as one line of text', () => {
  it('goes out and comes back as the same game', async () => {
    const save = aSave();
    const text = await exportText(save);
    expect(text.startsWith(EXPORT_PREFIX)).toBe(true);
    expect(text).not.toMatch(/\s/);
    const back = await importText(text);
    const { checksum: _a, ...sent } = save;
    const { checksum: _b, ...got } = back.save;
    expect(stableStringify(got)).toBe(stableStringify(sent));
    // And it plays: the same hero, standing in the same place.
    expect(restoreSession(back.save).run.ex.pos).toEqual(save.run.ex.pos);
  });

  it('survives the line being wrapped or padded on its way to another phone', async () => {
    const text = await exportText(aSave());
    const wrapped = `\n  ${text.slice(0, 40)}\n${text.slice(40)}  \n`;
    expect((await importText(wrapped)).save).toBeTruthy();
  });

  it('refuses what is not a save, and a save that has been changed', async () => {
    expect(await importText('hello')).toEqual({ why: 'notASave' });
    const text = await exportText(aSave());
    const flipped = text.slice(0, -8) + (text.at(-8) === 'A' ? 'B' : 'A') + text.slice(-7);
    expect(await importText(flipped)).toEqual({ why: 'damaged' });
    expect(await importText(`${EXPORT_PREFIX}!!!not-base64`)).toEqual({ why: 'damaged' });
  });

  it('never lets an Ironman save out, or in (05 section 11)', async () => {
    const ironman = aSave('ironman');
    expect(whyNotExport(ironman)).toBe('ironman');
    await expect(exportText(ironman)).rejects.toThrow(/ironman/);
    // A line made by hand for one, sealed properly, is still refused at the door.
    const sealed = await seal(structuredClone(ironman));
    const bytes = new TextEncoder().encode(encode(sealed));
    const handMade = EXPORT_PREFIX + btoa(String.fromCharCode(...bytes));
    expect(await importText(handMade)).toEqual({ why: 'ironman' });
    expect(whyNotExport(null)).toBe('noSave');
  });

  it('refuses a save from a newer version of the game', async () => {
    const save = { ...aSave(), version: SAVE_VERSION + 1 };
    const text = await exportText(save);
    expect(await importText(text)).toEqual({ why: 'newer' });
  });

  it('is named after the hero and the day', () => {
    expect(exportName({ hero: { name: 'Harrow' }, savedAt: '2026-09-21T10:00:00Z' })).toBe('underkeep-harrow-2026-09-21.txt');
    expect(exportName({ hero: { name: '!!' } })).toBe('underkeep-hero-save.txt');
  });
});

describe('which slot an import takes', () => {
  const slots = ['1', '2', '3'];
  const save = { masterSeed: 4242, hero: { name: 'Harrow' } };

  it('restores over the same game, wherever it is', () => {
    const taken = [{ slot: '2', summary: { masterSeed: 4242, name: 'Harrow' } }];
    expect(importSlot(save, taken, slots)).toBe('2');
  });

  it('otherwise takes the first free slot', () => {
    expect(importSlot(save, [{ slot: '1', summary: { masterSeed: 1, name: 'Other' } }], slots)).toBe('2');
  });

  it('never overwrites a different game', () => {
    const full = slots.map((slot, i) => ({ slot, summary: { masterSeed: i, name: 'Other' } }));
    expect(importSlot(save, full, slots)).toBe(null);
  });
});

describe('the Settings buttons', () => {
  const store = { get: () => 's', set: vi.fn() };
  const routerFor = () => ({ back: vi.fn(), replace: vi.fn() });

  it('say why they are dimmed', () => {
    const built = settingsScreen.build({
      router: routerFor(),
      settings: store,
      frame: 'tall',
      transfer: { exportWhy: 'Adventurer mode only', importWhy: null },
    });
    expect(built.export.disabled).toBe(true);
    expect(built.export.textContent).toMatch(/Adventurer mode only/);
    expect(built.import.disabled).toBe(false);
  });

  it('export and import through the host, and show what happened', async () => {
    const router = routerFor();
    const exportSave = vi.fn(async () => 'Saved as underkeep-harrow.txt, and copied.');
    const importSave = vi.fn(async () => null);
    const built = settingsScreen.build({
      router,
      settings: store,
      frame: 'tall',
      transfer: { exportWhy: null, importWhy: null },
      exportSave,
      importSave,
    });
    built.export.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(exportSave).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('settings', { notice: 'Saved as underkeep-harrow.txt, and copied.' });
    built.import.click();
    await Promise.resolve();
    expect(importSave).toHaveBeenCalled();
    const noticed = settingsScreen.build({ router, settings: store, frame: 'tall', params: { notice: 'Done.' } });
    expect(noticed.top.textContent).toMatch(/Done\./);
  });
});
