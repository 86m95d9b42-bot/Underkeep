/**
 * Sound: short synthesized effects through Web Audio, and no music
 * (docs/DECISIONS.md, Sound). Each cue is a few notes from an oscillator with
 * a quick fade, so the game ships no audio files and stays one page.
 *
 * Browsers only let a page make sound after the player has touched it, so the
 * audio context is made on the first tap (`unlock`) and never before. Silent
 * when the setting is off, when the page is hidden, or where there is no Web
 * Audio at all.
 *
 * The context is passed in by the host, so a test hands over a fake one.
 */

/**
 * Each cue as notes: [frequency in Hz, seconds, waveform, loudness 0-1].
 * Low and short for what hurts, rising for what is won.
 * @type {Record<string, [number, number, OscillatorType, number][]>}
 */
export const CUES = {
  tap: [[660, 0.025, 'square', 0.04]],
  bump: [[110, 0.06, 'square', 0.08]],
  hit: [[180, 0.07, 'sawtooth', 0.14], [120, 0.08, 'sawtooth', 0.1]],
  crit: [[520, 0.05, 'square', 0.14], [780, 0.05, 'square', 0.12], [390, 0.1, 'sawtooth', 0.12]],
  trap: [[300, 0.05, 'square', 0.14], [140, 0.16, 'sawtooth', 0.14]],
  warn: [[440, 0.08, 'triangle', 0.1], [440, 0.08, 'triangle', 0.1]],
  levelUp: [[523, 0.08, 'triangle', 0.12], [659, 0.08, 'triangle', 0.12], [784, 0.08, 'triangle', 0.12], [1047, 0.18, 'triangle', 0.12]],
  victory: [[392, 0.09, 'triangle', 0.12], [523, 0.16, 'triangle', 0.12]],
  death: [[220, 0.2, 'triangle', 0.14], [165, 0.25, 'triangle', 0.12], [110, 0.45, 'triangle', 0.12]],
};

/** How long a note takes to fade in and out, so nothing clicks. */
const EDGE = 0.008;

/**
 * @param {import('./settings.js').SettingsStore} settings
 * @param {{ makeContext?: () => AudioContext | null, visible?: () => boolean }} [options]
 */
export function createSound(settings, { makeContext, visible } = {}) {
  const make =
    makeContext ??
    (() => {
      const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      return Ctor ? new Ctor() : null;
    });
  const inFront = visible ?? (() => globalThis.document?.visibilityState !== 'hidden');
  /** @type {AudioContext | null} */
  let context = null;
  let failed = false;

  const on = () => settings.get('sound') === 'on';

  return {
    /**
     * Makes the audio context, from inside a tap. Called by the host on every
     * pointerdown; after the first it only wakes a context the browser put
     * to sleep.
     */
    unlock() {
      if (!on() || failed) return;
      try {
        context ??= make();
        if (!context) failed = true;
        else if (context.state === 'suspended') context.resume?.();
      } catch {
        failed = true;
      }
    },

    /** @param {keyof typeof CUES} kind */
    play(kind) {
      const notes = CUES[kind];
      if (!notes || !context || !on() || !inFront()) return false;
      try {
        let at = context.currentTime;
        for (const [frequency, seconds, type, loudness] of notes) {
          const osc = context.createOscillator();
          const gain = context.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(frequency, at);
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(loudness, at + EDGE);
          gain.gain.linearRampToValueAtTime(0, at + seconds);
          osc.connect(gain);
          gain.connect(context.destination);
          osc.start(at);
          osc.stop(at + seconds + EDGE);
          at += seconds;
        }
        return true;
      } catch {
        // Sound is decoration; a failed note is never a failed game.
        return false;
      }
    },
  };
}
