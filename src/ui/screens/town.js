/**
 * Town Hub (`00-build-outline.md`, "Town").
 *
 * The hub the whole town hangs off: the day and the trip, what the hero has
 * left of themselves, six services in a 2 x 3 grid, and the gate down. Tall
 * is the outline's table; wide is the "fold + nudge" pattern — bars and three
 * services left, three services and the gate right.
 *
 * The screen counts nothing. `systems/town.js` keeps the day and the trip and
 * knows which services are open; this draws them and presses the gate.
 */
import { el, ICONS } from '../parts/el.js';
import { button } from '../parts/button.js';
import { bar, chip, topBar } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { stashUse } from '../../systems/stash.js';
import { markOf } from '../../systems/travel.js';
import {
  SERVICES,
  innCost,
  isOpen,
  nextTrip,
  sageCost,
  shopTier,
  unlockFloorFor,
} from '../../systems/town.js';

/**
 * Rows 1-2 the top bar, 3-4 the bars, 5-16 the six services four rows each,
 * 17-18 the gate. Wide: the bars and the first three services on the left,
 * the rest and the gate on the right.
 * @type {Record<string, import('../../shell/layout.js').RegionDef>}
 */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  bars: { tall: [1, 9, 3, 4], wide: [1, 9, 3, 3] },
  inn: { tall: [1, 4, 5, 8], wide: [1, 9, 4, 5], tap: true },
  shop: { tall: [6, 9, 5, 8], wide: [1, 9, 6, 7], tap: true },
  temple: { tall: [1, 4, 9, 12], wide: [1, 9, 8, 9], tap: true },
  sage: { tall: [6, 9, 9, 12], wide: [10, 18, 1, 2], tap: true },
  alchemist: { tall: [1, 4, 13, 16], wide: [10, 18, 3, 4], tap: true },
  stash: { tall: [6, 9, 13, 16], wide: [10, 18, 5, 6], tap: true },
  gate: { tall: [1, 9, 17, 18], wide: [10, 18, 7, 9], tap: true },
};

/** The hint under each service button, from what the town and hero know. */
export function hintFor(service, { town, hero }) {
  switch (service) {
    case 'inn':
      return t('town.hints.inn', { n: innCost(hero) });
    case 'shop':
      return t('town.hints.shop', { n: shopTier(town) });
    case 'sage':
      return t('town.hints.sage', { n: sageCost() });
    case 'stash': {
      const { used, total } = stashUse(hero);
      return t('town.hints.stash', { used, total });
    }
    default:
      return t(`town.hints.${service}`);
  }
}

/** What the day and the trip read as: the first trip is not a return. */
export function subtitleFor(town) {
  const trip = nextTrip(town);
  const key = trip > 1 ? 'town.subReturn' : 'town.sub';
  return t(key, { day: town.day, trip });
}

/** @type {import('../../shell/router.js').Screen} */
export const town = {
  id: 'town',
  pattern: 'fold',
  regions: REGIONS,

  build({ router, run, town: here, descend, params = {} }) {
    const hero = run.hero;

    const bars = el('div', { class: 'region bars' }, [
      // The bars name themselves, as they do on the Exploration screen.
      bar({ kind: 'hp', value: hero.hp ?? 0, max: hero.maxHp ?? 1 }),
      bar({ kind: 'fp', value: hero.fp ?? 0, max: hero.maxFp ?? 1 }),
    ]);

    /** One service tile: open ones wait on their own screen, locked ones say when. */
    const tile = (service) => {
      const open = isOpen(here, service);
      const built = router.has?.(service);
      return el('div', { class: 'region keyslot' }, [
        button({
          label: t(`town.services.${service}`),
          hint: open ? hintFor(service, { town: here, hero }) : undefined,
          reason: open
            ? built
              ? undefined
              : t('common.comingSoon')
            : t('town.locked', { n: unlockFloorFor(service) }),
          onTap: () => router.go(service),
        }),
      ]);
    };

    // The gate is the one primary button on the screen (`00`, UI rules). The
    // Dungeon Gate screen and its waystones are the next tasks; until then it
    // opens the floor the hero would arrive on.
    const mark = markOf(here);
    const gate = el('div', { class: 'region keyslot' }, [
      button({
        label: t('town.gate'),
        // A Return Mark is where the next trip begins, and the Dungeon Gate
        // screen will offer it properly (`05` section 9); until then the Hub
        // says where the hero is headed.
        hint: mark
          ? t('town.gateMark', { n: mark.floor })
          : t('town.gateHint', { n: run.floor?.floor ?? 1 }),
        kind: 'primary',
        // The Dungeon Gate has a screen of its own (`00`, the screen flow);
        // the Hub's key is what opens it.
        onTap: () => {
          if (router.has?.('gate')) return router.go('gate');
          descend?.();
          router.go('explore');
        },
      }),
    ]);

    return {
      topBar: topBar({
        title: t('town.title'),
        // A game picked up from its backup says so, once (`05` section 11).
        sub: params.notice ?? subtitleFor(here),
        chips: [
          chip(t('town.level', { n: hero.level ?? 1 })),
          chip(t('town.gold', { n: hero.gold ?? 0 }), { tone: 'accent' }),
        ],
      }),
      bars,
      ...Object.fromEntries(SERVICES.map((service) => [service, tile(service)])),
      gate,
    };
  },
};
