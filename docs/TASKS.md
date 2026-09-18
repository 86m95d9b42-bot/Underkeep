# Underkeep — Task List

Work top to bottom. Check a box when the task is done and tested. Each phase ends with a "done when" test on a real phone.

## Phase 1 — Shell

- [x] Project setup: `package.json` (esbuild, vitest, fake-indexeddb as dev dependencies), `.gitignore`, npm scripts from `CLAUDE.md`
- [x] Build script: bundle `src/main.js`, inline JS, CSS, and fonts into `dist/index.html`
- [x] Dev server reachable from a phone on the same Wi-Fi
- [x] `index.html` with the viewport tag and `#app`
- [x] Shell CSS: tall 9:18 frame and wide 18:9 frame, `--u` with a 72 px cap, no page scroll, `.scroll` class
- [x] Layout engine: regions with `tall` placements plus the four wide patterns (fold, stage + controls, list + detail, panel); each screen names its pattern
- [x] Frame switching on resize and rotation, re-rendering the current screen without touching state
- [x] Design tokens as CSS custom properties; self-hosted Bungee and Atkinson Hyperlegible
- [x] UI parts: `button` (primary, secondary, risky, disabled + reason), `topBar`, `bar` (HP/FP/XP), `chip`, `listRow`, `scrollPanel`, `sheet`, `segmented`
- [x] Router: one screen at a time, sheets over a dimmed screen, back button and back gesture
- [x] Title screen and Settings screen (settings saved to localStorage)
- [x] Manifest (fullscreen, portrait, icons) and service worker (offline)
- [ ] **Done when:** installs on iOS and Android, opens fullscreen in both orientations, rotates without losing state, and nothing scrolls or zooms outside `.scroll` panels

## Phase 2 — Walk

- [x] Seeded RNG (sfc32) with named streams and serializable state
- [x] `floors.json` from `05` section 2
- [x] `withRng()` wrapper so the supplied generator draws from the seeded layout stream (`07` section 2)
- [x] `floor-builder.js`: call `DungeonGenerator.generate`, then stamp the boss arena, Safe Room, stairs, and waystone (`07` section 3, steps 1–2)
- [x] Distances and room roles: critical path, depth score, lairs, treasure rooms, curiosity rooms, secret stash (`07` steps 3–4)
- [x] Door types and lock tiers; keep or clear the generator's ILLUSION tiles as secret doors (`07` steps 5–6)
- [ ] Side tables per floor: `doors`, `traps`, `chests`, `hazards`, `keys`, `lairs` (`07` section 1)
- [ ] Solvability checker (`05` section 4) and regenerate-on-fail with `seed + 1`
- [ ] Generator sweep test: 10,000 seeds × 10 floors all pass and hit the pacing targets
- [ ] `view.js`: wire the supplied raycaster — FOV and aspect per frame, fog distance from the light source, door offsets, capped canvas resolution (`07` section 4)
- [ ] Grid movement with a 140 ms tween between tiles (display only; state changes in one step)
- [ ] Step clock and wandering monster check (log only for now)
- [ ] Exploration screen with movement pad, context key, log, and swipe controls (wide layout: pad left, side buttons right, view centered)
- [ ] Automap screen with explored-tile memory
- [ ] **Done when:** every floor from a seed can be walked from arrival to the boss arena

## Phase 3 — Fight

- [ ] `conditions.json`; condition engine with per-turn durations, stacking, control immunity, Grit (`01`, `06` section 10)
- [ ] Event hook system (`06` section 16)
- [ ] Round order and initiative bands (`06` section 3)
- [ ] Hero turn and monster turn sequences (`06` sections 4–5)
- [ ] Attack resolution (`06` section 6) with tests for every step
- [ ] Damage order of operations (`06` section 7) with tests for crits, resistances, DR, and minimums
- [ ] Zero HP, morale, fleeing, combat end (`06` sections 9, 14, 15)
- [ ] AI script runner and archetypes (`06` section 11)
- [ ] `monsters.json` for floors 1–2 and `encounters.json` for floors 1–2
- [ ] Combat screen and Combat: Skills sheet (wide layout: enemies and log left, actions right; sheets become a right-hand panel)
- [ ] **Done when:** a fight against rats and kobolds runs start to finish with the log matching the rules

## Phase 4 — Hero

- [ ] `attributes.json`, `origins.json`
- [ ] Character creation: Classic and Standard rolls, origins, name — New Game, Create: Attributes, Create: Origin screens
- [ ] Derived stats (`01` section 4) with tests
- [ ] `skills.json` for all four Paths and Crossroads, with hook effects
- [ ] Skill learning rules (tier gates, attribute requirements, ranks)
- [ ] XP curve, level-up gains, attribute points at 4/8/12/16/20
- [ ] Hero: Stats and Hero: Skill Tree screens
- [ ] Victory & Loot (XP and gold only for now) and Level Up screens
- [ ] **Done when:** a new level 1 hero can reach level 5 on floors 1–2

## Phase 5 — Loot

- [ ] `items.json` (all sections of `04`) and `loot.json`
- [ ] Inventory rules: slots, stacking, equipment slots, quick slots
- [ ] Loot generation (`04` section 14) including properties, curses, and identification state
- [ ] Per-game potion looks and scroll titles; identification methods
- [ ] Cursed item binding and effects
- [ ] Item effects through hooks (weapon properties, armor properties, charms, potions, scrolls, bombs)
- [ ] Hero: Pack screen and Item Detail sheet; drops on Victory & Loot
- [ ] **Done when:** unknown potions, scrolls, and cursed gear behave exactly as `04` describes

## Phase 6 — Town

- [ ] Town Hub screen and trip/day counters
- [ ] `shops.json`; Shop screen with tiers, rotating stock, buy, sell, repair
- [ ] Inn, Temple (prices in `DECISIONS.md`), and Sage using the shared service layout
- [ ] Alchemist (unlocks after the floor 2 boss)
- [ ] Stash (50 slots)
- [ ] Waystones: attune, Dungeon Gate travel, return to town from a Waystone
- [ ] Scroll of Return and the Return Mark
- [ ] Restocking on each return (`05` section 8)
- [ ] **Done when:** the full loop works: descend, fight, return, shop, descend again

## Phase 7 — Depth

- [ ] `traps.json`; detection, disarm, pole, trigger, salvage (`03` sections 3–5)
- [ ] Doors and locks, including keyed, sealed, barred, one-way, secret (`03` section 6, `05` section 3 step 7)
- [ ] Chest generation and the chest sequence; Chest / Door screen (`03` section 7)
- [ ] Hazards and theme features (`03` section 8, `05` sections 3 and 6)
- [ ] Remaining monsters, floors 3–10, and all encounter tables
- [ ] `bosses.json` and all ten boss fights, including arena objects and state machines
- [ ] Elite traits, rare wanderers, Hollow Stalker
- [ ] Graves (Adventurer mode)
- [ ] Balance simulator (`tools/sim.js`) with the four example builds
- [ ] **Done when:** every boss is beatable by each example build at least 60% of the time in the simulator

## Phase 8 — Polish

- [ ] Saving hardened: commit-before-show, atomic write, checksum, backup recovery, migrations (`05` section 11)
- [ ] Mid-combat resume with the last three log lines
- [ ] Ironman mode and the Death screen (both modes)
- [ ] Hall of the Dead and scoring (`05` section 12)
- [ ] Reaction prompt sheet and setting
- [ ] Auto-Fight
- [ ] Haptics and sound
- [ ] Floor 1 onboarding tips (one system per room)
- [ ] Tablet pass: open all 26 screens in the wide frame and confirm each matches its pattern in the build outline
- [ ] Export and import saves
- [ ] Launch checklist in the build outline
- [ ] **Done when:** a full playthrough survives repeated force-closes with no lost progress
