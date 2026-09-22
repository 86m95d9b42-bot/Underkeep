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
import { sheet, button, ICONS } from '../parts/parts.js';
import { el } from '../parts/el.js';
import { t } from '../../data/strings.js';
import { autoFight, whyNotAutoFight } from '../../systems/auto-fight.js';
import { commitThenShow } from '../commit.js';

/** The entries, in the outline's order (HERO, MAP, CAMP, SETTINGS, HALL). */
export const ENTRIES = [
  { id: 'hero', label: 'pause.hero' },
  { id: 'map', label: 'pause.map' },
  { id: 'camp', label: 'pause.camp', hint: 'pause.campHint' },
  { id: 'settings', label: 'pause.settings' },
  { id: 'hall', label: 'pause.hall' },
];

/**
 * CAMP (`01` section 9): a ration for half the hero's HP and all FP. The roll
 * that may bring a wandering monster is committed before anything is shown,
 * and an interrupted rest goes straight to the fight.
 */
function campButton(ctx) {
  const { router } = ctx;
  const why = ctx.run?.campReason ?? (ctx.camp ? null : 'inTown');
  return button({
    label: t('pause.camp'),
    hint: why ? undefined : t('pause.campHint'),
    reason: why ? t(`pause.why.${why}`) : undefined,
    onTap: () =>
      commitThenShow(ctx, () => ctx.camp(), (result) => {
        router.closeSheet();
        if (result.next === 'combat') router.go('combat');
        else router.replace('explore');
      }),
  });
}

/** @type {import('../../shell/router.js').Screen} */
export const pause = {
  id: 'pause',
  pattern: 'fold',
  regions: {
    // The sheet lays out its own contents; it is placed over the dimmed screen
    // and leaves the status bar showing above it. Wide ("fold"): PAUSED and
    // RESUME on the left, the other entries and QUIT on the right.
    sheet: { tall: [1, 9, 3, 18], wide: [1, 18, 1, 9] },
  },

  build(ctx) {
    const { router, params = {}, frame } = ctx;
    // Opened from a fight, the menu's CAMP — which a fight never allows — is
    // AUTO-FIGHT instead (`06` section 17; docs/DECISIONS.md).
    const inFight = params.from === 'combat';
    const entries = ENTRIES.map((entry) => {
      if (inFight && entry.id === 'camp') return autoFightButton(ctx);
      if (entry.id === 'camp') return campButton(ctx);
      return button({
        label: t(entry.label),
        hint: entry.hint && router.has(entry.id) ? t(entry.hint) : undefined,
        reason: router.has(entry.id) ? undefined : t('common.comingSoon'),
        onTap: () => router.go(entry.id),
      });
    });

    const resume = button({
      label: t('pause.resume'),
      kind: 'primary',
      onTap: () => router.closeSheet(),
    });
    const quit = button({
      label: t('pause.quit'),
      kind: 'risky',
      hint: t('pause.quitHint'),
      onTap: () => router.go('title'),
    });

    // Wide: two halves. Six entries stacked in nine rows would be a row and a
    // half each, so the right half lays them out two across, three rows tall.
    if (frame === 'wide') {
      return {
        sheet: el(
          'div',
          { class: 'region sheet sheet--pause', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pause.title') },
          [
            el('div', { class: 'pause__left' }, [
              el('div', { class: 'region topbar' }, [
                el('div', { class: 'topbar__text' }, [
                  el('span', { class: 'topbar__title', text: t('pause.title') }),
                  el('span', { class: 'topbar__sub', text: t('pause.sub') }),
                ]),
                button({ icon: ICONS.close, ariaLabel: 'Close', onTap: () => router.closeSheet() }),
              ]),
              resume,
            ]),
            el('div', { class: 'pause__right' }, [...entries, quit]),
          ],
        ),
      };
    }

    const body = el(
      'div',
      {
        class: 'sheet__body',
        style: { gridColumn: '1 / -1', gridRow: '2' },
      },
      [resume, ...entries, quit],
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

/**
 * AUTO-FIGHT: routine fights played out by `06` section 17's two rules until
 * something needs the player. The result is written before it is shown, and
 * the log says why it stopped.
 */
function autoFightButton(ctx) {
  const { router, fight } = ctx;
  const why = whyNotAutoFight(fight);
  return button({
    label: t('combat.auto.label'),
    hint: why ? undefined : t('combat.auto.hint'),
    reason: why ? t(`combat.auto.notNow.${why}`) : undefined,
    onTap: () =>
      commitThenShow(
        ctx,
        () => {
          const played = autoFight(fight);
          // Why it stopped is part of what is saved, not a caption added after.
          fight.log.push({
            round: fight.round,
            text: t('combat.auto.stopped', { why: t(`combat.auto.why.${played.stoppedBy}`) }),
            tone: 'accent',
          });
          return played;
        },
        () => router.closeSheet(),
      ),
  });
}

