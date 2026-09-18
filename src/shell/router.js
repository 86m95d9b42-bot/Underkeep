/**
 * Router: one screen at a time, sheets over a dimmed screen, and a back button
 * that does exactly what the phone's own back gesture does.
 * 00-build-outline.md, "Screen map and navigation".
 *
 * Rendering is always the same operation: clear the frame, place the current
 * screen's regions for the active frame, and let the screen fill them. Nothing
 * about game state changes when the frame changes, so a rotation is just a
 * re-render (docs/DECISIONS.md, 2026-09-17).
 *
 * History: every `go` and `openSheet` pushes one entry, and every way back —
 * the on-screen button, the close button, the gesture — goes through
 * `history.back()`, so the browser's stack and ours can never drift apart.
 */
import { placeRegions, gridStyle } from './layout.js';
import { el } from '../ui/parts/el.js';

/**
 * @typedef {object} Screen
 * @property {string} id
 * @property {import('./layout.js').Pattern} [pattern]
 * @property {Record<string, import('./layout.js').RegionDef>} regions
 * @property {(ctx: any) => Record<string, Node | Node[] | null>} build
 * @property {(ctx: any) => boolean} [onBack] return true when the screen handled it
 */

/**
 * @param {object} options
 * @param {HTMLElement} options.app the #app element
 * @param {Record<string, Screen>} options.screens
 * @param {() => 'tall' | 'wide'} options.frame
 * @param {object} [options.ctx] extra context handed to every screen
 * @param {History} [options.history]
 */
export function createRouter({ app, screens, frame, ctx = {}, history = globalThis.history }) {
  /** @type {{ id: string, params: object }[]} */
  const stack = [];
  /** @type {{ id: string, params: object } | null} */
  let sheet = null;
  /** True once pushState has worked at least once; some embedded browsers refuse it. */
  let historyOk = true;

  const router = {
    get current() {
      return stack[stack.length - 1] ?? null;
    },
    get currentSheet() {
      return sheet;
    },
    get depth() {
      return stack.length;
    },
    /** True when a screen exists. Phased building uses it to disable buttons. */
    has: (id) => Boolean(screens[id]),
    go,
    replace,
    back,
    closeSheet,
    openSheet,
    render,
  };

  const fullCtx = { ...ctx, router };

  /** @param {string} id @param {object} [params] */
  function go(id, params = {}) {
    if (!screens[id]) throw new Error(`router: no screen "${id}"`);
    sheet = null;
    stack.push({ id, params });
    push();
    render();
  }

  /** Swaps the current screen without deepening the back stack. */
  function replace(id, params = {}) {
    if (!screens[id]) throw new Error(`router: no screen "${id}"`);
    sheet = null;
    if (stack.length === 0) stack.push({ id, params });
    else stack[stack.length - 1] = { id, params };
    render();
  }

  /** @param {string} id @param {object} [params] */
  function openSheet(id, params = {}) {
    if (!screens[id]) throw new Error(`router: no sheet "${id}"`);
    sheet = { id, params };
    push();
    render();
  }

  /**
   * Asks to go back one step. Returns false only when there is nowhere to go.
   * The move itself happens in `step`, once the browser has popped its entry.
   */
  function back() {
    if (!sheet && stack.length <= 1 && !screens[router.current?.id]?.onBack) return false;
    if (historyOk) history.back();
    else step();
    return true;
  }

  /** Closes an open sheet. Goes through back() so history stays in step. */
  function closeSheet() {
    if (sheet) back();
  }

  /** Performs one step back. Never touches history. @returns {boolean} */
  function step() {
    if (sheet) {
      sheet = null;
      render();
      return true;
    }
    // A screen may claim the gesture: on Exploration, back opens the Pause Menu.
    if (screens[router.current?.id]?.onBack?.(fullCtx)) return true;
    if (stack.length <= 1) return false;
    stack.pop();
    render();
    return true;
  }

  function push() {
    try {
      history.pushState({ uk: stack.length + (sheet ? 1 : 0) }, '');
    } catch {
      historyOk = false;
    }
  }

  /**
   * Places one screen's regions and fills them. Region nodes carry their name
   * so scroll positions survive a re-render.
   * @param {Screen} screen
   * @param {object} params
   * @param {Map<string, number>} scrollTops
   */
  function renderScreen(screen, params, scrollTops) {
    const placements = placeRegions(screen, frame());
    const built = screen.build({ ...fullCtx, params, frame: frame() }) ?? {};

    for (const [name, placement] of placements) {
      const content = built[name];
      if (content == null) continue;
      const nodes = Array.isArray(content) ? content : [content];
      // A screen may hand back an element that is already a region (topBar,
      // sheet); anything else gets wrapped in one.
      const single = nodes.length === 1 && nodes[0] instanceof HTMLElement ? nodes[0] : null;
      const node =
        single && single.classList.contains('region')
          ? single
          : el('div', { class: 'region' }, nodes);

      Object.assign(node.style, gridStyle(placement));
      node.dataset.region = `${screen.id}.${name}`;
      app.append(node);

      const saved = scrollTops.get(node.dataset.region);
      if (saved != null) {
        const scroller = node.classList.contains('scroll') ? node : node.querySelector('.scroll');
        if (scroller) scroller.scrollTop = saved;
      }
    }
  }

  function render() {
    const entry = router.current;
    if (!entry) return;

    // Remember where the scrolling panels were, so rotating or repainting a
    // screen doesn't jump the player back to the top of a list.
    /** @type {Map<string, number>} */
    const scrollTops = new Map();
    for (const node of app.querySelectorAll('[data-region]')) {
      const scroller = node.classList.contains('scroll') ? node : node.querySelector('.scroll');
      if (scroller && scroller.scrollTop > 0) scrollTops.set(node.dataset.region, scroller.scrollTop);
    }

    app.replaceChildren();
    renderScreen(screens[entry.id], entry.params, scrollTops);

    app.classList.toggle('has-sheet', Boolean(sheet));
    if (sheet) {
      // A tap outside the sheet closes it, the same as the back gesture.
      const scrim = el('div', { class: 'region sheet-scrim', onClick: () => closeSheet() });
      scrim.dataset.region = 'scrim';
      app.append(scrim);
      renderScreen(screens[sheet.id], sheet.params, scrollTops);
    }
  }

  // The phone's own back gesture does what the back button does. When there is
  // nowhere left to go we push a fresh entry rather than dropping the player
  // out of an installed game.
  window.addEventListener('popstate', () => {
    if (!step()) push();
  });

  // One baseline entry, so the very first gesture has something to consume.
  push();

  return router;
}
