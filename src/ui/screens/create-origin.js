/**
 * Create: Origin (`00-build-outline.md`, "Start and Hero Creation").
 *
 * A name, four origin cards, and the kit the chosen one carries. Tall: name,
 * cards in a 2 x 2 grid, kit, then the primary button. Wide ("list + detail"):
 * the cards on the left, the name, the kit and the button on the right.
 *
 * ENTER THE UNDERKEEP finishes the draft into a hero. The Town is Phase 6, so
 * until then the hero goes straight down the stairs.
 */
import { el } from '../parts/el.js';
import { item } from '../../data/items.js';
import { button } from '../parts/button.js';
import { topBar, chip, textInput } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { abbr } from '../../data/attributes.js';
import { originList } from '../../data/origins.js';
import {
  NAME_LIMIT,
  chooseOrigin,
  createDraft,
  finish,
  newSeed,
  rollHeroName,
  setName,
  whyNotReady,
} from '../../systems/creation.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  name: { tall: [1, 9, 3, 5], wide: [10, 18, 1, 3], tap: true },
  origins: { tall: [1, 9, 6, 14], wide: [1, 9, 3, 9], tap: true },
  kit: { tall: [1, 9, 15, 16], wide: [10, 18, 4, 7] },
  enter: { tall: [1, 9, 17, 18], wide: [10, 18, 8, 9], tap: true },
};

/** @type {import('../../shell/router.js').Screen} */
export const createOrigin = {
  id: 'createOrigin',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, params = {}, startRun }) {
    // Reached from Create: Attributes with a draft; opened on its own by a
    // tool, in which case it rolls one so there is something to choose for.
    let draft = params.draft ?? createDraft({ seed: newSeed() });

    const cards = el('div', { class: 'cards cards--grid' });
    const kitBox = el('div', { class: 'region kit scroll' });
    const enterBox = el('div', { class: 'region keyslot' });
    const nameBox = el('div', { class: 'region block' });

    const nameRow = el('div', { class: 'seedrow' });
    const input = textInput({
      ariaLabel: t('create.name'),
      value: draft.name,
      placeholder: t('create.namePlaceholder'),
      maxLength: NAME_LIMIT,
      onInput: (value) => {
        draft = setName(draft, value);
        paintEnter();
      },
    });

    const paintCards = () => {
      cards.replaceChildren(
        ...originList().map((entry) =>
          button({
            label: entry.name,
            hint: `+${entry.bonus} ${abbr(entry.attribute)}`,
            selected: draft.origin === entry.id,
            class: 'card-choice',
            onTap: () => {
              draft = chooseOrigin(draft, entry.id);
              paintCards();
              paintKit();
              paintEnter();
            },
          }),
        ),
      );
    };

    const paintKit = () => {
      const chosen = originList().find((entry) => entry.id === draft.origin);
      if (!chosen) {
        kitBox.replaceChildren(el('span', { class: 'hint', text: t('create.chooseOne') }));
        return;
      }
      kitBox.replaceChildren(
        el('span', { class: 'block__label', text: t('create.kit') }),
        el('div', { class: 'kit__chips' }, [
          // The free skill's own name arrives with skills.json; its id reads
          // well enough until then.
          chip(t('create.freeSkill', { skill: chosen.freeSkill.id.replace(/_/g, ' ') })),
          ...chosen.kit.map((line) =>
            chip(
              line.count > 1
                ? t('items.count', { name: item(line.item).name, n: line.count })
                : item(line.item).name,
            ),
          ),
          chip(t('create.kitGold', { n: chosen.gold }), { tone: 'accent' }),
        ]),
      );
    };

    const paintEnter = () => {
      const why = whyNotReady(draft);
      enterBox.replaceChildren(
        button({
          label: t('create.enter'),
          kind: 'primary',
          reason: why ? t(`create.${why}`) : undefined,
          onTap: () => {
            // The Town is Phase 6; until it exists the hero starts on floor 1.
            startRun?.(finish(draft));
            // `00`'s screen flow: creation ends in the Town, not underground.
            router.go('town');
          },
        }),
      );
    };

    // NEW NAME rolls one from `names.json` for a player who would rather start
    // playing than think of one; the seed and the tap number decide what comes
    // out (DECISIONS, 2026-09-22).
    nameRow.replaceChildren(
      input,
      button({
        label: t('create.nameRandom'),
        ariaLabel: t('create.nameRandom'),
        class: 'seedrow__key',
        onTap: () => {
          draft = rollHeroName(draft);
          input.value = draft.name;
          paintEnter();
        },
      }),
    );

    nameBox.replaceChildren(
      el('span', { class: 'block__label', text: t('create.name') }),
      el('div', { class: 'block__body' }, [nameRow]),
    );

    paintCards();
    paintKit();
    paintEnter();

    return {
      topBar: topBar({
        title: t('create.originTitle'),
        onBack: () => router.back(),
        chips: [chip(t('create.step2'))],
      }),
      name: nameBox,
      origins: el('div', { class: 'region block' }, [
        el('span', { class: 'block__label', text: t('create.chooseOne') }),
        cards,
      ]),
      kit: kitBox,
      enter: enterBox,
    };
  },
};
