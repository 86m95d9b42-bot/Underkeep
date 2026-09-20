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
import { hero as heroScreen } from './ui/screens/hero.js';
import { skillTree } from './ui/screens/skill-tree.js';
import { town as townScreen } from './ui/screens/town.js';
import { shop as shopScreen } from './ui/screens/shop.js';
import { inn, sage, temple } from './ui/screens/service.js';
import { alchemist } from './ui/screens/alchemist.js';
import { stash } from './ui/screens/stash.js';
import { gate } from './ui/screens/gate.js';
import { pack as packScreen } from './ui/screens/pack.js';
import { itemDetail } from './ui/screens/item-detail.js';
import { combat } from './ui/screens/combat.js';
import { combatSkills } from './ui/screens/combat-skills.js';
import { loot } from './ui/screens/loot.js';
import { levelUp } from './ui/screens/levelup.js';
import { PLACEHOLDER_HERO } from './systems/run.js';
import { createSession } from './systems/session.js';
import { standInHero } from './systems/fight.js';
import { chooseOrigin, createDraft, finish, setName } from './systems/creation.js';
import { awardXp, xpNeeded } from './systems/levelling.js';
import { learn } from './systems/skill-tree.js';

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
 * Creation makes one from the hero it rolled; opening a screen without having
 * made a hero — the tools do, through the URL fragment — rolls one from the
 * demonstration seed, so every screen has a real hero to draw.
 */
const DEMO_SEED = 20260918;

/** The hero a session falls back on: rolled the way a player would roll one. */
function demoHero() {
  return finish(
    setName(chooseOrigin(createDraft({ seed: DEMO_SEED, rollMode: 'standard' }), 'sellsword'), 'Harrow'),
  );
}

/** @type {ReturnType<typeof createSession> | null} */
let session = null;

/**
 * The game in progress. Creation makes one from the hero it rolled; opening
 * a screen without having made a hero — the tools do, through the URL
 * fragment — makes one from the demonstration seed, so every screen has a
 * real hero to draw.
 * @param {object} [newHero] the hero creation finished, if there is one
 */
function startRun(newHero) {
  if (newHero || !session) {
    session = createSession({
      hero: newHero ?? session?.hero ?? demoHero(),
      seed: DEMO_SEED,
      difficulty: newHero?.difficulty ?? settings.all.difficulty ?? 'normal',
      go: (to, params) => router.go(to, params),
    });
  }
  return session.run ?? session.descend({ floor: 1 });
}

/** The session, made on the first ask. */
function game() {
  if (!session) startRun();
  return /** @type {ReturnType<typeof createSession>} */ (session);
}

const save = {
  hasGame: true,
  get lastPlayed() {
    const who = session?.hero ?? PLACEHOLDER_HERO;
    return {
      name: who.name,
      level: who.level,
      floor: session?.run?.floor.floor ?? 1,
      theme: session?.run?.floor.spec.theme ?? '',
      mode: who.mode === 'ironman' ? 'Ironman' : 'Adventurer',
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
  hero: heroScreen,
  skillTree,
  town: townScreen,
  shop: shopScreen,
  inn,
  temple,
  sage,
  alchemist,
  stash,
  gate,
  pack: packScreen,
  itemDetail,
  combat,
  combatSkills,
  loot,
  levelUp,
};

/**
 * Phase 3 has no encounter trigger on the map yet: the step clock reports a
 * wandering monster and the Exploration screen only logs it. So the fight the
 * Combat screen shows is rolled here, once, from floor 1's table — enough to
 * play a fight through on a phone. Phase 4 hands it the real hero, and the
 * exploration loop starts it when the clock says so.
 */
function startFight(seed) {
  const current = game();
  // The solo protections are a flag on the unit, and a hero who was made
  // before them gets them here (`01`, and the conditions ruling).
  standInHero(current.hero);
  // A tool asking for another fight passes its own seed; the same one would
  // hand back the same encounter and the same rolls.
  return current.startFight({ seed });
}

/** @type {ReturnType<typeof createRouter>} */
let router;

// Rotating or resizing re-renders the current screen from the same state.
const watcher = watchFrame(app, () => router?.render());

/** The session's own state, which the screens reach through the router. */
const ctx = {
  settings,
  haptics,
  save,
  // Every screen reads the game in progress; `systems/session.js` is what
  // one is, and this hands the screens their way into it.
  get run() {
    return game().run ?? startRun();
  },
  startRun,
  get fight() {
    return game().fight ?? startFight();
  },
  get town() {
    return game().town;
  },
  get shop() {
    return game().shop;
  },
  descend(options) {
    return game().descend(options);
  },
  leaveDungeon(options) {
    return game().leaveDungeon(options);
  },
};

router = createRouter({ app, screens, frame: () => watcher.frame, ctx });

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
    return game().run ?? startRun();
  },
  get session() {
    return game();
  },
  startRun,
  router,
  settings,
  // `npm run shots` opens Create: Origin, which needs a hero half-made.
  newDraft: (options) => createDraft({ seed: DEMO_SEED, rollMode: 'standard', ...options }),

  /**
   * And the Hero screens want a hero who has been somewhere: this levels the
   * stand-in and spends a few points before opening one of them.
   */
  /**
   * The rewards screens want a fight that is over: this plays one out with
   * the hero attacking until nothing is standing, then opens Victory or the
   * Level Up card it earned.
   */
  showVictory(screen = 'loot') {
    const current = game().run ?? startRun();
    // A hero who has been down a few floors, left a few XP short so the fight
    // is worth a level, and fights until one of them is won.
    if (current.hero.level < 3) awardXp(current.hero, 300, current.rng.loot);
    let playing = null;
    for (let tries = 0; tries < 20; tries += 1) {
      current.hero.xp = Math.max(current.hero.xp, (xpNeeded(current.hero) ?? 0) - 5);
      current.hero.hp = current.hero.maxHp;
      current.hero.alive = true;
      playing = startFight(current.masterSeed + tries);
      for (let guard = 0; guard < 200 && !playing.over; guard += 1) playing.act('attack');
      if (playing.outcome === 'victory') break;
    }
    router.go(screen, screen === 'levelUp' ? { levels: playing?.summary?.levels ?? [] } : {});
  },

  showHero(screen) {
    const current = game().run ?? startRun();
    if (current.hero.level < 5 && current.hero.attributes) {
      awardXp(current.hero, 2400, current.rng.loot);
      for (const id of ['weapon_training', 'toughness', 'toughness', 'brute_force', 'mend', 'keen_senses']) {
        learn(current.hero, id);
      }
    }
    router.go(screen);
  },
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
