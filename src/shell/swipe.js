/**
 * Swipes. On the Exploration screen a swipe on the view moves the hero: up or
 * down to step, left or right to turn (`00-build-outline.md`, Exploration).
 *
 * The decision itself is a pure function so it can be tested without a browser;
 * only `onSwipe` touches the DOM.
 */

/** How far a drag must travel before it counts, as a share of the shorter side. */
export const SWIPE_SHARE = 0.12;

/** And never less than this, so a small view still needs a real swipe. */
export const SWIPE_MIN_PX = 24;

/** How long a swipe may take. A slower drag is someone resting their thumb. */
export const SWIPE_MAX_MS = 800;

/**
 * Which way a drag went, or null when it was too small to mean anything.
 * The larger axis wins, so a diagonal still reads as the direction it mostly
 * went rather than doing nothing.
 *
 * @param {number} dx @param {number} dy @param {number} threshold
 * @returns {'up' | 'down' | 'left' | 'right' | null}
 */
export function swipeDirection(dx, dy, threshold) {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < threshold) return null;
  if (absY >= absX) return dy < 0 ? 'up' : 'down';
  return dx < 0 ? 'left' : 'right';
}

/**
 * The threshold for an element of this size: a share of its shorter side, with
 * a floor in pixels.
 * @param {number} width @param {number} height
 */
export function thresholdFor(width, height) {
  return Math.max(SWIPE_MIN_PX, Math.min(width, height) * SWIPE_SHARE);
}

/**
 * Reports swipes on an element.
 *
 * @param {HTMLElement} node
 * @param {(direction: 'up' | 'down' | 'left' | 'right') => void} onDirection
 * @param {{ maxMs?: number, now?: () => number }} [options]
 * @returns {() => void} stops listening
 */
export function onSwipe(node, onDirection, { maxMs = SWIPE_MAX_MS, now = () => Date.now() } = {}) {
  /** @type {{ x: number, y: number, at: number } | null} */
  let start = null;
  /** Pointers currently down. A second finger is a pinch, not a swipe. */
  const active = new Set();

  const down = (event) => {
    active.add(event.pointerId);
    if (active.size > 1) {
      start = null;
      return;
    }
    start = { x: event.clientX, y: event.clientY, at: now() };
  };

  const up = (event) => {
    active.delete(event.pointerId);
    const from = start;
    start = null;
    if (!from || now() - from.at > maxMs) return;
    const box = node.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const direction = swipeDirection(
      event.clientX - from.x,
      event.clientY - from.y,
      thresholdFor(box.width, box.height),
    );
    if (direction) onDirection(direction);
  };

  const cancel = (event) => {
    active.delete(event?.pointerId);
    start = null;
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);

  return () => {
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', cancel);
    node.removeEventListener('pointerleave', cancel);
  };
}

/** What each swipe does on the Exploration screen. */
export const SWIPE_COMMANDS = /** @type {const} */ ({
  up: 'forward',
  down: 'back',
  left: 'turnLeft',
  right: 'turnRight',
});
