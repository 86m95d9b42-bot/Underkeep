/**
 * Chest / Door — the chest sequence (`00-build-outline.md`, "Chest / Door";
 * `03` section 7).
 *
 * Tall: the Exploration status bar, the view zoomed on the object, an info
 * card saying what is known, and a 3 x 3 grid of the nine things the hero can
 * do. Wide ("stage + controls"): the view and the card on the left, the grid
 * in columns 10–18. One declaration, two placements.
 *
 * The screen taps and draws. `systems/chests.js` holds the sequence and
 * `systems/run.js` spends the steps, so a key here resolves and commits
 * before anything is repainted (CLAUDE.md, "Resolve first, render second").
 * Every key that is off says why, and the two that can set off a live trap —
 * BASH and OPEN — go red while one is armed.
 */
import { el, ICONS } from '../parts/el.js';
import { button } from '../parts/button.js';
import { bar, chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { FACING_LETTER } from '../../dungeon/movement.js';
import { createView, poseFor, doorOffsets } from '../../dungeon/view.js';
import { costOf, inDarkness } from '../../dungeon/step-clock.js';
import { asDoor, chestState, isArmed, isLocked, waysIn, whyNotOpen } from '../../systems/chests.js';
import { disarmBonus, disarmTn } from '../../systems/traps.js';
import { bashTn, pickBonus, pickTn } from '../../systems/locks.js';
import { chanceToBeat } from '../../engine/odds.js';
import { poleable } from '../../data/traps.js';
import { commitThenShow } from '../commit.js';
import { cuesOf, playCues } from '../../shell/cues.js';

/**
 * Where everything sits. Tall placements are the outline's Chest / Door
 * table; the wide ones are its landscape row — "view and info card left; the
 * 3 x 3 action grid cols 10–18".
 * @type {Record<string, import('../../shell/layout.js').RegionDef>}
 */
export const REGIONS = {
  bars: { tall: [1, 7, 1, 2], wide: [1, 9, 1, 2] },
  menu: { tall: [8, 9, 1, 2], wide: [10, 18, 1, 2], tap: true },
  view: { tall: [1, 9, 3, 7], wide: [1, 9, 3, 6] },
  info: { tall: [1, 9, 8, 12], wide: [1, 9, 7, 9] },
  grid: { tall: [1, 9, 13, 18], wide: [10, 18, 3, 9], tap: true },
};

/** The keys of the grid, in the order the outline's table lists them. */
export const KEYS = ['search', 'careful', 'disarm', 'pole', 'pick', 'bash', 'spell', 'open', 'leave'];

/** The ways a KEY / SPELL key stands in for, best first. */
const SPELL_WAYS = ['key', 'runeKey', 'skeletonKey', 'knock', 'dispelWard'];

/** A d20 chance as a whole number of per cent. */
const percent = (chance) => `${Math.round(chance * 100)}%`;

/**
 * What each key does, why it is off, and what its second line says. It is one
 * function so that the card and the grid always agree about the same chest.
 *
 * @param {object} run
 * @returns {Record<string, { hint?: string, reason?: string, kind?: string }>}
 */
export function keysFor(run) {
  const chest = run.chestAhead;
  if (!chest) return {};
  const hero = run.hero;
  const floor = run.floor.floor;
  const trap = chest?.trap ?? null;
  const armed = chest ? isArmed(chest) : false;
  const locked = chest ? isLocked(chest) : false;
  const dark = inDarkness(run.floor, run.ex.pos);
  const ways = chest ? waysIn(chest, { keysHeld: run.ex.keysTaken, has: hero.has ?? {} }) : [];
  const wayFor = (method) => ways.find((way) => way.method === method);

  /** The reason a trap key is off, or null: found first, then still there. */
  const trapWhy = () => {
    if (!trap?.found) return 'notFound';
    if (trap.disarmed || trap.sprung) return 'alreadyGone';
    return null;
  };

  // DISARM and PICK show the roll's own odds, so a key and the roll behind it
  // can never disagree (`03` sections 4 and 6).
  const disarmOdds = () => {
    const { bonus, disadvantage } = disarmBonus(hero, trap);
    return percent(chanceToBeat(disarmTn(trap.tier, floor), bonus, { disadvantage }));
  };

  const spellWay = SPELL_WAYS.map(wayFor).find((way) => way?.usable);
  const spellOffered = SPELL_WAYS.map(wayFor).filter(Boolean);

  return {
    search: chest.searches?.normal
      ? { reason: t('chest.reasons.used') }
      : dark
        ? { reason: t('chest.reasons.tooDark') }
        : { hint: t('chest.hints.steps', { n: costOf('search') }) },

    careful: chest.searches?.careful
      ? { reason: t('chest.reasons.used') }
      : dark
        ? { reason: t('chest.reasons.tooDark') }
        : { hint: t('chest.hints.steps', { n: costOf('carefulSearch') }) },

    disarm: !trap
      ? { reason: t('chest.reasons.noTrap') }
      : trapWhy()
        ? { reason: t(`chest.reasons.${trapWhy()}`) }
        : !hero.has?.lockpicks && trap.tier !== 'arcane'
          ? { reason: t('chest.reasons.noLockpicks') }
          : { hint: disarmOdds() },

    pole: !trap
      ? { reason: t('chest.reasons.noTrap') }
      : trapWhy()
        ? { reason: t(`chest.reasons.${trapWhy()}`) }
        : !hero.has?.pole
          ? { reason: t('chest.reasons.noPole') }
          : !poleable(trap.kind)
            ? { reason: t('chest.reasons.notPoleable') }
            : { hint: t('chest.hints.safe') },

    pick: !locked
      ? { reason: t('chest.reasons.unlocked') }
      : !wayFor('pick')?.usable
        ? { reason: t(`chest.reasons.${wayFor('pick')?.why ?? 'noWay'}`) }
        : { hint: percent(chanceToBeat(pickTn(asDoor(chest), floor), pickBonus(hero))) },

    // Bashing sets off any armed trap, whatever the roll (`03` section 7).
    bash: !locked
      ? { reason: t('chest.reasons.unlocked') }
      : !wayFor('bash')?.usable
        ? { reason: t(`chest.reasons.${wayFor('bash')?.why ?? 'noWay'}`) }
        : armed
          ? { hint: t('chest.hints.setsOff'), kind: 'risky' }
          : { hint: percent(chanceToBeat(bashTn(asDoor(chest), floor), run.bashBonus)) },

    spell: !locked
      ? { reason: t('chest.reasons.unlocked') }
      : spellWay
        ? { hint: t(`explore.way.${spellWay.method}`) }
        : { reason: t(`chest.reasons.${spellOffered.find((way) => way.why)?.why ?? 'noWay'}`) },

    open: whyNotOpen(chest)
      ? { reason: t(`chest.reasons.${whyNotOpen(chest)}`) }
      : armed
        ? { hint: t('chest.hints.armedWarning'), kind: 'risky' }
        : { hint: t('chest.hints.takeIt'), kind: 'primary' },

    leave: { hint: t('chest.hints.leave') },
  };
}

/** The tip line: the first thing standing between the hero and the loot. */
export function tipFor(chest) {
  if (chest.mimicKnown) return t('chest.tips.mimic');
  if (isArmed(chest)) return t('chest.tips.armed');
  if (chestState(chest).trap === 'unknown') return t('chest.tips.unknown');
  if (isLocked(chest)) return t('chest.tips.locked');
  return t('chest.tips.ready');
}

/** One line of the info card: a label on the left, what is known on the right. */
function line(label, value, tone) {
  return el('div', { class: 'statline' }, [
    el('span', { class: 'statline__label', text: label }),
    el('span', {
      class: `statline__value${tone ? ` statline__value--${tone}` : ''}`,
      text: value,
    }),
  ]);
}

/** @type {import('../../shell/router.js').Screen} */
export const chestScreen = {
  id: 'chest',
  pattern: 'stage',
  regions: REGIONS,

  /** The phone's back gesture leaves the chest where it is. */
  onBack({ router }) {
    router.go('explore');
    return true;
  },

  build(ctx) {
    const { router, run, frame, haptics, fall } = ctx;
    const floor = run.floor;
    const ex = run.ex;
    const hero = run.hero;
    const chest = run.chestAhead;

    // Nothing to work on — the chest was opened, or the hero turned away.
    // The screen still draws, and its one key leads back.
    const leave = () => router.go('explore');

    /* -- the view, zoomed on what the hero faces ------------------------ */

    const canvas = el('canvas', { class: 'viewport__canvas' });
    const chips = el('div', { class: 'viewport__chips' }, [
      chip(`${t('explore.chips.facing')} ${FACING_LETTER[ex.facing]}`),
      chip(`${t('explore.chips.steps')} ${ex.steps}`),
    ]);
    const viewport = el('div', { class: 'region viewport' }, [canvas, chips]);

    let view = null;
    try {
      if (!canvas.getContext?.('2d')) throw new Error('no 2d context');
      view = createView({
        canvas,
        frame,
        light: inDarkness(floor, ex.pos) ? 'darkness' : 'torch',
      });
    } catch {
      view = null;
    }
    const draw = () => {
      if (!view) return;
      const box = viewport.getBoundingClientRect?.();
      if (box?.width) view.resize(box.width, box.height);
      view.render({
        floor,
        pose: poseFor(ex.pos, ex.facing),
        doors: doorOffsets(floor.doors, ex.doorsOpened),
      });
    };
    queueMicrotask(draw);

    /* -- the info card -------------------------------------------------- */

    const card = el('div', { class: 'region infocard' });
    const paintCard = () => {
      if (!chest) {
        card.replaceChildren(el('span', { class: 'hint', text: t('chest.tips.ready') }));
        return;
      }
      const state = chestState(chest);
      const lock =
        state.lock === 'none'
          ? t('chest.locks.none')
          : `${t(`chest.locks.${state.lock}`)} · TN ${pickTn(asDoor(chest), floor.floor)}`;
      // The trap line says only what the hero has earned: its name once the
      // search named it, and otherwise that there is one (`03` section 3).
      const trapLine =
        state.trap === 'armed'
          ? chest.trap.typeKnown
            ? `${t(`traps.${chest.trap.kind}.name`)} · ${t(`chest.tiers.${chest.trap.tier}`)}`
            : t('chest.trapStates.armed')
          : t(`chest.trapStates.${state.trap}`);

      card.replaceChildren(
        el('div', { class: 'infocard__head' }, [
          el('span', { class: 'infocard__name', text: t('chest.title') }),
          chest.searches?.normal || chest.searches?.careful
            ? chip(t('chest.searched'), { tone: 'muted' })
            : null,
        ]),
        line(t('chest.lock'), lock, state.locked ? 'danger' : undefined),
        line(t('chest.trap'), trapLine, state.trap === 'armed' ? 'danger' : undefined),
        el('span', { class: 'hint', text: tipFor(chest) }),
      );
    };

    /* -- the 3 x 3 grid ------------------------------------------------- */

    const grid = el('div', { class: 'region actiongrid' });

    /** Resolve, then draw: the run has already moved when this repaints. */
    const press = (action) => commitThenShow(ctx, () => {
      const result = run.chestAct(action);
      // A Mimic is a fight, started and saved with the lid that woke it.
      return { ...result, next: ctx.follow?.(result)?.next ?? null };
    }, ({ events, next }) => {
      playCues(haptics, cuesOf(events));
      // A chest's trap can be the end of the hero.
      if ((run.hero.hp ?? 1) <= 0 && fall) {
        fall({ cause: run.causeOfDeath });
        return;
      }
      if (next === 'combat') {
        router.go('combat');
        return;
      }
      // An opened chest, or a chest that was never one, is done with: the log
      // on the Exploration screen says what came of it.
      if (!run.chestAhead) {
        leave();
        return;
      }
      paintCard();
      paintGrid();
      draw();
    });

    const paintGrid = () => {
      const keys = chest ? keysFor(run) : null;
      grid.replaceChildren(
        ...KEYS.map((action) => {
          if (action === 'leave') {
            return button({ label: t('chest.actions.leave'), hint: t('chest.hints.leave'), onTap: leave });
          }
          const key = keys?.[action] ?? { reason: t('chest.reasons.noWay') };
          return button({
            label: t(`chest.actions.${action}`),
            hint: key.hint,
            reason: key.reason,
            kind: key.kind,
            onTap: () => press(action === 'spell' ? spellMethod() : action),
          });
        }),
      );
    };

    /** Which way KEY / SPELL actually uses, when it is on. */
    const spellMethod = () => {
      const ways = waysIn(chest, { keysHeld: ex.keysTaken, has: hero.has ?? {} });
      return SPELL_WAYS.find((method) => ways.find((way) => way.method === method)?.usable) ?? 'key';
    };

    paintCard();
    paintGrid();

    return {
      bars: el('div', { class: 'region bars' }, [
        bar({ kind: 'hp', value: hero.hp, max: hero.maxHp }),
        bar({ kind: 'fp', value: hero.fp, max: hero.maxFp }),
      ]),

      menu: el('div', { class: 'region menucorner' }, [
        button({
          icon: ICONS.menu,
          ariaLabel: t('explore.side.menu'),
          onTap: () => router.openSheet('pause'),
        }),
        chip(`${t('explore.chips.floor')}${floor.floor}`, { tone: 'accent' }),
      ]),

      view: viewport,
      info: card,
      grid,
    };
  },
};

export { chestScreen as chest };
