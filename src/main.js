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
import { chest as chestScreen } from './ui/screens/chest.js';
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
import { death } from './ui/screens/death.js';
import { hall } from './ui/screens/hall.js';
import { isWalkable } from './dungeon/floor-builder.js';
import { createSession } from './systems/session.js';
import { standInHero } from './systems/fight.js';
import { chooseOrigin, createDraft, finish, setName } from './systems/creation.js';
import { awardXp, xpNeeded } from './systems/levelling.js';
import { learn } from './systems/skill-tree.js';
import { openStore, summaryOf } from './save/store.js';
import { createSaver } from './save/saver.js';
import { restoreSession, slotFor, takeSnapshot } from './save/snapshot.js';
import { serializeStreams } from './engine/rng.js';
import { t } from './data/strings.js';
import saving from './data/saving.json' with { type: 'json' };

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
 * Creation makes a session from the hero it rolled, and Continue picks one up
 * from its save. Opening a screen without either — the tools do, through the
 * URL fragment — rolls one from the demonstration seed, so every screen has a
 * real hero to draw. A demonstration game is never saved.
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

/* -- saving (`05` section 11) --------------------------------------------- */

/** The save slots, once IndexedDB has opened; null where there is none. */
let store = null;
/** The slot the game in progress writes to; null for a demonstration game. */
let slot = null;
/**
 * True for a real game — one creation began or Continue picked up — from the
 * moment it exists, before its slot has even been chosen. Only a
 * demonstration game lets drawing a screen start a trip or a fight.
 */
let realGame = false;
/** What the Title screen shows of the last game, read at launch. */
let lastSummary = null;
/** True while a random outcome is being written, before it may be shown. */
let holding = false;
/** The Hall of the Dead as last read, for the screen to draw (`05` section 12). */
let hallRecords = [];

/** Reads the Hall again after it has changed. */
async function refreshHall() {
  if (!store) return;
  hallRecords = await store.hall().catch(() => hallRecords);
}
/** When play time was last counted. It only runs while the game is in front. */
let lastTick = Date.now();

/** The session as a save, with the play time since the last one added. */
function snapshot() {
  const now = Date.now();
  if (document.visibilityState === 'visible') session.played((now - lastTick) / 1000);
  lastTick = now;
  return takeSnapshot(session, { screen: router?.current?.id ?? null });
}

const saver = createSaver({
  store: { write: (where, save) => store.write(where, save) },
  slot: () => (store && session ? slot : null),
  snapshot,
  // Any carried stream that moved means the action rolled something.
  luck: () => (session ? JSON.stringify(serializeStreams(session.rng)) : ''),
  onError: (error) => console.warn('underkeep: the game could not be saved', error),
});

/** Commits now, and never lets a failed write stop the game. */
function commit() {
  return saver.commit().catch(() => null);
}

/**
 * A new game's slot: the first free Adventurer slot, or an Ironman's own
 * (`05` section 11). Written the moment it is chosen.
 */
async function claimSlot(hero) {
  if (!store) return;
  slot = slotFor(hero, await store.list(), saving.slots.adventurer);
  await commit();
}

/** True while a fall is being written, so a second tap cannot fall twice. */
let falling = false;

async function fall({ cause = null } = {}) {
  if (falling) return;
  falling = true;
  try {
    const fell = game().heroFell({ cause });
    if (fell.mode === 'ironman') {
      // No write may land after the burial: the slot is let go first, so
      // nothing more is queued for it, and any write already running is
      // waited out before the save is deleted.
      const buried = slot;
      slot = null;
      lastSummary = null;
      await saver.commit().catch(() => null);
      if (store && buried) {
        await store.bury(buried, fell.record).catch((error) => console.warn('underkeep: the Ironman save could not be buried', error));
        await refreshHall();
      }
    } else {
      await commit();
    }
    // Replaced, not pushed: there is no going back into the fight that ended.
    router.replace('death', { record: fell.record, grave: fell.grave, mode: fell.mode });
  } finally {
    falling = false;
  }
}

/**
 * Continue (`05` section 13): the last slot, as it was left. A damaged main
 * save falls back on the backup, and the player is told so.
 */
async function continueGame() {
  if (!store) return;
  const last = await store.lastSlot();
  const { save, recovered } = last ? await store.read(last) : { save: null };
  if (!save) {
    lastSummary = null;
    router.render();
    return;
  }
  session = restoreSession(save, { go: (to, params) => router.go(to, params) });
  slot = last;
  realGame = true;
  lastTick = Date.now();
  const underground = Boolean(session.run);
  const notice = recovered ? t('save.recovered') : null;
  if (notice && underground) session.run.log.push({ text: notice, tone: 'danger' });
  // Mid-fight, the fight: its last three lines are already in its log
  // (`05` section 13).
  if (session.fight) {
    if (notice) session.fight.log.push({ round: session.fight.round, text: notice, tone: 'danger' });
    router.go('combat');
    return;
  }
  router.go(underground ? 'explore' : 'town', notice && !underground ? { notice } : {});
}

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
    slot = null;
    realGame = Boolean(newHero);
    if (newHero) claimSlot(newHero);
  }
  return session.run ?? session.descend({ floor: 1 });
}

/**
 * What the town-side screens read while the hero is in town: the hero, the
 * carried streams, and no floor. Asking for the run must never start a trip
 * (`05` section 12: a trip is counted by the Dungeon Gate, not by a screen).
 */
function townView() {
  const current = game();
  return { hero: current.hero, rng: current.rng, floor: null, log: [], masterSeed: current.masterSeed };
}

/** The session, made on the first ask. */
function game() {
  if (!session) startRun();
  return /** @type {ReturnType<typeof createSession>} */ (session);
}

/** Play time the way the Last Played card shows it: 45m, 3h 20m. */
function playedText(seconds) {
  const minutes = Math.floor((seconds ?? 0) / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

const save = {
  get hasGame() {
    return Boolean(slot || lastSummary);
  },
  /** The game in progress if it is a saved one, otherwise the last saved game. */
  get lastPlayed() {
    const live = slot && session ? summaryOf(takeSnapshot(session)) : lastSummary;
    if (!live) return null;
    return {
      name: live.name,
      level: live.level,
      floor: live.floor ?? 1,
      theme: live.place === 'town' ? t('town.title') : '',
      mode: live.mode === 'ironman' ? 'Ironman' : 'Adventurer',
      played: playedText(live.playTimeSec),
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
  chest: chestScreen,
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
  death,
  hall,
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
    const current = game();
    if (current.run) return current.run;
    // A saved game in town stays in town; only a demonstration game walks
    // straight down, so the tools always have a floor to draw.
    return realGame ? townView() : startRun();
  },
  startRun,
  continueGame,
  /** True while a random outcome is being written, before it may be shown. */
  get holding() {
    return holding;
  },
  /**
   * Resolves an action and saves it the way `05` section 11 says: a random
   * outcome is committed before the promise hands it back to be shown.
   */
  after(resolve) {
    holding = true;
    return saver.after(resolve).finally(() => {
      holding = false;
    });
  },
  /**
   * The fight in front of the hero. Every render reads this (the router
   * spreads the context), so in a saved game it only ever answers — a fight
   * is started by the encounter, never by drawing a screen. A demonstration
   * game still rolls one, so the tools can open the Combat screen.
   */
  get fight() {
    const current = game();
    return current.fight ?? (realGame ? null : startFight());
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
  /**
   * The hero fell (`01` section 12, `05` sections 9, 11 and 12). The fall is
   * resolved and written before the Death screen shows it: an Adventurer's
   * grave is saved with them waking in town; an Ironman's save is deleted
   * and their tombstone goes to the Hall in the same transaction.
   * @param {{ cause?: object }} [options]
   */
  fall,
  /** The Hall of the Dead, best first (`05` section 12). */
  get hall() {
    return hallRecords;
  },
  /**
   * A boss has fallen. Beating the last one finishes the game, and a finished
   * game goes to the Hall of the Dead, whichever the mode (`05` section 12).
   */
  async bossBeaten(floor) {
    const beaten = game().bossBeaten(floor);
    if (beaten.finished && store) {
      await store.addToHall(beaten.finished).catch((error) => console.warn('underkeep: the victory could not be recorded', error));
      await refreshHall();
    }
    await commit();
    return beaten;
  },
};

router = createRouter({ app, screens, frame: () => watcher.frame, ctx });

// Every screen change is a save point (`00`, Screen flow).
for (const name of ['go', 'replace', 'openSheet', 'closeSheet']) {
  const original = router[name];
  router[name] = (...args) => {
    const out = original(...args);
    commit();
    return out;
  };
}

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
   * A real, saved new game, as creation would start one: the save checks use
   * it to play, close the page, and pick the game back up.
   */
  newGame({ seed = DEMO_SEED, origin = 'sellsword', mode = 'adventurer' } = {}) {
    const hero = finish(setName(chooseOrigin(createDraft({ seed, rollMode: 'standard' }), origin), 'Harrow'));
    hero.mode = mode;
    startRun(hero);
    router.go('explore');
    return saver.flush();
  },
  /** The save layer, for the tools that check it. */
  saves: {
    get slot() {
      return slot;
    },
    get store() {
      return store;
    },
    commit,
    flush: () => saver.flush(),
    continueGame,
  },

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

  /**
   * The Chest screen wants a chest in front of the hero: this finds the
   * nearest unopened one on the floor and stands them at it.
   */
  showChest() {
    const current = game().run ?? startRun();
    const floor = current.floor;
    // A locked, trapped chest is the one worth looking at, so it comes first.
    const worth = (chest) => (chest.lock !== 'none' ? 2 : 0) + (chest.trap ? 1 : 0);
    const chests = Object.entries(floor.chests ?? {}).sort((a, b) => worth(b[1]) - worth(a[1]));
    for (const [at, chest] of chests) {
      if (chest.opened) continue;
      const [cx, cy] = at.split(',').map(Number);
      // North, south, east, west of the chest, facing it.
      for (const [ox, oy, facing] of [[0, 1, 0], [0, -1, 2], [1, 0, 3], [-1, 0, 1]]) {
        const [x, y] = [cx + ox, cy + oy];
        if (!isWalkable(floor.map?.[y]?.[x])) continue;
        current.ex.pos = [x, y];
        current.ex.facing = facing;
        if (current.chestAhead) {
          // One real Careful Search, so the card shows what a hero would know.
          current.chestAct('careful');
          router.go('chest');
          return at;
        }
      }
    }
    router.go('chest');
    return null;
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

/**
 * Opens the save slots and reads what the Title screen shows of the last game.
 * A browser with no IndexedDB still plays; it just cannot keep the game.
 */
async function openSaves() {
  try {
    store = await openStore();
    const last = await store.lastSlot();
    const { save } = last ? await store.read(last) : { save: null };
    lastSummary = save ? summaryOf(save) : null;
    await refreshHall();
  } catch (error) {
    store = null;
    console.warn('underkeep: saving is unavailable here', error);
  }
}

// The URL fragment may name a screen, which is how tools/shots.js opens each
// one for a frame check. Anything unknown just starts at the Title screen.
await openSaves();
router.go(screens[location.hash.slice(1)] ? location.hash.slice(1) : 'title');

// Any tap that changed the game — a purchase, an equip, a learned skill — is
// written straight away (`05` section 11). This listener runs after the
// button's own, and a write nobody needed costs one small record.
app.addEventListener('click', () => {
  if (slot) commit();
});

// Going to the background writes anything pending; coming back restarts the
// play-time clock.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (session && slot) session.played((Date.now() - lastTick) / 1000);
    lastTick = Date.now();
    saver.flush().catch(() => {});
  } else {
    lastTick = Date.now();
  }
});
window.addEventListener('pagehide', () => {
  saver.flush().catch(() => {});
});

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
