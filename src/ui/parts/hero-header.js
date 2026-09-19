/**
 * The header the three Hero screens share
 * (`00-build-outline.md`, "Hero and Items"): *"The three Hero screens share
 * rows 1–4: a top bar (hero name, level and origin, skill point chip) and tabs
 * STATS / SKILLS / PACK, each 3 columns wide."*
 *
 * One declaration, used by Stats, the Skill Tree and — when `04` arrives — the
 * Pack, so the three never drift apart.
 */
import { topBar, chip } from './parts.js';
import { button } from './button.js';
import { el } from './el.js';
import { t } from '../../data/strings.js';
import { unspent } from '../../systems/skill-tree.js';

/** The three tabs, in the outline's order, and the screen each opens. */
export const HERO_TABS = /** @type {const} */ ([
  { id: 'stats', screen: 'hero' },
  { id: 'skills', screen: 'skillTree' },
  { id: 'pack', screen: 'pack' },
]);

/**
 * Rows 1-4, for a Hero screen's region table. The wide placements put the
 * tabs beside the bar rather than under it, because the wide frame has nine
 * rows to spend and the content below needs them.
 * @param {[number, number]} [cols] which columns the header spans when wide
 */
export function heroHeaderRegions(cols = [1, 9]) {
  return {
    topBar: { tall: [1, 9, 1, 2], wide: [cols[0], cols[1], 1, 2] },
    tabs: { tall: [1, 9, 3, 4], wide: [cols[1] + 1, 18, 1, 2], tap: true },
  };
}

/**
 * The top bar: the hero's name, their level and origin, and what skill points
 * they have left to spend.
 * @param {object} options
 * @param {object} options.hero
 * @param {object} options.router
 * @param {string} [options.title] overrides the hero's name (the Skill Tree
 *   titles itself SKILLS, as the mockup does)
 * @param {string} [options.sub]
 */
export function heroTopBar({ hero, router, title, sub }) {
  const points = unspent(hero);
  return topBar({
    title: title ?? (hero?.name ?? t('hero.title')).toUpperCase(),
    sub: sub ?? t('hero.sub', { level: hero?.level ?? 1, origin: originName(hero) }),
    onBack: () => router.back(),
    chips: points > 0 ? [chip(t('hero.points', { n: points }), { tone: 'accent' })] : [],
  });
}

/** The origin's name as the player chose it, or nothing. */
function originName(hero) {
  return hero?.origin ? t(`origins.${hero.origin}.name`) : '';
}

/**
 * The three tabs. The one for this screen is selected; one whose screen has
 * not been built says so, as every disabled button does.
 * @param {object} options
 * @param {object} options.router
 * @param {string} options.current the tab id this screen is
 */
export function heroTabs({ router, current }) {
  return el(
    'div',
    { class: 'region tabs', role: 'tablist' },
    HERO_TABS.map((tab) =>
      button({
        label: t(`hero.tabs.${tab.id}`),
        selected: tab.id === current,
        reason: router.has?.(tab.screen) ? undefined : t('common.comingSoon'),
        onTap: () => {
          if (tab.id !== current) router.go(tab.screen);
        },
      }),
    ),
  );
}
