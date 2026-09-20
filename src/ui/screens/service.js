/**
 * The Inn, the Temple and the Sage — one screen, three shopfronts
 * (`00-build-outline.md`, "Town": *"the Inn and Sage use this same layout"*).
 *
 * A portrait and a line of flavour, a list of what is on offer with what each
 * costs, what the selected one does and how its cost is worked out, and one
 * button that pays for it. The three differ only in their words and in what
 * `systems/services.js` offers, so they are one factory and three exports
 * rather than three screens that would drift apart.
 *
 * Nothing here prices anything: the offers arrive costed, with the reason
 * they cannot be taken already on them.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { chip, listRow, scrollPanel, topBar } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { itemOf } from '../../data/items.js';
import { nameOf } from '../../systems/identification.js';
import { entryOf } from '../../systems/inventory.js';
import { offersOf, take, whyNot } from '../../systems/services.js';

/**
 * Rows 1-2 the bar, 3-5 the portrait and its line, 6-14 the list, 15-16 what
 * the choice does, 17-18 the cost and the one button. Wide is "list + detail":
 * the list on the left, everything else on the right.
 * @type {Record<string, import('../../shell/layout.js').RegionDef>}
 */
export const REGIONS = {
  topBar: { tall: [1, 9, 1, 2], wide: [1, 9, 1, 2] },
  flavour: { tall: [1, 9, 3, 5], wide: [1, 9, 3, 4] },
  list: { tall: [1, 9, 6, 14], wide: [1, 9, 5, 9] },
  detail: { tall: [1, 9, 15, 16], wide: [10, 18, 1, 5] },
  cost: { tall: [1, 4, 17, 18], wide: [10, 13, 6, 9] },
  pay: { tall: [5, 9, 17, 18], wide: [14, 18, 6, 9], tap: true },
};

/** A key under one service's own strings. */
const say = (service, offer, key, vars) => t(`service.${service}.${offer}.${key}`, vars);

/**
 * The line under an offer's name: what it would do, or why it would do
 * nothing. The Sage and the Temple's curses name the item they are about.
 */
export function subFor(service, offer, hero) {
  if (offer.why) {
    const nothing = say(service, offer.id, 'nothing');
    return nothing.startsWith('service.') ? t(`service.why.${offer.why}`) : nothing;
  }
  if (offer.target) {
    const instance = entryOf(hero.pack, offer.target);
    const name = instance ? nameOf(instance, hero.identification) : '';
    return offer.id === 'removeCurse'
      ? say(service, offer.id, 'sub', { item: name, floor: instance?.foundOnFloor ?? 1 })
      : say(service, offer.id, 'sub', { item: name });
  }
  if (offer.id === 'cure') {
    return say(service, offer.id, 'sub', {
      what: (offer.clears ?? []).map((id) => t(`conditions.${id}.name`)).join(', '),
    });
  }
  if (offer.id === 'restore') {
    const key = offer.stacks === 1 ? 'sub' : 'subMany';
    return say(service, offer.id, key, { n: offer.stacks });
  }
  if (offer.id === 'respec') return say(service, offer.id, 'sub', { n: hero.skillPointsSpent ?? spent(hero) });
  if (offer.id === 'identifyAll') return say(service, offer.id, 'sub', { n: offer.count });
  return say(service, offer.id, 'sub');
}

/** How many points a respec would hand back, for its line. */
function spent(hero) {
  return (hero.skills ?? []).reduce((total, row) => total + (row.rank ?? 1) - (row.free ?? 0), 0);
}

/** The name one offer shows, which is the service's own word for it. */
export function nameFor(service, offer) {
  return say(service, offer.id, 'name');
}

/**
 * Builds one of the three. The differences are the id, the words, and what
 * `offersOf` puts on the list.
 * @param {'inn' | 'temple' | 'sage'} service
 * @returns {import('../../shell/router.js').Screen}
 */
export function createServiceScreen(service) {
  return {
    id: service,
    pattern: 'list-detail',
    regions: REGIONS,

    build({ router, run }) {
      const hero = run.hero;
      let chosen = null;

      const list = el('div', { class: 'region block' });
      const detail = el('div', { class: 'region note' });
      const cost = el('div', { class: 'region note' });
      const pay = el('div', { class: 'region keyslot' });
      const bar = el('div', { class: 'region topbar' });

      const offerAt = (offers) => offers.find((offer) => keyOf(offer) === chosen) ?? null;
      const keyOf = (offer) => `${offer.id}:${offer.target ?? ''}`;

      const paint = () => {
        const offers = offersOf(service, hero);
        const picked = offerAt(offers);

        // The bar is repainted in place — its own children rather than a bar
        // inside a bar, which would leave the gold chip stranded beside the
        // title instead of out at the edge.
        const painted = topBar({
          title: t(`service.${service}.title`),
          onBack: () => router.back(),
          chips: [chip(t('service.gold', { n: hero.gold ?? 0 }), { tone: 'accent' })],
        });
        bar.replaceChildren(...painted.childNodes);

        list.replaceChildren(
          el('span', { class: 'block__label', text: t('service.label') }),
          scrollPanel({
            ariaLabel: t('service.label'),
            children: offers.length
              ? offers.map((offer) =>
                  listRow({
                    name: nameFor(service, offer),
                    sub: subFor(service, offer, hero),
                    side: offer.why ? t('service.free') : t('service.cost', { n: offer.cost }),
                    selected: keyOf(offer) === chosen,
                    reason: offer.why ? t(`service.why.${offer.why}`) : undefined,
                    onTap: () => {
                      chosen = keyOf(offer);
                      paint();
                    },
                  }),
                )
              : [el('span', { class: 'hint', text: t('service.none') })],
          }),
        );

        detail.replaceChildren(
          el('span', {
            class: 'hint',
            text: picked ? say(service, picked.id, 'detail') : t('service.pick'),
          }),
        );

        cost.replaceChildren(
          el('span', {
            class: 'reward__value',
            text: picked ? t('service.cost', { n: picked.cost }) : '',
          }),
        );

        const why = whyNot(hero, picked);
        pay.replaceChildren(
          button({
            label: t('service.pay'),
            kind: 'primary',
            reason: why ? t(`service.why.${why}`) : undefined,
            onTap: () => {
              take(hero, picked);
              chosen = null;
              paint();
            },
          }),
        );
      };
      paint();

      return {
        topBar: bar,
        flavour: el('div', { class: 'region portrait' }, [
          el('div', { class: 'portrait__frame', text: t('service.portrait') }),
          el('span', { class: 'hint', text: t(`service.${service}.flavour`) }),
        ]),
        list,
        detail,
        cost,
        pay,
      };
    },
  };
}

export const inn = createServiceScreen('inn');
export const temple = createServiceScreen('temple');
export const sage = createServiceScreen('sage');
