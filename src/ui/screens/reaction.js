/**
 * Combat: Reaction — the pause prompt (`00-build-outline.md`,
 * "Combat: Reaction"; `06` section 17).
 *
 * Tall: the "Combat paused" strip (rows 1–3), the HIT! card — who struck,
 * for how much, the attack total against DEF (4–9) — REACT? (10), one button
 * per reaction the hero can use, then TAKE THE HIT (11–16), and the prompt
 * setting (17–18). Wide ("panel"): the same sheet as a right-hand panel over
 * the dimmed fight.
 *
 * The fight has already stopped at the hit and put itself back to the start
 * of that monster's turn; answering plays the turn out again with the answer
 * (`fight.react`). The prompt is modal: there is no closing it unanswered,
 * and the Combat screen opens it again if it is.
 */
import { el } from '../parts/el.js';
import { button, segmented } from '../parts/button.js';
import { t } from '../../data/strings.js';
import { skill } from '../../data/skills.js';
import { logName } from '../../systems/fight.js';
import { commitThenShow } from '../commit.js';

/** The reactions the prompt can offer, in the order the mockup lists them. */
export const OFFERED = ['arcaneShield', 'lucky'];

/** Which skill each answer is, for its name and cost. */
const SKILL_OF = { arcaneShield: 'arcane_shield', lucky: 'lucky' };

export const POLICIES = ['ask', 'auto', 'never'];

/** @type {import('../../shell/router.js').Screen} */
export const reaction = {
  id: 'reaction',
  pattern: 'panel',
  regions: {
    // The whole height: the panel pattern turns it into cols 11-18 in wide.
    sheet: { tall: [1, 9, 1, 18], side: 'right' },
  },

  /** The back gesture cannot skip a hit; the prompt waits for an answer. */
  onBack: () => true,

  build(ctx) {
    const { router, fight, settings } = ctx;
    const prompt = fight?.reaction ?? null;

    // Nothing waiting — answered already, or opened by a tool without a fight
    // behind it: the sheet shows what a prompt looks like and closes on use.
    const shown = prompt ?? {
      attackerName: 'Grukk, the Goblin King',
      boss: true,
      damage: 11,
      total: 17,
      def: 16,
      options: ['arcaneShield', 'lucky'],
    };
    const attacker = prompt ? fight.combat.units.find((unit) => unit.id === prompt.attacker) : null;
    const who = attacker ? logName(attacker, { start: true }) : shown.attackerName;

    const answer = (choice) => {
      if (!prompt) {
        router.closeSheet();
        return;
      }
      commitThenShow(ctx, () => fight.react(choice), () => {
        // Another hit may be waiting in the same turn; otherwise back to the fight.
        if (fight.reaction) router.render();
        else router.closeSheet();
      });
    };

    const strip = el('div', { class: 'reaction__strip' }, [
      el('span', { class: 'reaction__paused', text: t('combat.reaction.paused') }),
    ]);

    const card = el('div', { class: 'reaction__card' }, [
      el('span', { class: 'reaction__hit', text: t('combat.reaction.hit') }),
      el('span', { class: 'reaction__line', text: t('combat.reaction.strikes', { who, n: shown.damage }) }),
      el('span', { class: 'hint', text: t('combat.reaction.roll', { total: shown.total, def: shown.def }) }),
    ]);

    const label = el('span', { class: 'section-label reaction__label', text: t('combat.reaction.react') });

    const hints = {
      arcaneShield: t('combat.reaction.arcaneShieldHint', { n: skill('arcane_shield').fp ?? 2 }),
      lucky: t('combat.reaction.luckyHint'),
    };
    const buttons = el('div', { class: 'reaction__buttons' }, [
      ...OFFERED.filter((id) => shown.options.includes(id)).map((id) =>
        button({
          label: t(`skills.${SKILL_OF[id]}.name`),
          hint: hints[id],
          onTap: () => answer(id),
        }),
      ),
      button({
        label: t('combat.reaction.take'),
        hint: t('combat.reaction.takeHint', { n: shown.damage }),
        kind: 'primary',
        onTap: () => answer('take'),
      }),
    ]);

    // The shortcut changes what happens next time; this hit still wants an answer.
    const setting = el('div', { class: 'reaction__setting' }, [
      el('span', { class: 'section-label', text: t('combat.reaction.setting') }),
      segmented({
        options: POLICIES.map((value) => ({ value, label: t(`combat.reaction.policies.${value}`) })),
        value: settings?.all?.reactions ?? 'ask',
        ariaLabel: t('combat.reaction.setting'),
        onPick: (value) => settings?.set?.('reactions', value),
      }),
    ]);

    return {
      sheet: el(
        'div',
        { class: 'region sheet reaction', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('combat.reaction.paused') },
        [strip, card, label, buttons, setting],
      ),
    };
  },
};
