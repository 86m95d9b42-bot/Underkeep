/**
 * Victory and Loot (`00-build-outline.md`, "Combat and Rewards").
 *
 * What the fight paid: the XP with its bar, the gold, and the drops. Tall:
 * VICTORY, XP, gold, the drop list, a pack warning, then TAKE ALL and
 * CONTINUE. Wide ("list + detail"): the drops on the left, everything else
 * on the right.
 *
 * Nothing here decides anything. `06` section 15 awards the XP, the gold and
 * the levels as combat ends, and `05` section 11 wants them committed before
 * they are shown — so this screen reports what has already happened. Items
 * arrive in Phase 5; until then a fight pays coin, and TAKE ALL says why it
 * has nothing to do.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { bar, chip, listRow, scrollPanel } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { progress } from '../../systems/levelling.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  title: { tall: [1, 9, 1, 3], wide: [1, 9, 1, 2] },
  xp: { tall: [1, 9, 4, 5], wide: [10, 18, 1, 3] },
  gold: { tall: [1, 9, 6, 7], wide: [10, 18, 4, 5] },
  drops: { tall: [1, 9, 8, 15], wide: [1, 9, 3, 9] },
  warning: { tall: [1, 9, 16, 16], wide: [10, 18, 6, 7] },
  takeAll: { tall: [1, 4, 17, 18], wide: [10, 13, 8, 9], tap: true },
  next: { tall: [5, 9, 17, 18], wide: [14, 18, 8, 9], tap: true },
};

/** What a victory paid, from the fight that has already banked it. */
export function rewardOf(fight) {
  const summary = fight?.summary;
  return {
    xp: summary?.xp ?? 0,
    gold: summary?.gold ?? 0,
    loot: summary?.loot ?? [],
    levels: summary?.levels ?? [],
  };
}

/** @type {import('../../shell/router.js').Screen} */
export const loot = {
  id: 'loot',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, run, fight }) {
    const who = run.hero;
    const reward = rewardOf(fight);
    const climb = progress(who);

    const title = el('div', { class: 'region banner banner--win' }, [
      el('span', { class: 'banner__word', text: t('loot.title') }),
    ]);

    // The XP card is outlined in the XP bar's own colour, as the mockup draws
    // it, and carries the LEVEL UP chip when the fight earned one.
    const xp = el('div', { class: 'region reward reward--xp' }, [
      el('div', { class: 'reward__head' }, [
        el('span', { class: 'reward__label', text: t('loot.xp', { n: reward.xp }) }),
        reward.levels.length ? chip(t('loot.levelUp'), { tone: 'accent' }) : null,
      ]),
      bar({
        kind: 'xp',
        value: climb.needed ? climb.into : 1,
        max: climb.needed || 1,
        name: t('loot.xpLabel'),
        valueText: climb.needed
          ? t('loot.xpBar', { into: climb.into, needed: climb.needed })
          : t('loot.atCap'),
      }),
    ]);

    const gold = el('div', { class: 'region reward reward--gold' }, [
      el('span', { class: 'reward__label', text: t('loot.gold') }),
      el('span', { class: 'reward__value', text: t('loot.goldGain', { n: reward.gold }) }),
    ]);

    // The label sits in the region with its list, as every labelled panel does.
    const drops = el('div', { class: 'region block' }, [
      el('span', { class: 'block__label', text: t('loot.drops') }),
      scrollPanel({
        ariaLabel: t('loot.drops'),
        children: reward.loot.length
          ? reward.loot.map((item) =>
              listRow({ name: item.name, sub: item.note, side: t('loot.take') }),
            )
          : [el('span', { class: 'hint', text: t('loot.noDrops') })],
      }),
    ]);

    // Row 16 is for a pack that cannot hold what is on the floor; with no
    // items yet it says what the purse holds instead.
    const warning = el('div', { class: 'region note' }, [
      el('span', { class: 'hint', text: t('loot.purse', { n: who.gold ?? 0 }) }),
    ]);

    const takeAll = el('div', { class: 'region keyslot' }, [
      button({
        label: t('loot.takeAll'),
        reason: reward.loot.length ? undefined : t('loot.nothingToTake'),
      }),
    ]);

    // CONTINUE goes to Level Up when the fight earned one, and back to the
    // dungeon when it did not (`00`, the screen flow).
    const earned = reward.levels.length > 0;
    const next = el('div', { class: 'region keyslot' }, [
      button({
        label: t('loot.continue'),
        hint: earned ? t('loot.toLevel') : undefined,
        kind: 'primary',
        onTap: () => (earned ? router.go('levelUp', { levels: reward.levels }) : router.go('explore')),
      }),
    ]);

    return { title, xp, gold, drops, warning, takeAll, next };
  },
};
