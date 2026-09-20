/**
 * The Dungeon Gate (`00-build-outline.md`, "Town"; `05` section 9).
 *
 * Every floor, and which of them the hero can step straight back into: a
 * Waystone is attuned by standing on it, and travel between attuned stones is
 * free and instant. Floors past the deepest stone show what they are waiting
 * for, or nothing at all.
 *
 * When a Return Mark exists it has a card of its own, and taking it is a
 * different trip: it begins on the tile the scroll was read from, once.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { chip, listRow, scrollPanel, topBar } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { floorSpec } from '../../data/floors.js';
import { gateFloors, markOf } from '../../systems/travel.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  floors: { tall: [1, 9, 3, 14], wide: [1, 9, 3, 9] },
  mark: { tall: [1, 9, 15, 16], wide: [10, 18, 1, 5] },
  descend: { tall: [1, 9, 17, 18], wide: [10, 18, 6, 9], tap: true },
};

/** What a floor's row says under its number: its theme, or why it is shut. */
export function lineFor(row) {
  if (row.attuned) return floorSpec(row.floor).theme;
  return row.known ? t('gate.notAttuned') : t('gate.unknown');
}

/** @type {import('../../shell/router.js').Screen} */
export const gate = {
  id: 'gate',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, town, descend }) {
    const rows = gateFloors(town);
    const mark = markOf(town);
    // The deepest floor the hero can reach is where they would go by default.
    let chosen = [...rows].reverse().find((row) => row.attuned)?.floor ?? 1;
    let takingMark = false;

    const floors = el('div', { class: 'region block' });
    const markBox = el('div', { class: 'region note' });
    const descendKey = el('div', { class: 'region keyslot' });

    const paint = () => {
      floors.replaceChildren(
        el('span', { class: 'block__label', text: t('gate.label') }),
        scrollPanel({
          ariaLabel: t('gate.label'),
          children: rows.map((row) =>
            listRow({
              name: t('gate.floor', { n: row.floor }),
              sub: lineFor(row),
              side: row.attuned ? t('gate.attuned') : t('gate.locked'),
              selected: !takingMark && row.floor === chosen,
              // A locked floor keeps its own line — its theme, or "Unknown" —
              // and is dimmed rather than being told why twice.
              disabled: !row.attuned,
              onTap: () => {
                chosen = row.floor;
                takingMark = false;
                paint();
              },
            }),
          ),
        }),
      );

      // The mark's card, when there is one (`00`, rows 15-16).
      markBox.replaceChildren(
        mark
          ? listRow({
              name: t('gate.mark'),
              sub: t('gate.markCard', { n: mark.floor }),
              side: t('gate.go'),
              selected: takingMark,
              onTap: () => {
                takingMark = true;
                paint();
              },
            })
          : el('span', { class: 'hint', text: t('gate.noMark') }),
      );

      descendKey.replaceChildren(
        button({
          label: takingMark
            ? t('gate.descendMark')
            : t('gate.descend', { n: chosen }),
          kind: 'primary',
          onTap: () => {
            descend?.(takingMark ? { mark: true } : { floor: chosen });
            router.go('explore');
          },
        }),
      );
    };
    paint();

    return {
      topBar: topBar({
        title: t('gate.title'),
        sub: t('gate.sub'),
        onBack: () => router.back(),
        chips: mark ? [chip(t('gate.mark'), { tone: 'accent' })] : [],
      }),
      floors,
      mark: markBox,
      descend: descendKey,
    };
  },
};
