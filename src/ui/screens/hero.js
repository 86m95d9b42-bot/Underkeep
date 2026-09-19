/**
 * Hero: Stats (`00-build-outline.md`, "Hero and Items").
 *
 * Six attribute tiles, the derived statistics under them, and the XP bar to
 * the next level. Tall: tiles, list, bar. Wide ("fold"): the tiles on the
 * left, the list and the bar on the right.
 *
 * Every number here is read, not computed: `01` section 4's formulas live in
 * `attributes.json` and the hero carries the results.
 */
import { el } from '../parts/el.js';
import { bar, scrollPanel } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { heroHeaderRegions, heroTabs, heroTopBar } from '../parts/hero-header.js';
import { ATTRIBUTE_ORDER, abbr, modFor } from '../../data/attributes.js';
import { PATHS } from '../../data/skills.js';
import { spentIn } from '../../systems/skill-tree.js';
import { progress } from '../../systems/levelling.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  ...heroHeaderRegions(),
  attributes: { tall: [1, 9, 5, 10], wide: [1, 9, 3, 9] },
  derived: { tall: [1, 9, 11, 16], wide: [10, 18, 3, 7] },
  xp: { tall: [1, 9, 17, 18], wide: [10, 18, 8, 9] },
};

/** A modifier as a player reads it: +2, +0, −1. */
export function signed(value) {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/** One attribute tile: abbreviation, score, modifier. */
function tile(hero, id) {
  const score = hero.attributes?.[id] ?? 0;
  return el('div', { class: 'stattile' }, [
    el('span', { class: 'stattile__abbr', text: abbr(id) }),
    el('span', { class: 'stattile__score', text: String(score) }),
    el('span', { class: 'stattile__mod', text: signed(modFor(score)) }),
  ]);
}

/** One row of the derived list. */
function row(label, value) {
  return el('div', { class: 'statline' }, [
    el('span', { class: 'statline__label', text: label }),
    el('span', { class: 'statline__value', text: String(value) }),
  ]);
}

/**
 * What the hero has spent in each Path, as the mockup writes it:
 * "Blade 4 · Spirit 3", and only the Paths they have touched.
 */
export function pathSummary(hero) {
  const spent = Object.keys(PATHS)
    .map((path) => ({ path, points: spentIn(hero, path) }))
    .filter((entry) => entry.points > 0)
    .map((entry) => `${t(`paths.${entry.path}.name`).replace(/^PATH OF (THE )?/, '')} ${entry.points}`);
  return spent.length ? spent.join(' · ') : t('hero.noPaths');
}

/** @type {import('../../shell/router.js').Screen} */
export const hero = {
  id: 'hero',
  pattern: 'fold',
  regions: REGIONS,

  build({ router, run }) {
    const who = run.hero;

    const tiles = el(
      'div',
      { class: 'region stattiles' },
      ATTRIBUTE_ORDER.map((id) => tile(who, id)),
    );

    const attacks = who.attacks ?? {};
    const saves = who.saves ?? {};
    const derived = scrollPanel({
      ariaLabel: t('hero.title'),
      children: [
        row(t('hero.derived.melee'), signed(attacks.melee ?? who.atk ?? 0)),
        row(t('hero.derived.ranged'), signed(attacks.ranged ?? 0)),
        row(t('hero.derived.spell'), signed(attacks.spell ?? 0)),
        row(t('hero.derived.def'), who.def ?? 10),
        row(t('hero.derived.init'), signed(who.init ?? 0)),
        row(t('hero.derived.body'), signed(saves.body ?? 0)),
        row(t('hero.derived.reflex'), signed(saves.reflex ?? 0)),
        row(t('hero.derived.mind'), signed(saves.mind ?? 0)),
        row(t('hero.derived.slots'), who.slots ?? 10),
        // A crit range of 19 is "19–20", which is how `01` section 4 writes it.
        row(
          t('hero.derived.crit'),
          (who.critFrom ?? 20) < 20
            ? t('hero.critRangeWide', { n: who.critFrom })
            : t('hero.critRange', { n: who.critFrom ?? 20 }),
        ),
        row(t('hero.derived.origin'), who.origin ? t(`origins.${who.origin}.name`) : '—'),
        row(t('hero.derived.paths'), pathSummary(who)),
      ],
    });

    const climb = progress(who);
    const xp = el('div', { class: 'region xpbar' }, [
      el('span', { class: 'block__label', text: climb.needed ? t('hero.nextLevel') : t('hero.atCap') }),
      // "NEXT LEVEL" is the block's own label; the bar is labelled XP, as
      // the Hero mockup draws it.
      bar({
        kind: 'xp',
        value: climb.into,
        max: Math.max(1, climb.needed),
        name: t('hero.xpLabel'),
        valueText: climb.needed ? t('hero.xp', { into: climb.into, needed: climb.needed }) : '—',
      }),
    ]);

    return {
      topBar: heroTopBar({ hero: who, router }),
      tabs: heroTabs({ router, current: 'stats' }),
      attributes: tiles,
      derived,
      xp,
    };
  },
};
