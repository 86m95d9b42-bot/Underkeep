/**
 * Combat — the fight screen (`00-build-outline.md`, "Combat").
 *
 * Tall: bars and the round chip on top, the back row, the front row, the
 * hero's chips, the log, four quick slots, and six actions in a 3 x 2 grid.
 * Wide ("stage + controls"): the rows and the log in cols 1–12, the quick
 * slots and the action grid in cols 13–18. One declaration, two placements.
 *
 * The screen taps and draws; `systems/fight.js` resolves the turn and every
 * monster turn after it before anything is repainted (CLAUDE.md, "Resolve
 * first, render second").
 */
import { el, ICONS } from '../parts/el.js';
import { button } from '../parts/button.js';
import { bar, chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { ACTIONS } from '../../systems/fight.js';
import { hitChance } from '../../engine/odds.js';

/**
 * Where everything sits. Tall placements are the outline's Combat table; wide
 * ones follow its landscape row — rows and log left, controls right — and the
 * CombatWide mockup.
 * @type {Record<string, import('../../shell/layout.js').RegionDef>}
 */
export const REGIONS = {
  bars: { tall: [1, 7, 1, 2], wide: [1, 12, 1, 1] },
  // Two rows in both frames: the menu button is a tap target, and nothing on
  // any screen is allowed to be one row tall (`00`, "Rules that don't change").
  menu: { tall: [8, 9, 1, 2], wide: [13, 18, 1, 2], tap: true },
  back: { tall: [1, 9, 3, 5], wide: [1, 12, 2, 3] },
  front: { tall: [1, 9, 6, 9], wide: [1, 12, 4, 6] },
  chips: { tall: [1, 9, 10, 10], wide: [1, 12, 7, 7] },
  log: { tall: [1, 9, 11, 12], wide: [1, 12, 8, 9] },
  quick: { tall: [1, 9, 13, 14], wide: [13, 18, 3, 4], tap: true },
  actions: { tall: [1, 9, 15, 18], wide: [13, 18, 5, 9], tap: true },
};

/** The bar an enemy card shows: its own HP, with the numbers beside it. */
function enemyCard({ unit, selected, cover, onPick }) {
  const tags = [];
  if (unit.boss) tags.push(chip(t('combat.boss'), { tone: 'accent' }));
  if (unit.elite) tags.push(chip(t('combat.elite'), { tone: 'accent' }));
  if (unit.fallen && !unit.burned) tags.push(chip(t('combat.fallen'), { tone: 'danger' }));
  if (cover) tags.push(chip(t('combat.cover'), { tone: 'muted' }));
  for (const id of Object.keys(unit.conditions ?? {})) {
    tags.push(chip(t(`conditions.${id}.name`), { tone: 'danger' }));
  }

  const telegraph = unit.telegraph
    ? el('div', {
        class: 'card__banner',
        text: t('combat.telegraphBanner', {
          ability: String(unit.telegraph.ability ?? '').toUpperCase(),
        }),
      })
    : null;

  const classes = ['card'];
  if (selected) classes.push('card--selected');
  if (unit.telegraph) classes.push('card--telegraph');

  return el(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      'aria-pressed': selected ? 'true' : 'false',
      'aria-label': t('combat.targetLabel', {
        name: unit.name ?? unit.id,
        hp: unit.hp,
        max: unit.maxHp,
      }),
      onClick: onPick,
    },
    [
      telegraph,
      el('span', { class: 'card__name', text: (unit.name ?? unit.id).toUpperCase() }),
      el('div', { class: 'card__tags' }, tags),
      // The card's own bar carries no "HP" label: the name above it is the
      // label, and the numbers are on the right.
      bar({ kind: 'hp', value: Math.max(0, unit.hp), max: unit.maxHp, name: unit.name ?? unit.id }),
    ],
  );
}

/** An empty slot in a row, so the rows keep their shape as enemies fall. */
function emptySlot(label) {
  return el('div', { class: 'card card--empty' }, label ? [el('span', { text: label })] : []);
}

/** @type {import('../../shell/router.js').Screen} */
export const combat = {
  id: 'combat',
  pattern: 'stage',
  regions: REGIONS,

  /** The back gesture opens the Pause Menu, as it does while exploring. */
  onBack({ router }) {
    if (router.currentSheet) return false;
    router.openSheet('pause');
    return true;
  },

  build({ router, fight, haptics }) {
    const hero = fight.hero;

    /* -- the rows ------------------------------------------------------- */

    const backRow = el('div', { class: 'region row row--back' });
    const frontRow = el('div', { class: 'region row row--front' });
    const chipStrip = el('div', { class: 'region chipstrip scroll-x' });
    const logPanel = el('div', {
      class: 'region log scroll',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': t('combat.title'),
    });
    const actionGrid = el('div', { class: 'region actions' });
    const quickRow = el('div', { class: 'region quick' });
    const barsBox = el('div', { class: 'region bars' });
    const roundBox = el('div', { class: 'region menucorner menucorner--stack' });

    const pick = (id) => {
      fight.pick(id);
      paint();
    };

    const paintRow = (node, row, slots, label) => {
      const units = fight.rowOf(row);
      const cards = units.map((unit) =>
        enemyCard({
          unit,
          selected: fight.target?.id === unit.id,
          cover: fight.coverOn(unit),
          onPick: () => pick(unit.id),
        }),
      );
      // The back row leads with its label, and a fourth enemy squeezes it out
      // (`00`, Combat). The front row has no label, so it simply fills up.
      const children = label && cards.length < slots ? [emptySlot(label), ...cards] : cards;
      while (children.length < slots) children.push(emptySlot());
      node.replaceChildren(...children.slice(0, slots));
    };

    const paintLog = () => {
      // Newest on top, as everywhere else in the game.
      logPanel.replaceChildren(
        ...[...fight.log].reverse().map((line) =>
          el('span', {
            class: `log__line${line.tone ? ` log__line--${line.tone}` : ''}`,
            text: line.text,
          }),
        ),
      );
      logPanel.scrollTop = 0;
    };

    const paintChips = () => {
      const chips = fight.chips.map((entry) => chip(entry.text, { tone: entry.tone }));
      const target = fight.target;
      if (target) {
        chips.push(
          chip(t('combat.chips.hit', { n: hitChance(fight.combat, hero, target) }), {
            tone: 'accent',
          }),
        );
      }
      chipStrip.replaceChildren(...chips);
    };

    /* -- the actions ---------------------------------------------------- */

    /** The second line under an action: odds, cost, or why it is blocked. */
    const hintFor = (id) => {
      const target = fight.target;
      if (id === 'attack' && target) {
        return t('combat.hints.attack', {
          target: target.name ?? target.id,
          odds: hitChance(fight.combat, hero, target),
        });
      }
      if (id === 'defend') return t('combat.hints.defend');
      if (id === 'skill') return t('combat.hints.fp', { n: hero.fp ?? 0 });
      if (id === 'swap') return t('combat.hints.swap');
      return undefined;
    };

    /**
     * Why a button is off. The engine answers for the rules; the two sheets
     * answer for the phases that have not arrived (`00`, disabled buttons
     * always say why).
     */
    const reasonFor = (id) => {
      if (id === 'skill' && !(hero.skills?.length > 0)) return t('combat.illegal.noSkills');
      if (id === 'item' && !(hero.items?.length > 0)) return t('combat.illegal.noItems');
      const check = fight.legality(id);
      return check.legal ? undefined : t(`combat.illegal.${check.why}`);
    };

    const take = (id) => {
      if (id === 'skill' || id === 'item') {
        router.openSheet('combatSkills', { mode: id });
        return;
      }
      const done = fight.act(id);
      if (!done.acted) haptics?.buzz?.('bump');
      if (fight.over) {
        paint();
        return;
      }
      paint();
    };

    /**
     * Where a finished fight goes: a victory to the rewards, a flight back
     * into the dark, and a death to the Death screen when it is built
     * (`00`, the screen flow).
     */
    const leave = () => {
      const outcome = fight.outcome;
      const to = outcome === 'victory' ? 'loot' : outcome === 'fled' ? 'explore' : 'death';
      return {
        label: t(`combat.after.${outcome}`),
        reason: router.has?.(to) ? undefined : t('common.comingSoon'),
        onTap: () => router.go(to),
      };
    };

    const paintActions = () => {
      // Nothing is left to choose once the fight is over: the six actions
      // become the one way out.
      actionGrid.classList.toggle('actions--done', Boolean(fight.over));
      if (fight.over) {
        const out = leave();
        actionGrid.replaceChildren(
          button({ label: out.label, kind: 'primary', reason: out.reason, onTap: out.onTap }),
        );
        return;
      }

      // DEFEND becomes the primary whenever a telegraph is pending; otherwise
      // ATTACK is the one amber button on the screen (`00`, Combat).
      const primary = fight.telegraphPending ? 'defend' : 'attack';
      actionGrid.replaceChildren(
        ...ACTIONS.map((id) => {
          const reason = reasonFor(id);
          return button({
            label: t(`combat.actions.${id}`),
            hint: reason ? undefined : hintFor(id),
            kind: id === primary && !reason ? 'primary' : id === 'flee' ? 'risky' : 'secondary',
            reason,
            onTap: () => take(id),
          });
        }),
      );
    };

    const paintQuick = () => {
      // Quick slots hold items, which arrive with the pack (`04`, Phase 5).
      const slots = hero.quickSlots ?? [null, null, null, null];
      quickRow.replaceChildren(
        ...slots.map((item) =>
          button({
            label: item ? `${item.name} ×${item.count}` : t('combat.emptySlot'),
            reason: item ? undefined : t('combat.illegal.noItems'),
            class: 'quickslot',
          }),
        ),
      );
    };

    const paintBars = () => {
      barsBox.replaceChildren(
        bar({ kind: 'hp', value: Math.max(0, hero.hp), max: hero.maxHp }),
        bar({ kind: 'fp', value: hero.fp ?? 0, max: hero.maxFp ?? 0 }),
      );
      roundBox.replaceChildren(
        button({
          icon: ICONS.menu,
          ariaLabel: t('explore.side.menu'),
          onTap: () => router.openSheet('pause'),
        }),
        chip(t('combat.round', { n: fight.round ?? 0 }), { tone: 'accent' }),
      );
    };

    /** One repaint for the whole screen: the turn has already been resolved. */
    function paint() {
      paintBars();
      paintRow(backRow, 'back', 4, t('combat.backRow'));
      paintRow(frontRow, 'front', 4, null);
      paintChips();
      paintLog();
      paintQuick();
      paintActions();
    }
    paint();

    return {
      bars: barsBox,
      menu: roundBox,
      back: backRow,
      front: frontRow,
      chips: chipStrip,
      log: logPanel,
      quick: quickRow,
      actions: actionGrid,
    };
  },
};
