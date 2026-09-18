/**
 * @vitest-environment happy-dom
 *
 * Router behaviour: one screen at a time, sheets over a dimmed screen, back,
 * and the rule that matters most on a phone — rotating re-renders the current
 * screen and changes nothing about state (docs/DECISIONS.md, 2026-09-17).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRouter } from '../src/shell/router.js';
import { el } from '../src/ui/parts/el.js';

/** A history stand-in, so a test never depends on the real browser stack. */
function fakeHistory(onPop) {
  const entries = [];
  return {
    pushState: (state) => entries.push(state),
    back: () => {
      entries.pop();
      onPop();
    },
    get length() {
      return entries.length;
    },
  };
}

const home = {
  id: 'home',
  pattern: 'fold',
  regions: {
    heading: { tall: [1, 9, 1, 4] },
    open: { tall: [1, 9, 11, 12], tap: true },
  },
  build: ({ router }) => ({
    heading: el('span', { text: 'HOME' }),
    open: el('button', { text: 'OPEN', onClick: () => router.go('detail') }),
  }),
};

const detail = {
  id: 'detail',
  pattern: 'fold',
  regions: { body: { tall: [1, 9, 1, 8] } },
  build: ({ params }) => ({ body: el('span', { text: `DETAIL ${params.item ?? ''}`.trim() }) }),
};

const paused = {
  id: 'paused',
  pattern: 'panel',
  regions: { body: { tall: [1, 9, 10, 18], side: 'right' } },
  build: () => ({ body: el('span', { text: 'PAUSED' }) }),
};

/** @param {'tall' | 'wide'} startFrame */
function setup(startFrame = 'tall') {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById('app');
  let frame = startFrame;
  const popListeners = [];
  // happy-dom dispatches popstate on window, which the router listens for.
  const history = fakeHistory(() => window.dispatchEvent(new Event('popstate')));
  const router = createRouter({
    app,
    screens: { home, detail, paused },
    frame: () => frame,
    history,
  });
  return {
    app,
    router,
    history,
    rotate(next) {
      frame = next;
      router.render();
    },
    text: () => app.textContent,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('navigation', () => {
  it('shows one screen at a time', () => {
    const t = setup();
    t.router.go('home');
    expect(t.text()).toContain('HOME');
    t.router.go('detail');
    expect(t.text()).toContain('DETAIL');
    expect(t.text()).not.toContain('HOME');
  });

  it('hands a screen its parameters', () => {
    const t = setup();
    t.router.go('home');
    t.router.go('detail', { item: 'ROPE' });
    expect(t.text()).toContain('DETAIL ROPE');
  });

  it('goes back to the screen that opened this one', () => {
    const t = setup();
    t.router.go('home');
    t.router.go('detail');
    expect(t.router.back()).toBe(true);
    expect(t.text()).toContain('HOME');
    expect(t.router.depth).toBe(1);
  });

  it('has nowhere to go back to from the first screen', () => {
    const t = setup();
    t.router.go('home');
    expect(t.router.back()).toBe(false);
    expect(t.text()).toContain('HOME');
  });

  it('swaps a screen without deepening the stack', () => {
    const t = setup();
    t.router.go('home');
    t.router.replace('detail');
    expect(t.router.depth).toBe(1);
    expect(t.text()).toContain('DETAIL');
  });

  it('refuses a screen that does not exist', () => {
    const t = setup();
    expect(() => t.router.go('nowhere')).toThrow(/no screen/);
  });

  it('knows which screens exist, so a phase can disable a button', () => {
    const t = setup();
    expect(t.router.has('detail')).toBe(true);
    expect(t.router.has('hall')).toBe(false);
  });
});

describe('the phone back gesture', () => {
  it('does what the back button does', () => {
    const t = setup();
    t.router.go('home');
    t.router.go('detail');
    window.dispatchEvent(new Event('popstate'));
    expect(t.text()).toContain('HOME');
  });

  it('keeps the player in the game when there is nothing left to pop', () => {
    const t = setup();
    t.router.go('home');
    window.dispatchEvent(new Event('popstate'));
    expect(t.text()).toContain('HOME');
    expect(t.history.length).toBeGreaterThan(0);
  });

  it('lets a screen claim the gesture, as Exploration does for the Pause Menu', () => {
    const t = setup();
    const claiming = {
      ...home,
      id: 'claim',
      onBack: vi.fn(() => true),
    };
    const app = document.getElementById('app');
    const router = createRouter({
      app,
      screens: { claim: claiming },
      frame: () => 'tall',
      history: fakeHistory(() => window.dispatchEvent(new Event('popstate'))),
    });
    router.go('claim');
    router.back();
    expect(claiming.onBack).toHaveBeenCalled();
  });
});

describe('sheets', () => {
  it('sits over the screen that opened it, which stays visible but dimmed', () => {
    const t = setup();
    t.router.go('home');
    t.router.openSheet('paused');
    expect(t.text()).toContain('HOME');
    expect(t.text()).toContain('PAUSED');
    expect(t.app.classList.contains('has-sheet')).toBe(true);
  });

  it('closes back to the screen underneath', () => {
    const t = setup();
    t.router.go('home');
    t.router.openSheet('paused');
    t.router.closeSheet();
    expect(t.text()).not.toContain('PAUSED');
    expect(t.text()).toContain('HOME');
    expect(t.app.classList.contains('has-sheet')).toBe(false);
  });

  it('closes on the back gesture rather than leaving the screen', () => {
    const t = setup();
    t.router.go('home');
    t.router.openSheet('paused');
    window.dispatchEvent(new Event('popstate'));
    expect(t.text()).not.toContain('PAUSED');
    expect(t.text()).toContain('HOME');
  });

  it('closes on a tap outside itself', () => {
    const t = setup();
    t.router.go('home');
    t.router.openSheet('paused');
    t.app.querySelector('.sheet-scrim').click();
    expect(t.text()).not.toContain('PAUSED');
  });
});

describe('rotation', () => {
  it('re-renders the same screen in the other frame', () => {
    const t = setup('tall');
    t.router.go('home');
    t.router.go('detail', { item: 'ROPE' });
    t.rotate('wide');
    expect(t.text()).toContain('DETAIL ROPE');
  });

  it('changes nothing about where the player is', () => {
    const t = setup('tall');
    t.router.go('home');
    t.router.go('detail', { item: 'ROPE' });
    const before = { id: t.router.current.id, params: t.router.current.params, depth: t.router.depth };
    t.rotate('wide');
    t.rotate('tall');
    expect(t.router.current.id).toBe(before.id);
    expect(t.router.current.params).toEqual(before.params);
    expect(t.router.depth).toBe(before.depth);
    expect(t.router.back()).toBe(true);
    expect(t.text()).toContain('HOME');
  });

  it('keeps an open sheet open', () => {
    const t = setup('tall');
    t.router.go('home');
    t.router.openSheet('paused');
    t.rotate('wide');
    expect(t.text()).toContain('PAUSED');
    expect(t.app.classList.contains('has-sheet')).toBe(true);
  });

  it('places regions for the frame that is actually showing', () => {
    const t = setup('tall');
    t.router.go('home');
    const tall = t.app.querySelector('[data-region="home.open"]').style.gridRow;
    t.rotate('wide');
    const wide = t.app.querySelector('[data-region="home.open"]').style.gridRow;
    expect(tall).toBe('11 / 13');
    expect(wide).toBe('2 / 4');
  });
});
