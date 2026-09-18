/**
 * Frame selection: tall 9 x 18 or wide 18 x 9, chosen by the viewport's shape,
 * not by the device. 00-build-outline.md, "Choosing the frame".
 */

/** A viewport this wide relative to its height uses the wide frame. */
export const WIDE_ASPECT = 1.2;

/**
 * @param {number} width
 * @param {number} height
 * @returns {'tall' | 'wide'}
 */
export function frameFor(width, height) {
  if (height <= 0) return 'tall';
  return width / height >= WIDE_ASPECT ? 'wide' : 'tall';
}

/**
 * Watches the viewport and reports frame changes. `--u` comes from CSS alone,
 * so this only has to toggle the class and let the screen re-render.
 * @param {HTMLElement} app
 * @param {(frame: 'tall' | 'wide') => void} onChange
 */
export function watchFrame(app, onChange) {
  let current = frameFor(window.innerWidth, window.innerHeight);
  app.classList.toggle('wide', current === 'wide');

  const check = () => {
    const next = frameFor(window.innerWidth, window.innerHeight);
    if (next === current) return;
    current = next;
    app.classList.toggle('wide', next === 'wide');
    onChange(next);
  };

  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  // Safari fires resize before the new size settles after a rotation.
  window.visualViewport?.addEventListener('resize', check);

  return {
    get frame() {
      return current;
    },
    check,
  };
}
