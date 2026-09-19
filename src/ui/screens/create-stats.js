/**
 * Create: Attributes (`00-build-outline.md`, "Start and Hero Creation").
 *
 * Six attribute rows, two grid rows each: abbreviation, name and hint, score,
 * modifier, and — in Standard, which may rearrange — a swap button. Under them
 * the live preview of HP, Focus and Defense, then REROLL and NEXT.
 *
 * Tall: all six down the screen. Wide ("fold + nudge"): the first three left,
 * the last three right, with the preview and the buttons under them.
 *
 * The rolling itself is `systems/creation.js`; this screen shows a draft and
 * hands it on.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { topBar, chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { ATTRIBUTE_ORDER, wordsFor } from '../../data/attributes.js';
import {
  canRearrange,
  createDraft,
  newSeed,
  previewOf,
  reroll,
  swap,
} from '../../systems/creation.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  // The outline's "3-14, six rows, 2 rows each", split three and three so the
  // wide frame can put one half on each side.
  first: { tall: [1, 9, 3, 8], wide: [1, 9, 3, 7], tap: true },
  second: { tall: [1, 9, 9, 14], wide: [10, 18, 1, 5], tap: true },
  preview: { tall: [1, 9, 15, 16], wide: [1, 9, 8, 9] },
  reroll: { tall: [1, 4, 17, 18], wide: [10, 18, 6, 7], tap: true },
  next: { tall: [5, 9, 17, 18], wide: [10, 18, 8, 9], tap: true },
};

/** How many of the six go in the first block. */
const HALF = 3;

/** @type {import('../../shell/router.js').Screen} */
export const createStats = {
  id: 'createStats',
  pattern: 'fold',
  regions: REGIONS,

  build({ router, params = {} }) {
    // Opened from New Game with a seed; opened by a tool with nothing, in
    // which case it rolls a hero of its own so there is something to look at.
    let draft = params.draft ?? createDraft({ seed: newSeed(), ...params });
    // Standard may rearrange: the first tap picks up a score, the second
    // drops it on another attribute (`01` section 3).
    let picked = null;

    const first = el('div', { class: 'region statlist' });
    const second = el('div', { class: 'region statlist' });
    const previewBox = el('div', { class: 'region preview' });
    const buttons = { reroll: el('div', { class: 'region keyslot' }), next: el('div', { class: 'region keyslot' }) };

    const rowFor = (id) => {
      const words = wordsFor(id);
      const score = draft.scores[id];
      const mod = previewOf(draft).mods[id];
      const swappable = canRearrange(draft);
      const isPicked = picked === id;

      const row = el(
        'button',
        {
          type: 'button',
          class: `statrow${isPicked ? ' statrow--picked' : ''}`,
          disabled: swappable ? undefined : true,
          'aria-disabled': swappable ? undefined : 'true',
          'aria-label': swappable
            ? isPicked
              ? t('create.swapPick', { name: words.name })
              : picked
                ? t('create.swapWith', { name: words.name, other: wordsFor(picked).name })
                : `${words.name} ${score}`
            : `${words.name} ${score}`,
          onClick: swappable
            ? () => {
                if (!picked) picked = id;
                else {
                  draft = swap(draft, picked, id);
                  picked = null;
                }
                paint();
              }
            : undefined,
        },
        [
          el('span', { class: 'statrow__abbr', text: words.abbr }),
          el('span', { class: 'statrow__text' }, [
            el('span', { class: 'statrow__name', text: words.name }),
            el('span', { class: 'hint', text: words.governs }),
          ]),
          el('span', { class: 'statrow__score', text: String(score) }),
          el('span', { class: 'statrow__mod', text: mod >= 0 ? `+${mod}` : `−${Math.abs(mod)}` }),
          swappable ? el('span', { class: 'statrow__swap', text: t('create.swap') }) : null,
        ],
      );
      return row;
    };

    function paint() {
      first.replaceChildren(...ATTRIBUTE_ORDER.slice(0, HALF).map(rowFor));
      second.replaceChildren(...ATTRIBUTE_ORDER.slice(HALF).map(rowFor));

      const preview = previewOf(draft);
      previewBox.replaceChildren(
        chip(`${t('create.hp')} ${preview.hp}`),
        chip(`${t('create.fp')} ${preview.fp}`),
        chip(`${t('create.def')} ${preview.def}`),
      );

      buttons.reroll.replaceChildren(
        button({
          label: t('create.reroll'),
          onTap: () => {
            draft = reroll(draft);
            picked = null;
            paint();
          },
        }),
      );
      buttons.next.replaceChildren(
        button({
          label: t('create.next'),
          kind: 'primary',
          onTap: () => router.go('createOrigin', { draft }),
        }),
      );
    }
    paint();

    return {
      topBar: topBar({
        title: t('create.title'),
        sub: t(canRearrange(draft) ? 'create.standardHint' : 'create.classicHint'),
        onBack: () => router.back(),
        chips: [chip(t('create.step1'))],
      }),
      first,
      second,
      preview: previewBox,
      reroll: buttons.reroll,
      next: buttons.next,
    };
  },
};
