/**
 * Exploration — the main screen (`00-build-outline.md`, "Exploration").
 *
 * Tall: bars and menu on top, the raycast view, the log, then a 3 x 3 movement
 * pad with the context key in its middle and MAP / PACK / HERO down the side.
 * Wide ("stage + controls"): the view and log in the middle, the context key
 * and pad on the left, the side column on the right. One declaration, two
 * placements — never a second copy of the screen.
 *
 * The screen only presses keys and draws: `systems/run.js` resolves the move
 * and winds the step clock, and the 140 ms tween in `view.js` draws what has
 * already happened (CLAUDE.md, "Resolve first, render second").
 */
import { el, icon, ICONS } from '../parts/el.js';
import { button } from '../parts/button.js';
import { bar, chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { FACING_LETTER } from '../../dungeon/movement.js';
import { createView, createAnimator, poseFor, doorOffsets } from '../../dungeon/view.js';
import { inDarkness } from '../../dungeon/step-clock.js';
import { onSwipe, SWIPE_COMMANDS } from '../../shell/swipe.js';

/**
 * Where everything sits, right-handed. Tall placements come from the screen
 * table in `00`; wide ones from the same document's landscape table and the
 * ExploreWide mockup.
 * @type {Record<string, import('../../shell/layout.js').RegionDef>}
 */
export const REGIONS = {
  bars: { tall: [1, 7, 1, 2], wide: [1, 18, 1, 1] },
  menu: { tall: [8, 9, 1, 2], wide: [16, 18, 8, 9], tap: true },
  view: { tall: [1, 9, 3, 10], wide: [4, 15, 2, 7] },
  log: { tall: [1, 9, 11, 12], wide: [4, 15, 8, 9] },

  strafeLeft: { tall: [1, 2, 13, 14], wide: [1, 1, 4, 5], tap: true },
  forward: { tall: [3, 4, 13, 14], wide: [2, 2, 4, 5], tap: true },
  strafeRight: { tall: [5, 6, 13, 14], wide: [3, 3, 4, 5], tap: true },
  turnLeft: { tall: [1, 2, 15, 16], wide: [1, 1, 6, 7], tap: true },
  context: { tall: [3, 4, 15, 16], wide: [1, 3, 2, 3], tap: true },
  turnRight: { tall: [5, 6, 15, 16], wide: [3, 3, 6, 7], tap: true },
  back: { tall: [3, 4, 17, 18], wide: [2, 2, 6, 7], tap: true },

  // The tall pad's bottom corners are empty in the outline's table ("—, back,
  // —"), and the wide frame has one slot left under the pad. SEARCH lives
  // there in landscape only; in portrait the context key is SEARCH whenever
  // there is nothing else to do, so nothing is lost (docs/DECISIONS.md).
  search: { tall: [1, 2, 17, 18], wide: [1, 3, 8, 9], tap: true },

  map: { tall: [7, 9, 13, 14], wide: [16, 18, 2, 3], tap: true },
  pack: { tall: [7, 9, 15, 16], wide: [16, 18, 4, 5], tap: true },
  hero: { tall: [7, 9, 17, 18], wide: [16, 18, 6, 7], tap: true },
};

/**
 * The regions a left-handed player has mirrored (`00`, Exploration: "the
 * left-handed setting mirrors the pad and the side column"). The top bar goes
 * with them: the menu button is the other thing a thumb reaches for, and in
 * landscape it sits in the side column's fourth slot, which moves.
 */
export const MIRRORED = new Set([
  'bars',
  'menu',
  'strafeLeft',
  'forward',
  'strafeRight',
  'turnLeft',
  'context',
  'turnRight',
  'back',
  'search',
  'map',
  'pack',
  'hero',
]);

/** Flips a placement's columns within a frame of this width. */
function mirrorCols([c1, c2, r1, r2], cols) {
  return /** @type {import('../../shell/layout.js').Placement} */ ([cols + 1 - c2, cols + 1 - c1, r1, r2]);
}

/**
 * The regions for a handedness. Mirroring is a transform of the same
 * declaration, so landscape and portrait stay in step and there is still only
 * one copy of the screen.
 * @param {'right' | 'left'} hand
 */
export function exploreRegions(hand = 'right') {
  if (hand !== 'left') return REGIONS;
  /** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
  const out = {};
  for (const [name, def] of Object.entries(REGIONS)) {
    out[name] = MIRRORED.has(name)
      ? { ...def, tall: mirrorCols(def.tall, 9), wide: def.wide ? mirrorCols(def.wide, 18) : undefined }
      : def;
  }
  return out;
}

/** A movement pad key: an icon over a short label, with a spoken name. */
function padKey({ icon: paths, label, ariaLabel, onTap, scale = 0.62 }) {
  const node = button({ ariaLabel, onTap, class: 'padkey' });
  node.replaceChildren(
    icon(paths, scale),
    el('span', { class: 'padkey__label', text: label }),
  );
  return node;
}

/** A side-column key: icon and label, disabled with a reason until its phase. */
function sideKey({ icon: paths, label, reason, onTap }) {
  const node = button({ label, reason, onTap, class: 'sidekey' });
  node.prepend(icon(paths, 0.58));
  return node;
}

/** @type {import('../../shell/router.js').Screen} */
export const explore = {
  id: 'explore',
  pattern: 'stage',

  get regions() {
    // main.js keeps the handedness setting on <html>, so a change to it
    // repaints the screen mirrored with no state touched.
    const hand = globalThis.document?.documentElement?.dataset?.hand;
    return exploreRegions(hand === 'left' ? 'left' : 'right');
  },

  /** The phone's back gesture opens the Pause Menu here (`00`, navigation). */
  onBack({ router }) {
    if (router.currentSheet) return false;
    router.openSheet('pause');
    return true;
  },

  build({ router, run, frame, haptics }) {
    const floor = run.floor;
    const ex = run.ex;

    /* -- the view ------------------------------------------------------- */

    const canvas = el('canvas', { class: 'viewport__canvas' });
    const chips = el('div', { class: 'viewport__chips' }, [
      chip(`${t('explore.chips.facing')} ${FACING_LETTER[ex.facing]}`),
      chip(`${t('explore.chips.steps')} ${ex.steps}`),
    ]);
    const viewport = el('div', { class: 'region viewport' }, [canvas, chips]);

    // A canvas without a 2D context (a test environment, an old browser) still
    // leaves a playable screen: the log and the pad do not need it.
    let view = null;
    let animator = null;
    try {
      // happy-dom and old browsers hand back no 2D context; the raycaster
      // needs one, and everything else on the screen does not.
      if (!canvas.getContext?.('2d')) throw new Error('no 2d context');
      view = createView({
        canvas,
        frame,
        light: inDarkness(floor, ex.pos) ? 'darkness' : 'torch',
      });
      animator = createAnimator({
        pose: poseFor(ex.pos, ex.facing),
        draw: (pose) =>
          view.render({
            floor,
            pose,
            doors: doorOffsets(floor.doors, ex.doorsOpened),
          }),
      });
    } catch {
      view = null;
    }

    /** The canvas is sized from the region, capped, and redrawn on any change. */
    const fit = () => {
      if (!view) return;
      const box = viewport.getBoundingClientRect?.();
      if (!box?.width) return;
      view.resize(box.width, box.height);
      animator.redraw();
    };
    if (globalThis.ResizeObserver && view) {
      const observer = new ResizeObserver(fit);
      observer.observe(viewport);
    }
    queueMicrotask(fit);

    /* -- the log -------------------------------------------------------- */

    const logPanel = el('div', {
      class: 'region log scroll',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Message log',
    });
    const paintLog = () => {
      // Newest line on top (`00`, Exploration).
      logPanel.replaceChildren(
        ...[...run.log].reverse().map((line) =>
          el('span', {
            class: `log__line${line.tone ? ` log__line--${line.tone}` : ''}`,
            text: line.text,
          }),
        ),
      );
      logPanel.scrollTop = 0;
    };
    paintLog();

    /* -- pressing a key ------------------------------------------------- */

    const paintChips = () => {
      chips.replaceChildren(
        chip(`${t('explore.chips.facing')} ${FACING_LETTER[ex.facing]}`),
        chip(`${t('explore.chips.steps')} ${ex.steps}`),
      );
    };

    /** Resolve, then draw: the state has already moved when the tween starts. */
    const press = (command) => {
      const { outcome } = run.press(command);
      paintLog();
      paintChips();
      if (outcome.blocked) haptics?.buzz?.('bump');
      // The context key and the light can both have changed with the step.
      paintContext();
      if (!view) return;
      view.setLight(inDarkness(floor, ex.pos) ? 'darkness' : 'torch');
      animator.moveTo(poseFor(ex.pos, ex.facing));
    };

    const act = () => {
      run.act();
      paintLog();
      paintChips();
      paintContext();
      animator?.redraw();
    };

    /* -- the keys ------------------------------------------------------- */

    // The context key changes with what the hero faces, so it lives in a slot
    // the screen can repaint without rebuilding anything else.
    const contextSlot = el('div', { class: 'region keyslot' });
    const paintContext = () => {
      const action = run.context;
      contextSlot.replaceChildren(
        button({
          label: t(`explore.context.${action}`),
          hint: t(`explore.hint.${action}`),
          // Amber whenever there is something to act on (`00`, Exploration).
          kind: action === 'search' ? 'secondary' : 'primary',
          reason: run.actReason,
          onTap: act,
        }),
      );
    };
    paintContext();

    return {
      bars: el('div', { class: 'region bars' }, [
        bar({ kind: 'hp', value: run.hero.hp, max: run.hero.maxHp }),
        bar({ kind: 'fp', value: run.hero.fp, max: run.hero.maxFp }),
      ]),

      menu: el('div', { class: 'region menucorner' }, [
        button({
          icon: ICONS.menu,
          ariaLabel: t('explore.side.menu'),
          onTap: () => router.openSheet('pause'),
        }),
        chip(`${t('explore.chips.floor')}${floor.floor}`, { tone: 'accent' }),
      ]),

      // Swipes on the view move too: up or down to step, left or right to
      // turn (`00`, Exploration).
      view: (() => {
        onSwipe(viewport, (direction) => press(SWIPE_COMMANDS[direction]));
        return viewport;
      })(),

      log: logPanel,

      strafeLeft: padKey({
        icon: ICONS.stepLeft,
        label: t('explore.pad.strafe'),
        ariaLabel: t('explore.pad.strafeLeftLabel'),
        onTap: () => press('strafeLeft'),
      }),
      forward: padKey({
        icon: ICONS.stepForward,
        label: t('explore.pad.forward'),
        ariaLabel: t('explore.pad.forwardLabel'),
        scale: 0.72,
        onTap: () => press('forward'),
      }),
      strafeRight: padKey({
        icon: ICONS.stepRight,
        label: t('explore.pad.strafe'),
        ariaLabel: t('explore.pad.strafeRightLabel'),
        onTap: () => press('strafeRight'),
      }),
      turnLeft: padKey({
        icon: ICONS.turnLeft,
        label: t('explore.pad.turn'),
        ariaLabel: t('explore.pad.turnLeftLabel'),
        onTap: () => press('turnLeft'),
      }),
      turnRight: padKey({
        icon: ICONS.turnRight,
        label: t('explore.pad.turn'),
        ariaLabel: t('explore.pad.turnRightLabel'),
        onTap: () => press('turnRight'),
      }),
      back: padKey({
        icon: ICONS.stepBack,
        label: t('explore.pad.back'),
        ariaLabel: t('explore.pad.backLabel'),
        scale: 0.72,
        onTap: () => press('back'),
      }),

      context: contextSlot,

      // Landscape only: in portrait the context key already is SEARCH whenever
      // there is nothing else in front of the hero.
      search:
        frame === 'wide'
          ? button({
              label: t('explore.context.search'),
              hint: t('common.comingSoon'),
              reason: t('common.comingSoon'),
            })
          : null,

      map: sideKey({
        icon: ICONS.map,
        label: t('explore.side.map'),
        reason: router.has('map') ? undefined : t('common.comingSoon'),
        onTap: () => router.go('map'),
      }),
      pack: sideKey({
        icon: ICONS.pack,
        label: t('explore.side.pack'),
        reason: router.has('pack') ? undefined : t('common.comingSoon'),
        onTap: () => router.go('pack'),
      }),
      hero: sideKey({
        icon: ICONS.hero,
        label: t('explore.side.hero'),
        reason: router.has('hero') ? undefined : t('common.comingSoon'),
        onTap: () => router.go('hero'),
      }),
    };
  },
};
