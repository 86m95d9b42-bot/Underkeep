/**
 * The smallest possible DOM helper. Every UI part is built from it, so there is
 * one place that knows how attributes, classes, and children are applied.
 */

/**
 * @param {string} tag
 * @param {Record<string, any>} [props] class, text, aria-*, on* handlers, style object
 * @param {(Node | string | null | false | undefined)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * An inline SVG icon from a list of path `d` strings. Icons are always
 * decorative: the button around them carries the label.
 * @param {string[]} paths
 * @param {number} [scale] size as a share of --u
 */
export function icon(paths, scale = 0.7) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.width = `calc(var(--u) * ${scale})`;
  svg.style.height = `calc(var(--u) * ${scale})`;
  svg.style.flexShrink = '0';
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const ICONS = {
  back: ['M15 5l-7 7 7 7'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  keep: ['M4 21V9a8 8 0 0 1 16 0v12', 'M4 21h16', 'M8 21v-3h3v-3h3v-3h3'],

  // The movement pad (00-build-outline.md, Exploration).
  stepLeft: ['M20 12H5', 'M11 5l-7 7 7 7'],
  stepRight: ['M4 12h15', 'M13 5l7 7-7 7'],
  stepForward: ['M12 20V5', 'M5 11l7-7 7 7'],
  stepBack: ['M12 4v15', 'M5 13l7 7 7-7'],
  turnLeft: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-2'],
  turnRight: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h2'],

  // The side column.
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14', 'M15 6v14'],
  pack: ['M6 8h12l-1 12H7z', 'M9 8a3 3 0 0 1 6 0'],
  hero: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M4 21c1-5 4-7 8-7s7 2 8 7'],
};
