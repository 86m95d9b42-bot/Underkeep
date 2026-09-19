/**
 * Conditions as hooks (`06` sections 10 and 16).
 *
 * `06` section 16 lists Poison, Burning and Bleeding under `turnStart`, and
 * the end-of-turn saves and duration ticks under `turnEnd`. This is that
 * wiring: the rules stay in `conditions.js`, which knows nothing about combat,
 * and this file is the only place that knows both.
 *
 * Registering is per combat, not per unit: one set of hooks reads whichever
 * unit the event is about, so a summon that arrives mid-fight needs no setup.
 */
import {
  startOfTurnDamage,
  endOfTurnSaves,
  tickDurations,
  tickControlImmunity,
  endOfRound,
  onDamageTaken,
  onHealed,
  onOwnAction,
  attackMods,
  defenceMods,
  defMod,
  drFrom,
  halvesWeaponDamage,
  afterCombat,
  START_OF_TURN_DAMAGE_ORDER,
} from './conditions.js';

/**
 * Registers every condition hook on a combat's register.
 *
 * @param {ReturnType<import('./hooks.js').createHooks>} hooks
 * @param {object} [services] what the hooks need from the engine
 * @param {import('./rng.js').Stream} [services.rng] the combat stream
 * @param {(unit: object, save: string) => number} [services.saveBonus]
 * @param {(unit: object, amount: number, source: object) => void} [services.hurt]
 *   applies damage through the damage rules; without it the hook only reports
 * @returns {() => void} removes them all again
 */
export function registerConditionHooks(hooks, { rng, saveBonus = () => 0, hurt } = {}) {
  const source = 'conditions';
  const off = [];

  /* -- turnStart: the damage a condition deals ------------------------- */

  // One hook per condition, named as `06` section 16 names them, so they run
  // in the documented order even among other turnStart hooks.
  for (const id of START_OF_TURN_DAMAGE_ORDER) {
    off.push(
      hooks.on(
        'turnStart',
        (payload) => {
          const unit = payload.unit;
          // `06` section 5 fires turnStart twice: once for the clock (step 3)
          // and once for the free traits (step 7). The clock runs on the first.
          if (!unit || payload.phase === 'free') return;
          const rolls = startOfTurnDamage(unit, payload.rng ?? rng).filter((row) => row.id === id);
          for (const row of rolls) {
            payload.damage ??= [];
            payload.damage.push({ ...row, unit });
            hurt?.(unit, row.amount, { kind: 'condition', id });
            payload.say(`${id} ${row.amount}`);
          }
        },
        { name: id, source },
      ),
    );
  }

  /* -- turnEnd: saves, then durations, then immunity ------------------- */

  off.push(
    hooks.on(
      'turnEnd',
      (payload) => {
        const unit = payload.unit;
        if (!unit) return;
        const saves = endOfTurnSaves(unit, payload.rng ?? rng, (type) => saveBonus(unit, type));
        payload.saves = saves;
        for (const save of saves) if (save.passed) payload.say(`${save.id} ended on a save`);
      },
      { name: 'saves', source },
    ),
  );

  off.push(
    hooks.on(
      'turnEnd',
      (payload) => {
        const unit = payload.unit;
        if (!unit) return;
        payload.ended = tickDurations(unit);
        payload.immunityOver = tickControlImmunity(unit);
        for (const id of payload.ended) payload.say(`${id} ended`);
      },
      { name: 'durations', source },
    ),
  );

  /* -- roundEnd: Sickened goes when the round does --------------------- */

  off.push(
    hooks.on(
      'roundEnd',
      (payload) => {
        for (const unit of payload.units ?? []) {
          for (const id of endOfRound(unit)) payload.say(`${id} ended on ${unit.id}`);
        }
      },
      { name: 'sickened', source },
    ),
  );

  /* -- damageTaken: what damage and healing end ------------------------ */

  off.push(
    hooks.on(
      'damageTaken',
      (payload) => {
        const unit = payload.target;
        if (!unit) return;
        const woken = payload.amount > 0 ? onDamageTaken(unit) : [];
        const healed = payload.healing ? onHealed(unit) : [];
        for (const id of [...woken, ...healed]) payload.say(`${id} ended`);
      },
      { name: 'wake', source },
    ),
  );

  /* -- damageCalc: what conditions do to a number ---------------------- */

  off.push(
    hooks.on(
      'damageCalc',
      (payload) => {
        // 06 section 7: Weakened halves weapon damage, Petrified's DR 5 comes
        // off once per hit. The damage rules own the order; this only reports
        // what the conditions contribute.
        if (payload.attacker && halvesWeaponDamage(payload.attacker) && payload.weapon) {
          payload.halved = true;
        }
        if (payload.target) payload.conditionDr = drFrom(payload.target);
      },
      { name: 'weakened', source },
    ),
  );

  /* -- attackRoll: advantage and disadvantage from both sides ---------- */

  // `06` section 6 throws the die at step 5 and judges it at step 8, so the
  // engine fires this event twice. What a condition does to a roll has to be
  // known before the die, which is the `gather` phase.
  off.push(
    hooks.on(
      'attackRoll',
      (payload) => {
        if (payload.phase === 'judge') return;
        const fromAttacker = payload.attacker ? attackMods(payload.attacker) : {};
        const fromTarget = payload.target ? defenceMods(payload.target) : {};
        payload.advantage = Boolean(payload.advantage || fromAttacker.advantage || fromTarget.advantage);
        payload.disadvantage = Boolean(
          payload.disadvantage || fromAttacker.disadvantage || fromTarget.disadvantage,
        );
        if (fromTarget.autoHit) payload.autoHit = true;
        if (payload.target) payload.targetDefMod = defMod(payload.target);
      },
      { name: 'rider', source },
    ),
  );

  /* -- beforeAction: acting ends Hidden, attacking ends Knocked Down --- */

  off.push(
    hooks.on(
      'beforeAction',
      (payload) => {
        const unit = payload.unit;
        // Step 2 of an attack fires this event again to offer Guardian the
        // blow; acting is what ends Hidden, and that already happened.
        if (!unit || payload.free || payload.phase === 'redirect') return;
        // The turn engine puts the action's tags on the payload; without them
        // every action counts as an active one, which is the old behaviour.
        const tags = payload.tags ? new Set(payload.tags) : null;
        const attacked = tags ? tags.has('attack') : payload.action === 'attack';
        const active = tags ? attacked || tags.has('skill') : true;
        const ended = onOwnAction(unit, { attacked, active });
        for (const id of ended) payload.say(`${id} ended`);
      },
      { name: 'legality', source },
    ),
  );

  /* -- combatEnd: what a fight leaves behind --------------------------- */

  off.push(
    hooks.on(
      'combatEnd',
      (payload) => {
        for (const unit of payload.units ?? []) {
          const result = afterCombat(unit);
          if (result.exploration.length) payload.say(`${unit.id} is still poisoned`);
        }
      },
      { name: 'xp', source },
    ),
  );

  return () => {
    for (const remove of off) remove();
  };
}
