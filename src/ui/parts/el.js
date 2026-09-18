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
};
