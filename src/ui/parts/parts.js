/**
 * The rest of the shared UI parts: top bar, meter bars, chips, list rows,
 * scroll panels, and sheets. Every screen is built from these, so a change to
 * the look happens in one place.
 *
 * 00-build-outline.md, "Screen layouts" and "Visual design system".
 */
import { el, icon, ICONS } from './el.js';
import { button, segmented } from './button.js';

/**
 * The top bar is always rows 1–2: back button, title with a one-line subtitle,
 * and optional chips (gold, level, step count).
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.sub]
 * @param {() => void} [options.onBack]
 * @param {HTMLElement[]} [options.chips]
 */
export function topBar({ title, sub, onBack, chips = [] }) {
  return el('div', { class: 'region topbar' }, [
    onBack
      ? button({ icon: ICONS.back, ariaLabel: 'Back', onTap: onBack })
      : null,
    el('div', { class: 'topbar__text' }, [
      el('span', { class: 'topbar__title', text: title }),
      sub ? el('span', { class: 'topbar__sub', text: sub }) : null,
    ]),
    chips.length ? el('div', { class: 'topbar__chips' }, chips) : null,
  ]);
}

/**
 * A meter: name, track, and "current/max" read out in text, so the bar is never
 * the only signal.
 * @param {object} options
 * @param {'hp' | 'fp' | 'xp'} options.kind
 * @param {number} options.value
 * @param {number} options.max
 * @param {string} [options.name]
 * @param {string} [options.valueText] overrides the "3/12" readout
 */
export function bar({ kind, value, max, name, valueText }) {
  const label = name ?? kind.toUpperCase();
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return el(
    'div',
    {
      class: `bar bar--${kind}`,
      role: 'meter',
      'aria-label': label,
      'aria-valuenow': String(value),
      'aria-valuemin': '0',
      'aria-valuemax': String(max),
    },
    [
      el('span', { class: 'bar__name', text: label }),
      el('div', { class: 'bar__track' }, [
        el('div', { class: 'bar__fill', style: { width: `${pct * 100}%` } }),
      ]),
      el('span', { class: 'bar__value', text: valueText ?? `${value}/${max}` }),
    ],
  );
}

/**
 * A chip: a short uppercase tag.
 * @param {string} text
 * @param {{ tone?: 'accent' | 'danger' | 'muted', title?: string }} [options]
 */
export function chip(text, { tone, title } = {}) {
  return el('span', {
    class: `chip${tone ? ` chip--${tone}` : ''}`,
    text,
    title,
  });
}

/**
 * A row in a scrolling list: name, optional second line, optional right-hand
 * value, optional chips.
 * @param {object} options
 * @param {string} options.name
 * @param {string} [options.sub]
 * @param {string} [options.side]
 * @param {HTMLElement[]} [options.chips]
 * @param {boolean} [options.selected]
 * @param {string} [options.reason] why the row cannot be picked
 * @param {string} [options.color] a CSS colour token for the name (rarity)
 * @param {() => void} [options.onTap]
 */
export function listRow({
  name,
  sub,
  side,
  chips = [],
  selected = false,
  reason,
  color,
  onTap,
}) {
  const disabled = Boolean(reason);
  return el(
    'button',
    {
      type: 'button',
      class: `listrow${selected ? ' listrow--selected' : ''}`,
      disabled: disabled || undefined,
      'aria-disabled': disabled ? 'true' : undefined,
      'aria-pressed': selected ? 'true' : undefined,
      onClick: disabled ? undefined : onTap,
    },
    [
      el('span', { class: 'listrow__text' }, [
        el('span', {
          class: 'listrow__name',
          text: name,
          style: color ? { color } : undefined,
        }),
        sub || reason
          ? el('span', { class: 'hint', text: reason ?? sub })
          : null,
        chips.length ? el('span', { class: 'topbar__chips' }, chips) : null,
      ]),
      side ? el('span', { class: 'listrow__side', text: side }) : null,
    ],
  );
}

/**
 * The only kind of element allowed to scroll.
 * @param {object} [options]
 * @param {(Node | null | false)[]} [options.children]
 * @param {boolean} [options.plain] no panel fill or outline
 * @param {string} [options.ariaLabel]
 */
export function scrollPanel({ children = [], plain = false, ariaLabel } = {}) {
  return el(
    'div',
    {
      class: `scrollpanel scroll${plain ? ' panel--plain' : ''}`,
      role: 'group',
      'aria-label': ariaLabel,
      tabindex: '0',
    },
    children,
  );
}

/**
 * A titled block with a label above a control, as the Settings list uses.
 * @param {object} options
 * @param {string} options.label
 * @param {Node} [options.control]
 * @param {string} [options.value] shown instead of a control when locked
 */
export function field({ label, control, value }) {
  return el('div', { class: `field${control ? '' : ' field--locked'}` }, [
    el('span', { class: 'field__label', text: label }),
    control ?? el('span', { class: 'field__value', text: value ?? '' }),
  ]);
}

/**
 * A sheet: a panel over the dimmed screen that opened it. The router places it;
 * this only builds the box and its header.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.sideNote] shown next to the title, e.g. "FP 9/12"
 * @param {() => void} [options.onClose]
 * @param {Node[]} [options.children] already placed on the sheet's own grid
 */
export function sheet({ title, sideNote, onClose, children = [] }) {
  const header = el(
    'div',
    {
      class: 'region topbar',
      style: { gridColumn: '1 / -1', gridRow: '1 / 2' },
    },
    [
      el('div', { class: 'topbar__text' }, [
        el('span', { class: 'topbar__title', text: title }),
        sideNote ? el('span', { class: 'topbar__sub', text: sideNote }) : null,
      ]),
      onClose
        ? button({ icon: ICONS.close, ariaLabel: 'Close', onTap: onClose })
        : null,
    ],
  );
  return el(
    'div',
    { class: 'region sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    [header, ...children],
  );
}

export { el, icon, ICONS, button, segmented };
