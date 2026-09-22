/**
 * Title screen. 00-build-outline.md, "Start and Hero Creation".
 *
 * Tall rows: logo 1–6, last-played card 7–10, then four buttons two rows each.
 * Wide: "Fold + nudge" — the card is pulled up to end on the fold so the four
 * buttons stack in the right half.
 */
import { button, el, icon, ICONS } from '../parts/parts.js';
import { t } from '../../data/strings.js';

/** @type {import('../../shell/router.js').Screen} */
export const title = {
  id: 'title',
  pattern: 'fold',
  regions: {
    logo: { tall: [1, 9, 1, 6] },
    lastPlayed: { tall: [1, 9, 7, 10], wide: [1, 9, 7, 9] },
    continue: { tall: [1, 9, 11, 12], tap: true },
    newGame: { tall: [1, 9, 13, 14], tap: true },
    hall: { tall: [1, 9, 15, 16], tap: true },
    settings: { tall: [1, 9, 17, 18], tap: true },
  },

  build({ router, save, continueGame }) {
    const last = save?.lastPlayed ?? null;

    const logo = el(
      'div',
      {
        class: 'region',
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'calc(var(--u) * 0.23)',
        },
      },
      [
        (() => {
          const mark = icon(ICONS.keep, 2.1);
          mark.style.stroke = 'var(--accent)';
          mark.setAttribute('stroke-width', '2.2');
          return mark;
        })(),
        el('span', { class: 'display', text: t('app.name') }),
        el('span', {
          class: 'hint',
          text: t('app.tagline'),
          style: { letterSpacing: '0.16em', fontFamily: 'var(--font-body)' },
        }),
      ],
    );

    const card = el(
      'div',
      {
        class: 'region panel',
        style: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 'calc(var(--u) * 0.09)',
          padding: '0 calc(var(--u) * 0.32)',
        },
      },
      last
        ? [
            el('span', { class: 'section-label', text: t('title.lastPlayed') }),
            el('span', { class: 'title', text: `${last.name} · LV ${last.level}` }),
            el('span', { class: 'body', text: `Floor ${last.floor} · ${last.theme}` }),
            el('span', { class: 'hint', text: `${last.mode} · ${last.played} played` }),
          ]
        : [
            el('span', { class: 'section-label', text: t('title.lastPlayed') }),
            el('span', { class: 'title', text: t('title.noSave') }),
            el('span', { class: 'hint', text: t('title.noSaveHint') }),
          ],
    );

    return {
      logo,
      lastPlayed: card,
      // A screen that a later phase adds disables its button with a reason
      // rather than going missing, so the layout never shifts underneath.
      continue: button({
        label: t('title.continue'),
        kind: 'primary',
        reason: last && router.has('explore') ? undefined : t('title.continueDisabled'),
        onTap: () => (continueGame ? continueGame() : router.go('explore')),
      }),
      newGame: button({
        label: t('title.newGame'),
        reason: router.has('newGame') ? undefined : t('common.comingSoon'),
        onTap: () => router.go('newGame'),
      }),
      hall: button({
        label: t('title.hall'),
        reason: router.has('hall') ? undefined : t('common.comingSoon'),
        onTap: () => router.go('hall'),
      }),
      settings: button({
        label: t('title.settings'),
        onTap: () => router.go('settings'),
      }),
    };
  },
};
