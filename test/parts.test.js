/**
 * @vitest-environment happy-dom
 *
 * The shared UI parts. These are the only tests that need a DOM; every rule
 * test runs in plain Node.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  button,
  segmented,
  topBar,
  bar,
  chip,
  listRow,
  scrollPanel,
  field,
  sheet,
} from '../src/ui/parts/parts.js';

describe('button', () => {
  it('is a real button with its label as text', () => {
    const node = button({ label: 'CONTINUE' });
    expect(node.tagName).toBe('BUTTON');
    expect(node.getAttribute('type')).toBe('button');
    expect(node.textContent).toContain('CONTINUE');
  });

  it('marks the one primary action', () => {
    expect(button({ label: 'BEGIN', kind: 'primary' }).className).toContain('btn--primary');
  });

  it('shows a red hint on a risky action', () => {
    const node = button({ label: 'BASH', kind: 'risky', hint: 'Sets off trap' });
    expect(node.className).toContain('btn--risky');
    expect(node.textContent).toContain('Sets off trap');
  });

  it('always says why it is disabled', () => {
    const node = button({ label: 'PICK', reason: 'Needs lockpicks' });
    expect(node.disabled).toBe(true);
    expect(node.getAttribute('aria-disabled')).toBe('true');
    expect(node.querySelector('.hint').textContent).toBe('Needs lockpicks');
  });

  it('lets the reason replace a hint, so the block is never hidden', () => {
    const node = button({ label: 'OPEN', hint: '70%', reason: 'Boss fight' });
    expect(node.textContent).toContain('Boss fight');
    expect(node.textContent).not.toContain('70%');
  });

  it('does not fire when disabled', () => {
    const onTap = vi.fn();
    const node = button({ label: 'X', reason: 'Nope', onTap });
    node.click();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('fires when it can', () => {
    const onTap = vi.fn();
    button({ label: 'X', onTap }).click();
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('carries an aria-label when there is only an icon', () => {
    const node = button({ icon: ['M4 6h16'], ariaLabel: 'Menu' });
    expect(node.getAttribute('aria-label')).toBe('Menu');
    expect(node.querySelector('svg')).toBeTruthy();
  });
});

describe('segmented', () => {
  const options = [
    { value: 's', label: 'S' },
    { value: 'm', label: 'M' },
    { value: 'l', label: 'L' },
  ];

  it('marks the chosen option for a screen reader too, not only in amber', () => {
    const node = segmented({ options, value: 'm', ariaLabel: 'Text size' });
    const pressed = [...node.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual([null, 'true', null]);
    expect(node.getAttribute('aria-label')).toBe('Text size');
  });

  it('reports the value that was picked', () => {
    const onPick = vi.fn();
    const node = segmented({ options, value: 'm', onPick });
    node.querySelectorAll('button')[2].click();
    expect(onPick).toHaveBeenCalledWith('l');
  });
});

describe('topBar', () => {
  it('holds a back button, a title, and a subtitle', () => {
    const onBack = vi.fn();
    const node = topBar({ title: 'SETTINGS', sub: 'Shared by all save slots', onBack });
    expect(node.querySelector('.topbar__title').textContent).toBe('SETTINGS');
    expect(node.querySelector('.topbar__sub').textContent).toBe('Shared by all save slots');
    node.querySelector('button').click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('leaves the back button out where there is nowhere to go back to', () => {
    expect(topBar({ title: 'TOWN' }).querySelector('button')).toBeNull();
  });
});

describe('bar', () => {
  it('fills in proportion and reads the numbers out in text', () => {
    const node = bar({ kind: 'hp', value: 37, max: 52 });
    expect(node.querySelector('.bar__fill').style.width).toBe(`${(37 / 52) * 100}%`);
    expect(node.querySelector('.bar__value').textContent).toBe('37/52');
    expect(node.getAttribute('role')).toBe('meter');
  });

  it('clamps a value outside the range instead of overflowing', () => {
    expect(bar({ kind: 'hp', value: -3, max: 10 }).querySelector('.bar__fill').style.width).toBe('0%');
    expect(bar({ kind: 'hp', value: 99, max: 10 }).querySelector('.bar__fill').style.width).toBe('100%');
  });

  it('survives a zero maximum', () => {
    expect(bar({ kind: 'xp', value: 0, max: 0 }).querySelector('.bar__fill').style.width).toBe('0%');
  });
});

describe('chip and listRow', () => {
  it('makes a chip with a tone', () => {
    expect(chip('BOSS', { tone: 'danger' }).className).toContain('chip--danger');
  });

  it('makes a row that says why it cannot be picked', () => {
    const onTap = vi.fn();
    const node = listRow({ name: 'Plate Mail', side: '400 gp', reason: 'Not enough gold', onTap });
    expect(node.disabled).toBe(true);
    expect(node.textContent).toContain('Not enough gold');
    node.click();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('colours a row by rarity but still names it in text', () => {
    const node = listRow({ name: 'Ring of Luck', color: 'var(--rarity-rare)' });
    expect(node.querySelector('.listrow__name').textContent).toBe('Ring of Luck');
  });
});

describe('scrollPanel and field', () => {
  it('is the only kind of element that scrolls', () => {
    expect(scrollPanel({ children: [] }).classList.contains('scroll')).toBe(true);
  });

  it('stacks a label over its control', () => {
    const control = segmented({ options: [{ value: 'a', label: 'A' }], value: 'a' });
    const node = field({ label: 'HAPTICS', control });
    expect(node.querySelector('.field__label').textContent).toBe('HAPTICS');
    expect(node.contains(control)).toBe(true);
  });

  it('shows a plain value when a setting is locked', () => {
    const node = field({ label: 'DIFFICULTY', value: 'Normal' });
    expect(node.className).toContain('field--locked');
    expect(node.textContent).toContain('Normal');
  });
});

describe('sheet', () => {
  it('is a modal dialog with a close button', () => {
    const onClose = vi.fn();
    const node = sheet({ title: 'SKILLS', sideNote: 'FP 9/12', onClose });
    expect(node.getAttribute('role')).toBe('dialog');
    expect(node.getAttribute('aria-modal')).toBe('true');
    node.querySelector('button').click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
