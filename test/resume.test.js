/**
 * Where a restored game opens (`05` section 11: "reopens at exactly the same
 * spot"): the screen the save was taken on, when that screen can be drawn
 * from the game alone.
 */
import { describe, it, expect } from 'vitest';
import { resumeScreen } from '../src/save/resume.js';

const inDungeon = (extra = {}) => ({ run: { chestAhead: null }, fight: null, ...extra });
const inTown = () => ({ run: null, fight: null });

describe('where Continue opens', () => {
  it('opens a fight in progress on Combat, whatever was on top of it', () => {
    const fight = { over: false };
    expect(resumeScreen(inDungeon({ fight }), 'combat')).toBe('combat');
    expect(resumeScreen(inDungeon({ fight }), 'pause')).toBe('combat');
    expect(resumeScreen(inDungeon({ fight }), 'loot')).toBe('combat');
  });

  it('opens a won fight on Loot when that is where it was closed', () => {
    const fight = { over: true };
    expect(resumeScreen(inDungeon({ fight }), 'loot')).toBe('loot');
    expect(resumeScreen(inDungeon({ fight }), 'combat')).toBe('combat');
  });

  it('reopens the dungeon screens that need nothing but the game', () => {
    for (const screen of ['explore', 'map', 'hero', 'skillTree', 'pack', 'levelUp']) {
      expect(resumeScreen(inDungeon(), screen)).toBe(screen);
    }
  });

  it('reopens a chest only while the hero still faces it', () => {
    expect(resumeScreen(inDungeon({ run: { chestAhead: { opened: false } } }), 'chest')).toBe('chest');
    expect(resumeScreen(inDungeon(), 'chest')).toBe('explore');
  });

  it('reopens the town and its services', () => {
    for (const screen of ['town', 'shop', 'inn', 'temple', 'sage', 'stash', 'gate', 'alchemist']) {
      expect(resumeScreen(inTown(), screen)).toBe(screen);
    }
  });

  it('falls back to where the hero stands for anything else', () => {
    expect(resumeScreen(inDungeon(), 'pause')).toBe('explore');
    expect(resumeScreen(inDungeon(), 'town')).toBe('explore');
    expect(resumeScreen(inDungeon(), null)).toBe('explore');
    expect(resumeScreen(inTown(), 'explore')).toBe('town');
    expect(resumeScreen(inTown(), 'itemDetail')).toBe('town');
  });
});
