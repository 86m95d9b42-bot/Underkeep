/**
 * Buttons. Four kinds, used the same way everywhere
 * (00-build-outline.md, "Visual design system").
 *
 * - primary: amber fill, at most one per screen
 * - secondary: panel fill, bone outline
 * - risky: red outline with a red hint line
 * - disabled: 45% opacity and a hint saying why
 *
 * Always a real <button> with text or an aria-label.
 */
import { el, icon } from './el.js';

/**
 * @typedef {object} ButtonOptions
 * @property {string} [label]      visible label, uppercase by convention
 * @property {string} [hint]       second line: odds, cost, or why it is off
 * @property {'primary' | 'secondary' | 'risky'} [kind]
 * @property {string} [reason]     why it is disabled; shown as the hint
 * @property {boolean} [disabled]
 * @property {boolean} [selected]  for segmented options and tabs
 * @property {string} [ariaLabel]  required when there is no visible label
 * @property {string[]} [icon]     SVG paths from ICONS
 * @property {string} [class]
 * @property {() => void} [onTap]
 */

/** @param {ButtonOptions} options */
export function button(options = {}) {
  const {
    label,
    hint,
    kind = 'secondary',
    reason,
    disabled = Boolean(reason),
    selected = false,
    ariaLabel,
    icon: iconPaths,
    class: extra = '',
    onTap,
  } = options;

  const classes = ['btn'];
  if (kind !== 'secondary') classes.push(`btn--${kind}`);
  if (selected) classes.push('btn--selected');
  if (iconPaths) classes.push('btn--icon');
  if (extra) classes.push(extra);

  // A disabled button must still say why, so the reason wins over any hint.
  const hintText = disabled ? (reason ?? hint) : hint;

  const node = el(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      disabled: disabled || undefined,
      'aria-label': ariaLabel ?? (iconPaths && !label ? 'Button' : undefined),
      'aria-pressed': selected ? 'true' : undefined,
      'aria-disabled': disabled ? 'true' : undefined,
      onClick: disabled ? undefined : onTap,
    },
    [
      iconPaths ? icon(iconPaths) : null,
      label ? el('span', { class: 'label', text: label }) : null,
      hintText ? el('span', { class: 'hint', text: hintText }) : null,
    ],
  );

  return node;
}

/**
 * A segmented control: one label with a row of mutually exclusive options.
 * Used by Settings and by any screen with a two- or three-way choice.
 * @param {object} options
 * @param {{ value: string, label: string }[]} options.options
 * @param {string} options.value
 * @param {(value: string) => void} [options.onPick]
 * @param {string} [options.ariaLabel]
 * @param {boolean} [options.disabled]
 */
export function segmented({ options, value, onPick, ariaLabel, disabled = false }) {
  const group = el('div', {
    class: 'segmented',
    role: 'group',
    'aria-label': ariaLabel,
    style: { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` },
  });
  for (const option of options) {
    group.append(
      button({
        label: option.label,
        selected: option.value === value,
        disabled,
        class: 'btn--small',
        onTap: () => onPick?.(option.value),
      }),
    );
  }
  return group;
}
