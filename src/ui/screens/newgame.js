/**
 * New Game (`00-build-outline.md`, "Start and Hero Creation").
 *
 * Four choices and a button: the mode a run ends by, the difficulty, how the
 * attributes are rolled, and the seed. Tall: each choice is a labelled block
 * down the screen. Wide ("fold + nudge"): the mode cards and BEGIN on the
 * left, the three smaller choices stacked on the right.
 *
 * Nothing here rolls anything. The seed and the three settings go to
 * `systems/creation.js`, which rolls from the seed on the next screen.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { topBar, textInput } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { DIFFICULTIES, MODES, ROLL_MODES, newSeed, seedFrom } from '../../systems/creation.js';

/**
 * Where everything sits. Each of the outline's "label row / control rows"
 * pairs is one region covering both, so the label travels with its control
 * when the frame changes.
 * @type {Record<string, import('../../shell/layout.js').RegionDef>}
 */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  mode: { tall: [1, 9, 3, 7], wide: [1, 9, 3, 7], tap: true },
  difficulty: { tall: [1, 9, 8, 10], wide: [10, 18, 1, 3], tap: true },
  rolls: { tall: [1, 9, 11, 13], wide: [10, 18, 4, 6], tap: true },
  seed: { tall: [1, 9, 14, 16], wide: [10, 18, 7, 9], tap: true },
  begin: { tall: [1, 9, 17, 18], wide: [1, 9, 8, 9], tap: true },
};

/** A labelled block: the outline's label row and its controls, together. */
function block(label, children, extra = '') {
  return el('div', { class: `region block ${extra}`.trim() }, [
    el('span', { class: 'block__label', text: label }),
    el('div', { class: 'block__body' }, children),
  ]);
}

/** @type {import('../../shell/router.js').Screen} */
export const newGame = {
  id: 'newGame',
  pattern: 'fold',
  regions: REGIONS,

  build({ router, params = {} }) {
    // The screen keeps the choice; the draft is made when BEGIN is tapped.
    let mode = params.mode ?? MODES[0];
    let difficulty = params.difficulty ?? 'normal';
    let rollMode = params.rollMode ?? ROLL_MODES[ROLL_MODES.indexOf('standard')] ?? ROLL_MODES[0];
    let typedSeed = params.seed != null ? String(params.seed) : '';

    const modeBox = el('div', { class: 'cards cards--two' });
    const difficultyBox = el('div', { class: 'choices' });
    const rollBox = el('div', { class: 'choices' });
    const seedBox = el('div', { class: 'seedrow' });

    const paintModes = () => {
      modeBox.replaceChildren(
        ...MODES.map((id) =>
          button({
            label: t(`newGame.modes.${id}`),
            hint: t(`newGame.modes.${id}Hint`),
            selected: mode === id,
            class: 'card-choice',
            onTap: () => {
              mode = id;
              paintModes();
            },
          }),
        ),
      );
    };

    const paintDifficulty = () => {
      difficultyBox.replaceChildren(
        ...DIFFICULTIES.map((id) =>
          button({
            label: t(`newGame.difficulties.${id}`),
            selected: difficulty === id,
            onTap: () => {
              difficulty = id;
              paintDifficulty();
            },
          }),
        ),
      );
    };

    const paintRolls = () => {
      rollBox.replaceChildren(
        ...ROLL_MODES.map((id) =>
          button({
            label: t(`newGame.rollModes.${id}`),
            hint: t(`newGame.rollModes.${id}Hint`),
            selected: rollMode === id,
            onTap: () => {
              rollMode = id;
              paintRolls();
            },
          }),
        ),
      );
    };

    const input = textInput({
      ariaLabel: t('newGame.seed'),
      value: typedSeed,
      placeholder: t('newGame.seedPlaceholder'),
      keyboard: 'numeric',
      maxLength: 12,
      onInput: (value) => {
        typedSeed = value;
      },
    });

    seedBox.replaceChildren(
      input,
      button({
        label: t('newGame.seedRandom'),
        ariaLabel: t('newGame.seedRandom'),
        class: 'seedrow__key',
        onTap: () => {
          typedSeed = String(newSeed());
          input.value = typedSeed;
        },
      }),
    );

    paintModes();
    paintDifficulty();
    paintRolls();

    return {
      topBar: topBar({ title: t('newGame.title'), onBack: () => router.back() }),
      mode: block(t('newGame.mode'), [modeBox]),
      difficulty: block(t('newGame.difficulty'), [difficultyBox]),
      rolls: block(t('newGame.rolls'), [rollBox]),
      seed: block(t('newGame.seed'), [seedBox]),
      begin: button({
        label: t('newGame.begin'),
        kind: 'primary',
        onTap: () =>
          router.go('createStats', {
            seed: seedFrom(typedSeed) ?? newSeed(),
            mode,
            difficulty,
            rollMode,
          }),
      }),
    };
  },
};
