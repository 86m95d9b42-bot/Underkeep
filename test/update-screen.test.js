/**
 * @vitest-environment happy-dom
 *
 * The Update sheet: a new build is ready (DECISIONS, 2026-09-22).
 */
import { describe, it, expect, vi } from 'vitest';
import { update } from '../src/ui/screens/update.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { t } from '../src/data/strings.js';

const mount = () => {
  const router = { closeSheet: vi.fn() };
  const restart = vi.fn();
  return { router, restart, built: update.build({ router, restart }) };
};

/** The sheet's buttons by their visible label. */
const buttons = (built) =>
  new Map(
    [...built.sheet.querySelectorAll('button')].map((node) => [
      (node.querySelector('.label')?.textContent ?? node.textContent).trim(),
      node,
    ]),
  );

describe('the Update sheet', () => {
  it('places inside both frames', () => {
    expect(validateScreen(update)).toEqual([]);
  });

  it('sits in the middle of the frame, leaving the game readable around it', () => {
    expect(placeRegions(update, 'tall').get('sheet')).toEqual([1, 9, 6, 13]);
    expect(placeRegions(update, 'wide').get('sheet')).toEqual([5, 14, 2, 8]);
  });

  it('says what happened and offers the two answers', () => {
    const { built } = mount();
    expect(built.sheet.textContent).toContain(t('update.title'));
    expect(built.sheet.textContent).toContain(t('update.body'));
    const keys = buttons(built);
    expect([...keys.keys()]).toContain(t('update.restart'));
    expect([...keys.keys()]).toContain(t('update.later'));
  });

  it('has one primary button, and it is RESTART NOW', () => {
    const { built } = mount();
    const primary = built.sheet.querySelectorAll('.btn--primary');
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toContain(t('update.restart'));
  });

  it('restarts on RESTART NOW', () => {
    const { built, restart, router } = mount();
    buttons(built).get(t('update.restart')).click();
    expect(restart).toHaveBeenCalledOnce();
    expect(router.closeSheet).not.toHaveBeenCalled();
  });

  it('closes on NOT NOW, and says when the build will arrive instead', () => {
    const { built, restart, router } = mount();
    const later = buttons(built).get(t('update.later'));
    expect(later.textContent).toContain(t('update.laterHint'));
    later.click();
    expect(router.closeSheet).toHaveBeenCalledOnce();
    expect(restart).not.toHaveBeenCalled();
  });

  it('is closable, since a player mid-game may not want it now', () => {
    const { built, router } = mount();
    built.sheet.querySelector('[aria-label="Close"]').click();
    expect(router.closeSheet).toHaveBeenCalledOnce();
  });
});
