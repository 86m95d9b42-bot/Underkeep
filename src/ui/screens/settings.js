/**
 * Settings screen. 00-build-outline.md, "System".
 *
 * Tall: top bar 1–2, the settings list 3–16 (the only scrolling part), and
 * EXPORT / IMPORT across 17–18.
 *
 * Wide: the pattern table calls this "List + detail (two columns)" — the list
 * splits into two columns with the two buttons under it. The outline puts those
 * buttons in row 9 alone; they are given rows 8–9 here so they keep the 2-row
 * minimum for tap targets, which CLAUDE.md lists as non-negotiable
 * (docs/DECISIONS.md, open questions).
 */
import { topBar, scrollPanel, field, segmented, button, el } from '../parts/parts.js';
import { SETTINGS } from '../../shell/settings.js';
import { t } from '../../data/strings.js';

/** @type {import('../../shell/router.js').Screen} */
export const settings = {
  id: 'settings',
  pattern: 'list-detail',
  regions: {
    top: { tall: [1, 9, 1, 2], wide: [1, 18, 1, 2] },
    list: { tall: [1, 9, 3, 16], wide: [1, 18, 3, 7] },
    export: { tall: [1, 4, 17, 18], wide: [1, 9, 8, 9], tap: true },
    import: { tall: [5, 9, 17, 18], wide: [10, 18, 8, 9], tap: true },
  },

  build({ router, settings: store, frame, save }) {
    const rows = SETTINGS.map((spec) =>
      field({
        label: spec.label,
        control: segmented({
          options: spec.options,
          value: store.get(spec.key),
          ariaLabel: spec.label,
          // The change repaints the screen through the settings subscription
          // set up in main.js, so nothing here has to know about rendering.
          onPick: (value) => store.set(spec.key, value),
        }),
      }),
    );

    // Difficulty is shown but locked: it is chosen when a game begins.
    rows.push(field({ label: t('settings.difficulty'), value: t('settings.difficultyValue') }));

    const list = scrollPanel({ ariaLabel: t('settings.title'), children: rows });
    // Two columns in the wide frame, one in the tall frame. A grid is used
    // rather than CSS columns because columns overflow sideways, and only
    // vertical scrolling is allowed.
    if (frame === 'wide') {
      list.style.display = 'grid';
      list.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
      list.style.alignContent = 'start';
    }

    return {
      top: topBar({
        title: t('settings.title'),
        sub: t('settings.sub'),
        onBack: () => router.back(),
      }),
      list,
      export: button({
        label: t('settings.export'),
        reason: save?.hasGame ? undefined : t('settings.exportDisabled'),
      }),
      import: button({
        label: t('settings.import'),
        reason: t('settings.importDisabled'),
      }),
    };
  },
};
