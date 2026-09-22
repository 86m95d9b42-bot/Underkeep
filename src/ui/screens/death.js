/**
 * Death (`00-build-outline.md`, "Combat and Rewards").
 *
 * Tall: YOU HAVE FALLEN; the tombstone — mode chip, name, level and origin,
 * cause of death, floor and day; the score; steps, bosses and best item; then
 * HALL OF THE DEAD and TITLE. Wide ("stage + controls"): the tombstone on the
 * left, the score, the run and the buttons on the right.
 *
 * In Adventurer mode the hero is not dead for good: the tombstone becomes a
 * "You wake in town" card with what was left in the grave, and the primary
 * button is RETURN TO TOWN.
 *
 * The fall has already happened when this is drawn — the grave dug, or the
 * Ironman save deleted and the tombstone sent to the Hall — so the screen
 * reports it and changes nothing (`05` section 11: resolve, commit, show).
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { causeText, recordOf } from '../../systems/death.js';
import { nameOf } from '../../systems/identification.js';
import { grouped, tombstone } from '../parts/tombstone.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  title: { tall: [1, 9, 1, 1], wide: [1, 9, 1, 1] },
  stone: { tall: [1, 9, 2, 12], wide: [1, 9, 2, 9] },
  score: { tall: [1, 9, 13, 14], wide: [10, 18, 1, 2] },
  stats: { tall: [1, 9, 15, 16], wide: [10, 18, 3, 5] },
  hall: { tall: [1, 5, 17, 18], wide: [10, 13, 8, 9], tap: true },
  leave: { tall: [6, 9, 17, 18], wide: [14, 18, 8, 9], tap: true },
};

/**
 * What the screen draws: the fall it was handed, or — opened without one, as
 * the tools do — the game in progress as if it had just ended.
 */
export function deathFrom(params, { run, town }) {
  if (params?.record) return { mode: params.record.mode, record: params.record, grave: params.grave ?? null };
  const hero = run?.hero ?? {};
  const record = recordOf({ hero, town, run: run?.floor ? run : null, cause: run?.causeOfDeath ?? null });
  return { mode: record.mode, record, grave: town?.grave ?? null };
}

/** @type {import('../../shell/router.js').Screen} */
export const death = {
  id: 'death',
  pattern: 'stage',
  regions: REGIONS,
  /** There is nothing behind the Death screen to go back to. */
  onBack: () => true,

  build({ router, run, town, params = {} }) {
    const { mode, record, grave } = deathFrom(params, { run, town });
    const ironman = mode === 'ironman';

    const title = el('div', { class: 'region banner banner--death' }, [
      el('span', { class: 'banner__word', text: t('death.title') }),
    ]);

    // Ironman: the stone. Adventurer: waking in town, and what the grave holds.
    const stone = ironman
      ? el('div', { class: 'region stonebox' }, [tombstone(record)])
      : el('div', { class: 'region stonebox' }, [
          el('div', { class: 'wake' }, [
            chip(t('death.modes.adventurer'), { tone: 'accent' }),
            el('span', { class: 'wake__title', text: t('death.wake') }),
            el('span', { class: 'stone__cause', text: causeText(record.cause) }),
            el('span', { class: 'hint', text: t('death.wakeHint') }),
            ...(grave
              ? [
                  el('span', { class: 'stone__line', text: t('death.graveAt', { n: grave.floor }) }),
                  el('span', { class: 'wake__gold', text: t('death.graveGold', { n: grave.gold ?? 0 }) }),
                  el('span', {
                    class: 'hint',
                    text: (grave.items ?? []).length
                      ? t('death.graveItems', {
                          items: grave.items.map((item) => nameOf(item, run?.hero?.identification)).join(', '),
                        })
                      : t('death.graveNothing'),
                  }),
                ]
              : []),
          ]),
        ]);

    const score = el('div', { class: 'region panel scorebar' }, [
      el('span', { class: 'scorebar__label', text: t('death.score') }),
      el('span', { class: 'scorebar__value', text: grouped(record.score) }),
    ]);

    const stat = (label, value) =>
      el('div', { class: 'runstat' }, [
        el('span', { class: 'runstat__label', text: label }),
        el('span', { class: 'runstat__value', text: value }),
      ]);
    const stats = el('div', { class: 'region panel runstats' }, [
      stat(t('death.steps'), grouped(record.steps)),
      stat(t('death.bosses'), String(record.bosses)),
      stat(t('death.bestItem'), record.bestItem?.name ?? t('death.noItem')),
    ]);

    return {
      title,
      stone,
      score,
      stats,
      hall: button({
        label: t('death.hall'),
        reason: router.has?.('hall') ? undefined : t('common.comingSoon'),
        onTap: () => router.replace('hall'),
      }),
      leave: button({
        label: ironman ? t('death.toTitle') : t('death.toTown'),
        kind: 'primary',
        onTap: () => router.go(ironman ? 'title' : 'town'),
      }),
    };
  },
};
