/**
 * Entry point: build the shell, wire the router, show the Title screen.
 *
 * This is the only module that touches the browser's own APIs. Everything it
 * calls is either a shell module or a screen.
 */
import { watchFrame } from './shell/frame.js';
import { createRouter } from './shell/router.js';
import { createSettings } from './shell/settings.js';
import { createHaptics } from './shell/haptics.js';
import { title } from './ui/screens/title.js';
import { settings as settingsScreen } from './ui/screens/settings.js';
import { explore } from './ui/screens/explore.js';
import { pause } from './ui/screens/pause.js';
import { map } from './ui/screens/map.js';
import { newGame } from './ui/screens/newgame.js';
import { createStats } from './ui/screens/create-stats.js';
import { createOrigin } from './ui/screens/create-origin.js';
import { combat } from './ui/screens/combat.js';
import { combatSkills } from './ui/screens/combat-skills.js';
import { createRun, PLACEHOLDER_HERO } from './systems/run.js';
import { createFight, standInHero } from './systems/fight.js';
import { createDraft } from './systems/creation.js';

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const isBuild = document.documentElement.dataset.build === '1';

const settings = createSettings();
const haptics = createHaptics(settings);

/** Settings that change how the frame looks are applied to <html>. */
function applySettings(values) {
  document.documentElement.dataset.text = values.textSize;
  document.documentElement.dataset.hand = values.hand;
}
applySettings(settings.all);

/**
 * Until the save layer arrives (Phase 8) a session holds one run in memory.
 * Creation makes one from the hero it rolled; opening Exploration without
 * having made a hero — the tools do, through the URL fragment — falls back to
 * the demonstration seed and the stand-in of Phase 2.
 */
const DEMO_SEED = 20260918;

/** @type {ReturnType<typeof createRun> | null} */
let run = null;
/** @type {object | null} */
let hero = null;

/**
 * Starts a run. The Town is Phase 6, so a new hero goes straight to the first
 * floor; when the Town exists, creation will hand the hero to it instead.
 * @param {object} [newHero] the hero creation finished, if there is one
 */
function startRun(newHero) {
  hero = newHero ?? hero;
  run = createRun({
    masterSeed: hero?.seed ?? DEMO_SEED,
    floor: 1,
    ...(hero ? { hero } : {}),
  });
  fight = null;
  return run;
}

const save = {
  hasGame: true,
  get lastPlayed() {
    const who = hero ?? PLACEHOLDER_HERO;
    return {
      name: who.name,
      level: who.level,
      floor: run?.floor.floor ?? 1,
      theme: run?.floor.spec.theme ?? '',
      mode: hero?.mode === 'ironman' ? 'Ironman' : 'Adventurer',
      played: '0m',
    };
  },
};

const screens = {
  title,
  settings: settingsScreen,
  newGame,
  createStats,
  createOrigin,
  explore,
  pause,
  map,
  combat,
  combatSkills,
};

/**
 * Phase 3 has no encounter trigger on the map yet: the step clock reports a
 * wandering monster and the Exploration screen only logs it. So the fight the
 * Combat screen shows is rolled here, once, from floor 1's table — enough to
 * play a fight through on a phone. Phase 4 hands it the real hero, and the
 * exploration loop starts it when the clock says so.
 */
let fight = null;
function startFight() {
  const current = run ?? startRun();
  fight = createFight({
    // A created hero brings their own attack bonus and DEF; the weapon is
    // still the stand-in's until the pack arrives (`04`, Phase 5).
    hero: standInHero(current.hero),
    floor: current.floor.floor,
    masterSeed: current.masterSeed,
    difficulty: hero?.difficulty ?? settings.all.difficulty ?? 'normal',
  });
  return fight;
}

/** @type {ReturnType<typeof createRouter>} */
let router;

// Rotating or resizing re-renders the current screen from the same state.
const watcher = watchFrame(app, () => router?.render());

router = createRouter({
  app,
  screens,
  frame: () => watcher.frame,
  ctx: {
    settings,
    haptics,
    save,
    // The run is made when a hero is, so the screens ask for it rather than
    // being handed one at startup.
    get run() {
      return run ?? startRun();
    },
    startRun,
    // The screen reads the fight in progress, and starting one is what
    // opening the screen means until the exploration loop does it.
    get fight() {
      return fight ?? startFight();
    },
  },
});

// A settings change repaints whatever screen is open.
settings.subscribe((values) => {
  applySettings(values);
  router.render();
});

// The tools drive the game from outside the page: `npm run shots` walks a
// floor before shooting the Automap, and `npm run check` opens each screen.
// It is one object on the global, and nothing in the game reads it.
globalThis.underkeep = {
  get run() {
    return run ?? startRun();
  },
  startRun,
  router,
  settings,
  // `npm run shots` opens Create: Origin, which needs a hero half-made.
  newDraft: (options) => createDraft({ seed: DEMO_SEED, rollMode: 'standard', ...options }),
  startFight,
  get fight() {
    return fight;
  },
};

// The URL fragment may name a screen, which is how tools/shots.js opens each
// one for a frame check. Anything unknown just starts at the Title screen.
router.go(screens[location.hash.slice(1)] ? location.hash.slice(1) : 'title');

// A panel flashes its outline for 150 ms on a tap; no other animation is needed
// to understand the game (00-build-outline.md, "Feedback").
app.addEventListener('pointerdown', (event) => {
  const target = /** @type {HTMLElement} */ (event.target)?.closest?.('.btn, .listrow');
  if (!target || target.hasAttribute('disabled')) return;
  target.classList.remove('flash');
  void target.offsetWidth; // restart the animation
  target.classList.add('flash');
  haptics.buzz('tap');
});

// In a normal browser tab the first tap asks for fullscreen, where the browser
// supports it. An installed app is already fullscreen and never gets here.
app.addEventListener(
  'click',
  () => {
    if (document.fullscreenElement) return;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return;
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  },
  { once: true },
);

// Double-tap zoom is off through touch-action, but iOS still zooms on a
// pinch gesture inside a web app unless it is refused outright.
document.addEventListener('gesturestart', (event) => event.preventDefault());

if (isBuild && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline play is a bonus; a failed registration must never stop a game.
    });
  });
}
