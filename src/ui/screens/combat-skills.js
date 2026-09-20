/**
 * Combat: Skills — a sheet over the fight (`00-build-outline.md`,
 * "Combat: Skills"). The ITEM action opens the same sheet listing usable
 * items instead of skills, which is what the outline asks for.
 *
 * Tall: the fight stays visible and dimmed above it; title and FP, the list,
 * then CANCEL and USE. Wide ("panel"): the same sheet as a right-hand panel.
 *
 * A skill the hero has learned is used from here: the list is what they own,
 * and the fight says which of them can be used this turn — a passive is
 * always on, an active costs Focus, and a shape no phase has built yet is
 * dimmed with the reason. Items are `04` and Phase 5, so that list is still
 * empty and says so.
 */
import { listRow, sheet } from '../parts/parts.js';
import { button } from '../parts/button.js';
import { el } from '../parts/el.js';
import { t } from '../../data/strings.js';
import { skillFor } from '../../data/skills.js';

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

    // The hero's skills are `{ id, rank }`; the words and the cost come from
    // the tree (`01` section 6). A passive is always on, and an active waits
    // for the resolver that will use it.
    const entries =
      mode === 'item'
        ? hero.items ?? []
        : (hero.skills ?? []).map((row) => {
            const entry = skillFor(row.id);
            // The engine answers for an active skill: enough Focus, a target
            // in reach, nothing blocking it (`06` section 4).
            const check = entry.type === 'passive' ? null : fight?.legality('skill', { skill: row.id });
            return {
              id: row.id,
              name: entry.name,
              effect: entry.effect,
              fp: entry.fp,
              reason:
                entry.type === 'passive'
                  ? t('combat.skills.passive')
                  : check && !check.legal
                    ? t(`combat.illegal.${check.why}`)
                    : undefined,
            };
          });

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
      fight.act(mode, { skill: entry.id, id: entry.id, target: fight.target?.id });
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
