/**
 * Update: a new build of the game is ready (`docs/DECISIONS.md`, 2026-09-22).
 *
 * A sheet over whatever screen is open, the way the Pause Menu is. The
 * service worker has already fetched the new page; only a restart puts it in
 * front of the player, so the sheet says so and offers one. NOT NOW closes it
 * and the sheet does not come back: the game opens on the new build next time
 * either way.
 *
 * Nothing here decides *when* to ask — `main.js` does, and never during a
 * fight.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { sheet } from '../parts/parts.js';
import { t } from '../../data/strings.js';

/** @type {import('../../shell/router.js').Screen} */
export const update = {
  id: 'update',
  pattern: 'fold',
  regions: {
    // A short box in the middle of the frame: the screen behind it stays
    // readable, which is the point of asking rather than restarting.
    sheet: { tall: [1, 9, 6, 13], wide: [5, 14, 2, 8] },
  },

  build({ router, restart }) {
    const body = el(
      'div',
      { class: 'update__body', style: { gridColumn: '1 / -1', gridRow: '2' } },
      [
        el('p', { class: 'update__text', text: t('update.body') }),
        button({
          label: t('update.restart'),
          kind: 'primary',
          onTap: () => restart?.(),
        }),
        button({
          label: t('update.later'),
          hint: t('update.laterHint'),
          onTap: () => router.closeSheet(),
        }),
      ],
    );

    return {
      sheet: sheet({
        title: t('update.title'),
        onClose: () => router.closeSheet(),
        children: [body],
      }),
    };
  },
};
