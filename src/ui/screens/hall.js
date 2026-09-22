/**
 * Hall of the Dead (`00-build-outline.md`, "Hall of the Dead"; `05` section 12).
 *
 * Tall: the top bar, SCORE / RECENT, the records (rank, name — amber for a
 * victory — level, origin, cause and score), and BACK TO TITLE. Tapping a
 * record opens its tombstone in the list's place, and the bottom button and
 * the back gesture close it again. Wide ("list + detail"): the records on the
 * left and the selected record's tombstone on the right.
 *
 * The sort and the open record live in the screen's params, so rotating the
 * phone re-renders the same view (CLAUDE.md, UI rules).
 */
import { el } from '../parts/el.js';
import { button, segmented } from '../parts/button.js';
import { listRow, scrollPanel, topBar } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { HALL_KEPT, hallView, shortCause } from '../../systems/death.js';
import { grouped, originName, tombstone } from '../parts/tombstone.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  sort: { tall: [1, 9, 3, 4], wide: [1, 9, 3, 4], tap: true },
  list: { tall: [1, 9, 5, 16], wide: [1, 9, 5, 7] },
  stone: { tall: [1, 9, 5, 16], wide: [10, 18, 1, 9] },
  back: { tall: [1, 9, 17, 18], wide: [1, 9, 8, 9], tap: true },
};

export const SORTS = ['score', 'recent'];

/** @type {import('../../shell/router.js').Screen} */
export const hall = {
  id: 'hall',
  pattern: 'list-detail',
  regions: REGIONS,

  /** The back gesture closes an open tombstone first, then leaves. */
  onBack({ router }) {
    const params = router.current?.params ?? {};
    if (params.open === undefined || params.open === null) return false;
    router.replace('hall', { ...params, open: null });
    return true;
  },

  build({ router, hall: records = [], params = {}, frame }) {
    const sort = SORTS.includes(params.sort) ? params.sort : 'score';
    const rows = hallView(records, sort, HALL_KEPT);
    const wide = frame === 'wide';
    const open = rows.find((row) => row.rank === params.open) ?? null;
    // Wide always has room for a stone: the chosen one, or the best.
    const shown = open ?? (wide ? rows.find((row) => row.rank === 1) ?? null : null);

    const go = (next) => router.replace('hall', { sort, open: params.open ?? null, ...next });

    const sortBox = el('div', { class: 'region' }, [
      segmented({
        options: SORTS.map((id) => ({ value: id, label: t(`hall.sorts.${id}`) })),
        value: sort,
        ariaLabel: t('hall.sort'),
        onPick: (value) => go({ sort: value }),
      }),
    ]);

    const list = el('div', { class: 'region block' }, [
      scrollPanel({
        ariaLabel: t('hall.title'),
        children: rows.length
          ? rows.map(({ rank, record }) =>
              listRow({
                name: `${rank}  ${String(record.name).toUpperCase()}`,
                sub: t('hall.row', { level: record.level, origin: originName(record), cause: shortCause(record) }),
                side: grouped(record.score),
                // Victories are amber, and say so in words as well.
                color: record.victory ? 'var(--accent)' : undefined,
                selected: shown?.rank === rank,
                onTap: () => go({ open: rank }),
              }),
            )
          : [
              el('div', { class: 'hall__empty' }, [
                el('span', { class: 'title', text: t('hall.empty') }),
                el('span', { class: 'hint', text: t('hall.emptyHint') }),
              ]),
            ],
      }),
    ]);

    const stone = shown
      ? el('div', { class: 'region stonebox' }, [
          tombstone(shown.record, {
            extra: [
              el('span', { class: 'stone__score', text: t('hall.score', { n: grouped(shown.record.score) }) }),
              el('span', {
                class: 'hint',
                text: t('hall.stoneStats', {
                  steps: grouped(shown.record.steps),
                  bosses: shown.record.bosses ?? 0,
                  days: shown.record.days ?? 0,
                }),
              }),
            ],
          }),
        ])
      : null;

    const closing = Boolean(open) && !wide;
    return {
      topBar: topBar({
        title: t('hall.title'),
        sub: t('hall.sub', { n: HALL_KEPT }),
        onBack: () => (closing ? go({ open: null }) : router.replace('title')),
      }),
      sort: sortBox,
      // Tall shows the list or an open stone in the same rows; wide shows both.
      ...(wide || !open ? { list } : {}),
      ...(stone && (wide || open) ? { stone } : {}),
      back: button({
        label: closing ? t('hall.backToList') : t('hall.backToTitle'),
        kind: 'primary',
        onTap: () => (closing ? go({ open: null }) : router.replace('title')),
      }),
    };
  },
};
