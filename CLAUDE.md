# CLAUDE.md — Underkeep

Underkeep is a portrait, fullscreen, installable web game: a single-hero, classless, turn-based dungeon crawler in the style of 1979–1987 computer RPGs (Temple of Apshai, Wizardry, Rogue). It runs at a strict 9:18 ratio on phones.

The design is finished and lives in `docs/`. Your job is to implement it faithfully, phase by phase.

## Where the truth lives

Read the relevant document **before** writing code for a system. Don't invent rules.

| Topic | Source |
| --- | --- |
| Build plan, tech stack, screen layouts, design tokens | `docs/00-build-outline.md` |
| Attributes, derived stats, skills, conditions, leveling | `docs/rules/01-core-rules.md` |
| Monsters, bosses, elites, encounter tables, loot roll | `docs/rules/02-bestiary.md` |
| Search, traps, locks, doors, chests, hazards | `docs/rules/03-traps-locks-treasure.md` |
| Items, identification, curses, shops, Alchemist | `docs/rules/04-item-database.md` |
| Floor generation, solvability, waystones, saving | `docs/rules/05-dungeon-generation-saving.md` |
| Turn order, damage order, event hooks, monster AI | `docs/rules/06-combat-engine-ai.md` |
| Supplied floor generator and raycaster, and how to use them | `docs/07-engine-modules.md` |
| Rulings made after the documents were written | `docs/DECISIONS.md` |
| What to build next | `docs/TASKS.md` |
| Visual reference for every screen | `docs/design/mockups/` (open `index.html`) |

**When documents disagree:**
1. `docs/DECISIONS.md` wins over everything.
2. For how the supplied modules are used, `07-engine-modules.md` wins over `05` section 3.
3. For timing and order of operations, `06-combat-engine-ai.md` wins.
4. For item stats, `04-item-database.md` wins.
5. Otherwise, the more specific document wins.

**When something is missing or contradictory:** don't guess silently. Pick the simplest option consistent with the documents, implement it behind a clearly named constant, and add an entry to `docs/DECISIONS.md` under "Open questions" so Harry can confirm it.

## Tech stack

- Plain JavaScript (ES modules), no framework. JSDoc types where helpful.
- Menus: DOM + CSS grid. Dungeon view: the supplied `src/dungeon/raycaster.js`.
- **Vendored modules:** `src/dungeon/dungeon-generator.js` and `src/dungeon/raycaster.js` are working code from an earlier project. Don't rewrite or restructure them. Build `floor-builder.js` and `view.js` around them, as `docs/07-engine-modules.md` describes. If one truly must change, record the change and the reason in `docs/DECISIONS.md`.
- Build: esbuild, then inline JS, CSS, and fonts into a **single `dist/index.html`**.
- Tests: Vitest (Node environment for rules; `fake-indexeddb` for save tests).
- Storage: IndexedDB for saves, localStorage for settings.
- Offline: service worker + web app manifest.
- No runtime dependencies unless Harry approves one.

## Architecture rules

- **`src/engine/`, `src/dungeon/` (except the raycaster), `src/systems/`, `src/save/` must never touch the DOM.** They take state in and return state or events out. This keeps rules testable and lets `tools/sim.js` reuse them.
- **All game numbers come from `src/data/*.json`**, built from the rule documents. No magic numbers in logic. If a rule document has a table, it becomes data.
- **Randomness:** only through the seeded RNG streams (`layout`, `encounter`, `combat`, `loot`, `restock`) defined in `05-dungeon-generation-saving.md`. Never call `Math.random()` in game code. The supplied generator calls it internally, so wrap it with `withRng()` (see `07`) instead of forking the file.
- **Resolve first, render second:** each action is fully resolved and saved before anything animates.
- **Event hooks:** skills, traits, conditions, and item effects register hooks on the events listed in `06-combat-engine-ai.md` section 16. No special-case code paths for individual skills.
- **Saving:** follow section 11 of `05-dungeon-generation-saving.md` exactly (commit random outcomes before showing them; atomic writes with checksum and backup; versioned migrations).

## UI rules (non-negotiable)

- The app is one `#app` frame in one of two shapes: **tall** 9 × 18 (portrait) or **wide** 18 × 9 (landscape and tablets). `--u` is the largest unit that fits, capped at 72 px. Use the shell CSS from the build outline verbatim.
- **Screens declare regions once**, with a `tall` placement and, only where the default fold doesn't work, a `wide` placement: `region('log', { tall: [1,9,11,12], wide: [4,15,8,9] })`. Wide layouts come from four shared patterns — fold, stage + controls, list + detail, panel — and the build outline says which pattern each of the 26 screens uses. Never write a second copy of a screen for landscape.
- Rotation re-renders the current screen from the same state. Nothing about game state, turn order, or the log may change when the frame changes.
- **The page never scrolls or zooms.** Only elements with the `.scroll` class scroll.
- Every screen is a 9-column × 18-row CSS grid. Place regions exactly as the screen tables in the build outline specify.
- **Tap targets span at least 2 grid rows.**
- Size fonts, borders, and radii in multiples of `--u`, never fixed px.
- Use only the design tokens from the build outline. Fonts: Bungee (labels, titles, numbers) and Atkinson Hyperlegible (body).
- One primary (amber) button per screen at most. Disabled buttons always show why.
- Real `<button>` elements with text or `aria-label`. Color is never the only signal.
- The mockups are fixed-size references (390 × 780 tall, 1008 × 504 wide); production code uses `--u`.

## Workflow

1. Work in the phase order from `docs/TASKS.md`. Don't start a phase until the previous phase's "done when" is met.
2. For each task: read the source section → write or update data → write tests from the document's worked numbers → implement → run tests.
3. Check off tasks in `docs/TASKS.md` as they're finished.
4. Keep commits small, one task each, with a message naming the task.
5. At the end of each phase, summarize what was built, what was assumed, and what Harry should test on a phone.

## Commands

These are set up in Phase 1:

```
npm run dev        # local dev server with live reload (serve over LAN for phone testing)
npm run build      # data check + bundle + inline into dist/index.html
npm test           # rule tests
npm run data       # rebuild and validate src/data/*.json
npm run check      # open every screen at six device sizes and check the shell rules
npm run shots      # screenshot every screen in both frames into dist/shots/
npm run sweep      # build 10,000 seeds x 10 floors and check every one (~5 min)
npm run walk       # walk every floor of N seeds from arrival to the boss arena
npm run climb      # play heroes from level 1 to level 5 on floors 1-2
npm run fight      # play fights to the end and check the log against the rules
npm run loot       # roll, carry and use a game's worth of items; audit against 04
npm run loop       # play whole games: descend, fight, return, shop, descend again
npm run view-check # render the dungeon view in a browser and check what came out
npm run sim        # balance simulator (Phase 7+)
```

`check` and `shots` need the built page (`npm run build` first) and headless Chrome;
set `CHROME` if it isn't at the usual macOS path. Add each new screen's router id to
the `SCREENS` list in `tools/check-frames.js` and `tools/shots.js` as it's built.

One-off setup, already run and committed: `npm run fonts` (downloads Bungee and
Atkinson Hyperlegible into `assets/fonts/`) and `npm run icons` (draws the app icons).

## Style

- Small modules, named exports, pure functions where possible.
- Names match the documents' terms (Focus/FP, Path, Tier, Telegraph, Waystone, Return Mark, etc.).
- Player-facing text lives in `src/data/strings.json`, written in plain, short sentences.
- Comments explain *why*, and cite the document section for rules (for example, `// 06 §7 step 9: DR once per hit`).
