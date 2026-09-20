/**
 * Level Up (`00-build-outline.md`, "Combat and Rewards").
 *
 * What a level was worth, and the attribute point it may carry. Tall: LEVEL N,
 * four gain tiles, the picker, a reminder, then SKILL TREE and CONFIRM. Wide
 * ("fold"): the level and its tiles on the left, the picker and the buttons
 * on the right.
 *
 * The level itself happened when the XP landed (`06` section 15 step 5), so
 * the screen reports it. The one thing still to decide is the attribute point
 * at levels 4, 8, 12, 16 and 20: it is picked here and spent on CONFIRM, so a
 * player can change their mind before it is written down.
 *
 * One fight can be worth more than one level. Each arrives as its own card,
 * and CONFIRM moves to the next.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { ATTRIBUTE_ORDER, LEVELING, abbr } from '../../data/attributes.js';
import { previewPoint, spendAttributePoint } from '../../systems/levelling.js';

/** @type {Record<string, import('../../shell/layout.js').RegionDef>} */
export const REGIONS = {
  title: { tall: [1, 9, 1, 4], wide: [1, 9, 1, 3] },
  gains: { tall: [1, 9, 5, 8], wide: [1, 9, 4, 9] },
  picker: { tall: [1, 9, 9, 15], wide: [10, 18, 1, 6] },
  note: { tall: [1, 9, 16, 16], wide: [10, 18, 7, 7] },
  tree: { tall: [1, 4, 17, 18], wide: [10, 13, 8, 9], tap: true },
  confirm: { tall: [5, 9, 17, 18], wide: [14, 18, 8, 9], tap: true },
};

/** The levels the screen shows: the ones it was handed, or the one the hero is on. */
export function levelsFrom(params, hero) {
  if (params?.levels?.length) return params.levels;
  // Opened without a fight behind it — a tool, or a reload. The hero's own
  // level is the card, and only what they still owe is actionable.
  return [
    {
      level: hero?.level ?? 1,
      hp: 0,
      fp: 0,
      maxHp: hero?.maxHp ?? 0,
      maxFp: hero?.maxFp ?? 0,
      skillPoints: 0,
      attributePoint: (hero?.attributePoints ?? 0) > 0,
    },
  ];
}

/** The levels that still hand out an attribute point, as "4, 8, 12, 16, 20". */
export function pointLevels() {
  return LEVELING.attributePointLevels.join(', ');
}

/** The next level that pays an attribute point, or null past the last one. */
export function nextPointLevel(level) {
  return LEVELING.attributePointLevels.find((at) => at > level) ?? null;
}

/** @type {import('../../shell/router.js').Screen} */
export const levelUp = {
  id: 'levelUp',
  pattern: 'fold',
  regions: REGIONS,

  build({ router, run, params = {} }) {
    const who = run.hero;
    const levels = levelsFrom(params, who);
    let at = 0;
    let picked = null;

    const titleBox = el('div', { class: 'region banner banner--level' });
    const gainsBox = el('div', { class: 'region gaintiles' });
    const pickerBox = el('div', { class: 'region block' });
    const noteBox = el('div', { class: 'region note' }, [
      el('span', { class: 'hint', text: t('level.note') }),
    ]);
    const treeBox = el('div', { class: 'region keyslot' });
    const confirmBox = el('div', { class: 'region keyslot' });

    /** This card's level, and whether it is the one that owes a point. */
    const card = () => levels[at];
    const owesPoint = () => Boolean(card().attributePoint) && (who.attributePoints ?? 0) > 0;

    /** One gain tile: what it is, what it gave, and what it came to. */
    const tile = (id, gain, note) =>
      el('div', { class: 'gaintile' }, [
        el('span', { class: 'gaintile__label', text: t(`level.tiles.${id}`) }),
        el('span', { class: 'gaintile__gain', text: gain }),
        el('span', { class: 'hint', text: note }),
      ]);

    const paintTitle = () => {
      const left = levels.length - at - 1;
      titleBox.replaceChildren(
        ...[
          el('span', { class: 'banner__word', text: t('level.banner') }),
          el('span', { class: 'banner__line', text: t('level.title', { n: card().level }) }),
          left > 0 ? chip(t('level.more', { n: left })) : null,
        ].filter(Boolean),
      );
    };

    const paintGains = () => {
      const gain = card();
      const none = t('level.noneYet');
      const span = (amount, after) =>
        amount > 0 ? t('level.from', { before: after - amount, after }) : none;
      const next = nextPointLevel(gain.level);
      gainsBox.replaceChildren(
        tile('hp', gain.hp > 0 ? t('level.gain', { n: gain.hp }) : none, span(gain.hp, gain.maxHp)),
        tile('fp', gain.fp > 0 ? t('level.gain', { n: gain.fp }) : none, span(gain.fp, gain.maxFp)),
        tile(
          'sp',
          gain.skillPoints > 0 ? t('level.gain', { n: gain.skillPoints }) : none,
          t('level.spendOnTree'),
        ),
        tile(
          'attribute',
          gain.attributePoint ? t('level.gain', { n: 1 }) : none,
          gain.attributePoint
            ? t('level.pickBelow')
            : next
              ? t('level.nextPointShort', { n: next })
              : t('level.noMorePointsShort'),
        ),
      );
    };

    const paintPicker = () => {
      // Rows 9-15 carry the picker only on a level that pays for it; on every
      // other level they say when the next one comes (`00`, Level Up).
      if (!owesPoint()) {
        const next = nextPointLevel(card().level);
        pickerBox.replaceChildren(
          el('span', { class: 'block__label', text: t('level.pickTitle') }),
          el('span', {
            class: 'hint',
            text: next ? t('level.nextPoint', { n: next }) : t('level.noMorePoints'),
          }),
        );
        return;
      }

      pickerBox.replaceChildren(
        el('span', { class: 'block__label', text: t('level.pickTitle') }),
        el('span', { class: 'hint', text: t('level.pickWhen', { levels: pointLevels() }) }),
        el(
          'div',
          { class: 'picktiles' },
          ATTRIBUTE_ORDER.map((id) => {
            const score = who.attributes?.[id] ?? 0;
            const ahead = previewPoint(who, id);
            const full = score >= LEVELING.attributePointMax;
            return button({
              label: `${abbr(id)} ${score}`,
              // The tile shows what the point would buy before it is spent.
              hint:
                picked === id
                  ? t('level.raised', {
                      score: ahead.score,
                      mod: ahead.mod >= 0 ? `+${ahead.mod}` : `−${Math.abs(ahead.mod)}`,
                    })
                  : full
                    ? undefined
                    : t('level.raise'),
              reason: full ? t('level.locked.atMaximum') : undefined,
              selected: picked === id,
              class: 'picktile',
              onTap: () => {
                picked = id;
                paint();
              },
            });
          }),
        ),
      );
    };

    const paintKeys = () => {
      treeBox.replaceChildren(
        button({
          label: t('level.tree'),
          reason: router.has?.('skillTree') ? undefined : t('common.comingSoon'),
          onTap: () => router.go('skillTree'),
        }),
      );

      const waiting = owesPoint() && !picked;
      confirmBox.replaceChildren(
        button({
          label: t('level.confirm'),
          kind: 'primary',
          reason: waiting ? t('level.needPick') : undefined,
          onTap: () => {
            if (picked) spendAttributePoint(who, picked);
            picked = null;
            at += 1;
            // The last card leaves; `05` section 11 saves on the screen change.
            if (at >= levels.length) router.go('explore');
            else paint();
          },
        }),
      );
    };

    function paint() {
      paintTitle();
      paintGains();
      paintPicker();
      paintKeys();
    }
    paint();

    return {
      title: titleBox,
      gains: gainsBox,
      picker: pickerBox,
      note: noteBox,
      tree: treeBox,
      confirm: confirmBox,
    };
  },
};
