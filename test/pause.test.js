/**
 * @vitest-environment happy-dom
 *
 * The Pause Menu sheet (`00-build-outline.md`, Exploration).
 */
import { describe, it, expect, vi } from 'vitest';
import { pause, ENTRIES } from '../src/ui/screens/pause.js';
import { validateScreen } from '../src/shell/layout.js';
import { t } from '../src/data/strings.js';

const mount = (has = () => false) => {
  const router = { has, go: vi.fn(), closeSheet: vi.fn() };
  return { router, built: pause.build({ router }) };
};

describe('the Pause Menu', () => {
  it('places inside both frames', () => {
    expect(validateScreen(pause)).toEqual([]);
  });

  it('lists what the outline lists, in order', () => {
    const { built } = mount();
    const labels = [...built.sheet.querySelectorAll('.btn .label')].map((n) => n.textContent);
    expect(labels).toEqual([
      t('pause.resume'),
      ...ENTRIES.map((entry) => t(entry.label)),
      t('pause.quit'),
    ]);
  });

  it('resumes by closing itself', () => {
    const { built, router } = mount();
    built.sheet.querySelector('.btn--primary').click();
    expect(router.closeSheet).toHaveBeenCalled();
  });

  it('quits to the title screen', () => {
    const { built, router } = mount();
    built.sheet.querySelector('.btn--risky').click();
    expect(router.go).toHaveBeenCalledWith('title');
  });

  it('says why an entry cannot be picked yet, and opens the ones that can', () => {
    const { built, router } = mount((id) => id === 'settings');
    const buttons = [...built.sheet.querySelectorAll('.btn')];
    const settings = buttons.find((b) => b.textContent.startsWith(t('pause.settings')));
    const hero = buttons.find((b) => b.textContent.startsWith(t('pause.hero')));

    expect(hero.hasAttribute('disabled')).toBe(true);
    expect(hero.textContent).toContain(t('common.comingSoon'));

    settings.click();
    expect(router.go).toHaveBeenCalledWith('settings');
  });

  it('camps from the menu, and says why it cannot', () => {
    const camp = (built) => [...built.sheet.querySelectorAll('.btn')].find((b) => b.textContent.startsWith(t('pause.camp')));

    const inTown = pause.build({ router: { has: () => false, go: vi.fn(), closeSheet: vi.fn() } });
    expect(camp(inTown).hasAttribute('disabled')).toBe(true);
    expect(camp(inTown).textContent).toContain(t('pause.why.inTown'));

    const noRation = pause.build({ router: { has: () => false }, run: { campReason: 'noRation' }, camp: vi.fn() });
    expect(camp(noRation).textContent).toContain(t('pause.why.noRation'));

    const router = { has: () => false, go: vi.fn(), replace: vi.fn(), closeSheet: vi.fn() };
    const rest = vi.fn(() => ({ events: [], next: null }));
    camp(pause.build({ router, run: { campReason: null }, camp: rest })).click();
    expect(rest).toHaveBeenCalled();
    expect(router.closeSheet).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('explore');

    const fightRouter = { has: () => false, go: vi.fn(), replace: vi.fn(), closeSheet: vi.fn() };
    camp(pause.build({ router: fightRouter, run: { campReason: null }, camp: () => ({ events: [], next: 'combat' }) })).click();
    expect(fightRouter.go).toHaveBeenCalledWith('combat');
  });
});
