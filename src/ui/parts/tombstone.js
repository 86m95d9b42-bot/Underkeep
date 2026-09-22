/**
 * A tombstone, as the Death screen and the Hall of the Dead draw one
 * (`05` section 12, "styled as tombstones in the tradition of Rogue"): the
 * mode chip, HERE LIES, the name, level and origin, what killed them, and the
 * floor and day. A hero who finished the game gets VICTORIOUS instead.
 */
import { el } from './el.js';
import { chip } from './parts.js';
import { t } from '../../data/strings.js';
import { causeText } from '../../systems/death.js';

/** "CUTPURSE" as a stone says it: "Cutpurse". */
export function titleCase(word) {
  const text = String(word ?? '');
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : '';
}

/** The origin a record names, the way a stone says it. */
export function originName(record) {
  return record?.origin ? titleCase(t(`origins.${record.origin}.name`)) : '';
}

/** Numbers the way the mockups write them: 15,213. */
export function grouped(n) {
  return String(Math.round(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * @param {object} record from `systems/death.js`
 * @param {{ extra?: (Node | null)[] }} [options] lines under the floor and day
 * @returns {HTMLElement}
 */
export function tombstone(record, { extra = [] } = {}) {
  const ironman = record.mode === 'ironman';
  const where = record.floor ? t('death.floorDay', { floor: record.floor, day: record.day }) : '';
  return el('div', { class: `stone${record.victory ? ' stone--victory' : ''}` }, [
    chip(t(`death.modes.${ironman ? 'ironman' : 'adventurer'}`), { tone: ironman ? 'danger' : 'accent' }),
    el('span', { class: 'stone__lies', text: record.victory ? t('death.victorious') : t('death.hereLies') }),
    el('span', { class: 'stone__name', text: record.name }),
    el('span', {
      class: 'stone__line',
      text: t('death.levelOrigin', { level: record.level, origin: originName(record) }),
    }),
    el('span', {
      class: record.victory ? 'stone__cause stone__cause--victory' : 'stone__cause',
      text: record.victory ? t('death.victory') : causeText(record.cause),
    }),
    where ? el('span', { class: 'stone__where', text: where }) : null,
    ...extra,
  ]);
}
