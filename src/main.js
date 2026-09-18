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
import { createRun, PLACEHOLDER_HERO } from './systems/run.js';

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
 * Phase 2 has no character creation and no save layer, so the game starts on
 * one fixed seed with a stand-in hero. New Game (Phase 4) chooses the seed and
 * the hero; the IndexedDB store (Phase 8) reloads them.
 */
const DEMO_SEED = 20260918;
const run = createRun({ masterSeed: DEMO_SEED, floor: 1 });

const save = {
  hasGame: true,
  lastPlayed: {
    name: PLACEHOLDER_HERO.name,
    level: PLACEHOLDER_HERO.level,
    floor: run.floor.floor,
    theme: run.floor.spec.theme,
    mode: 'Adventurer',
    played: '0m',
  },
};

const screens = {
  title,
  settings: settingsScreen,
  explore,
  pause,
};

/** @type {ReturnType<typeof createRouter>} */
let router;

// Rotating or resizing re-renders the current screen from the same state.
const watcher = watchFrame(app, () => router?.render());

router = createRouter({
  app,
  screens,
  frame: () => watcher.frame,
  ctx: { settings, haptics, save, run },
});

// A settings change repaints whatever screen is open.
settings.subscribe((values) => {
  applySettings(values);
  router.render();
});

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
