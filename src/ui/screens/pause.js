/**
 * Pause Menu — a sheet over Exploration (`00-build-outline.md`, Exploration).
 *
 * It is where the back gesture goes while exploring, which is why it is built
 * with the Exploration screen rather than left for a later phase: the menu
 * button is the one control a player always reaches for, and a disabled one
 * would be a dead end.
 *
 * Entries whose screens belong to later phases are disabled with the reason,
 * as everywhere else. RESUME, SETTINGS and QUIT TO TITLE work today.
 */
import { sheet, button } from '../parts/parts.js';
import { el } from '../parts/el.js';
import { t } from '../../data/strings.js';

/** The entries, in the outline's order (HERO, MAP, CAMP, SETTINGS, HALL). */
export const ENTRIES = [
  { id: 'hero', label: 'pause.hero' },
  { id: 'map', label: 'pause.map' },
  { id: 'camp', label: 'pause.camp', hint: 'pause.campHint' },
  { id: 'settings', label: 'pause.settings' },
  { id: 'hall', label: 'pause.hall' },
];

/** @type {import('../../shell/router.js').Screen} */
export const pause = {
  id: 'pause',
  pattern: 'fold',
  regions: {
    // The sheet lays out its own contents; it is placed over the dimmed screen
    // and leaves the status bar showing above it.
    sheet: { tall: [1, 9, 3, 18], wide: [1, 9, 1, 9] },
  },

  build({ router }) {
    const entries = ENTRIES.map((entry) =>
      button({
        label: t(entry.label),
        hint: entry.hint && router.has(entry.id) ? t(entry.hint) : undefined,
        reason: router.has(entry.id) ? undefined : t('common.comingSoon'),
        onTap: () => router.go(entry.id),
      }),
    );

    const body = el(
      'div',
      {
        class: 'sheet__body',
        style: { gridColumn: '1 / -1', gridRow: '2' },
      },
      [
        button({
          label: t('pause.resume'),
          kind: 'primary',
          onTap: () => router.closeSheet(),
        }),
        ...entries,
        button({
          label: t('pause.quit'),
          kind: 'risky',
          hint: t('pause.quitHint'),
          onTap: () => router.go('title'),
        }),
      ],
    );

    return {
      sheet: sheet({
        title: t('pause.title'),
        sideNote: t('pause.sub'),
        onClose: () => router.closeSheet(),
        children: [body],
      }),
    };
  },
};
