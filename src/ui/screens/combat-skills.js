/**
 * Combat: Skills — a sheet over the fight (`00-build-outline.md`,
 * "Combat: Skills"). The ITEM action opens the same sheet listing usable
 * items instead of skills, which is what the outline asks for.
 *
 * Tall: the fight stays visible and dimmed above it; title and FP, the list,
 * then CANCEL and USE. Wide ("panel"): the same sheet as a right-hand panel.
 *
 * Skills are `01` section 6 and items are `04`, so today the list is empty and
 * says so. The sheet is built now because it is where the SKILL and ITEM
 * actions go, and a button that opens nothing is the one dead end a player
 * meets on every turn.
 */
import { listRow, sheet } from '../parts/parts.js';
import { button } from '../parts/button.js';
import { el } from '../parts/el.js';
import { t } from '../../data/strings.js';

/** @type {import('../../shell/router.js').Screen} */
export const combatSkills = {
  id: 'combatSkills',
  pattern: 'panel',
  regions: {
    // The outline gives the sheet rows 7-18 over the dimmed screen. There is
    // no wide placement on purpose: the panel pattern derives it, which is
    // what puts the sheet in cols 11-18 as a right-hand panel.
    sheet: { tall: [1, 9, 7, 18], side: 'right' },
  },

  build({ router, fight, params = {} }) {
    const mode = params.mode === 'item' ? 'item' : 'skill';
    const hero = fight?.hero ?? {};
    const entries = (mode === 'item' ? hero.items : hero.skills) ?? [];

    let chosen = entries.find((entry) => !entry.reason)?.id ?? null;

    const close = () => router.closeSheet();

    const list = el('div', {
      class: 'sheet__list scroll',
      role: 'listbox',
      'aria-label': t(`combat.skills.${mode === 'item' ? 'items' : 'title'}`),
    });

    const footer = el('div', { class: 'sheet__footer' });

    // The sheet's own grid is a header row and one body row, as the Pause Menu
    // uses it; the list and the buttons share that body.
    const body = el(
      'div',
      { class: 'sheet__body sheet__body--list', style: { gridColumn: '1 / -1', gridRow: '2' } },
      [list, footer],
    );

    /** Uses the chosen entry and hands the turn back to the screen. */
    const use = () => {
      const entry = entries.find((row) => row.id === chosen);
      if (!entry) return;
      fight.act(mode, { id: entry.id, target: fight.target?.id });
      close();
    };

    const paint = () => {
      list.replaceChildren(
        ...(entries.length
          ? entries.map((entry) =>
              listRow({
                name: entry.name,
                sub: entry.effect,
                side: entry.fp != null ? t('combat.hints.fp', { n: entry.fp }) : undefined,
                selected: entry.id === chosen,
                reason: entry.reason,
                onTap: () => {
                  chosen = entry.id;
                  paint();
                },
              }),
            )
          : [
              el('p', {
                class: 'sheet__empty',
                text: t(mode === 'item' ? 'combat.skills.noItems' : 'combat.skills.none'),
              }),
            ]),
      );

      footer.replaceChildren(
        button({ label: t('combat.skills.cancel'), onTap: close }),
        button({
          label: t('combat.skills.use'),
          kind: 'primary',
          reason: chosen
            ? undefined
            : t(mode === 'item' ? 'combat.illegal.noItems' : 'combat.illegal.noSkills'),
          onTap: use,
        }),
      );
    };
    paint();

    return {
      sheet: sheet({
        title: t(`combat.skills.${mode === 'item' ? 'items' : 'title'}`),
        sideNote: t('combat.skills.fp', { n: hero.fp ?? 0, max: hero.maxFp ?? 0 }),
        onClose: close,
        children: [body],
      }),
    };
  },
};
