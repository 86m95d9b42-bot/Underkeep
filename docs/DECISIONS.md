# Underkeep — Decisions and Open Questions

Rulings here override the other documents. Add new entries at the top of each list, with a date.

## Decisions

- **2026-09-18 — The vendored generator's module wrapper had to change.** `07` allows a vendored module to change if it genuinely must, with the reason recorded. This is that case: `src/dungeon/dungeon-generator.js` could not be loaded **at all**.

  Its UMD wrapper picks between `module.exports` and a global. `package.json` sets `"type": "module"`, so the file is an ES module everywhere it is used — Node, esbuild and Vite alike — and **both** branches fail there: top-level `this` is `undefined`, `self` does not exist in Node, and under Vite `module` is a read-only namespace object whose `default` cannot be assigned. Every load threw before the factory ran.

  The wrapper is reduced to calling the factory, and ES module exports are appended. **The factory itself is untouched.** Verified byte-identical against the pristine file from git: 180 generations (3 grid sizes x 60 seeds) plus all four exported helpers and the TILE enum produce identical output for the same sequence of `Math.random` draws.

  The alternatives were worse: a `src/dungeon/package.json` marking the directory CommonJS would force every new file there to be `.mjs`, against the filenames `07` itself specifies; and loading the file through a global side effect broke under bundling, where evaluation order is not guaranteed.

  **`src/dungeon/raycaster.js` has the same wrapper and will need the same change** when `view.js` is built. It is left alone until then, so the change can be verified against something that renders.

- **2026-09-18 — floors.json scope and two superseded numbers.** `floors.json` holds the floor table from `05` section 2 plus the per-floor counts from section 3 (steps 6-9), because the next Phase 2 tasks consume exactly those and CLAUDE.md forbids magic numbers in logic. Restocking (`05` section 8) is left out; Phase 6 owns it. Two numbers are kept for the record but cannot currently be honoured, because the vendored generator replaced `05` section 3 steps 1-4:
  - **Floor 3's twistier corridors** (80% newest cell in the growing-tree carve). The vendored generator takes only `roomDensity`, with no maze-bias knob, so floor 3 is stored as `corridorStyle: "twisty"` and gets its identity from goblin camps instead.
  - **The 70% room-to-corridor door rate and the 8% extra-connector rate.** The generator places its own doors and loops.

  **Room counts reach the generator as a density.** The documents give room counts; the module takes `roomDensity` and derives `maxRooms = floor(w * h * 0.08 * density)`. `roomDensityFor()` inverts that from the top of each floor's range, adding half a room first so the generator's own `floor()` cannot land a room short. It is a cap on attempts, not a promise, so the builder still has to check the range.

- **2026-09-18 — Seeded RNG details.** Two choices in `src/engine/rng.js` that affect what replays:
  - **A cancelled advantage still draws two dice.** `06` section 6 step 5 says one advantage and one disadvantage cancel. The stream draws both dice either way and keeps the first, so a roll costs the same two draws however the caller reached the cancellation, and a replay of the same fight stays in step.
  - **Regenerating a floor uses an attempt number, not literally `seed + 1`.** `05` section 3 says a floor failing the solvability check is regenerated with `seed + 1`. `layoutStream(masterSeed, floor, attempt)` mixes the attempt into the seed instead, which is deterministic in the same way and cannot collide with a neighbouring floor's stream.

- **2026-09-18 — Phase 1 shell choices.** Six small rulings the documents did not settle, each behind a named constant:
  - **Text size setting.** `--text-scale` multiplies body and hint text only; Bungee labels and titles are sized to their boxes and do not scale. S is 1.00 and gives the documented minimums on a 390 px frame (hint 12 px, body 14 px, button 18 px); M is 1.08 (the mockups) and L is 1.20. In `src/styles/tokens.css`.
  - **The 2-row tap target rule** applies to regions placed on the screen grid. Controls inside a `.scroll` panel follow the mockups instead, which use 52 px rows; a 14-row settings list cannot hold nine labelled 2-row controls. Checked by `npm run check`.
  - **EXPORT / IMPORT in the wide Settings screen** take rows 8–9, not the outline's row 9 alone, so they keep the 2-row minimum.
  - **The release is `dist/index.html` plus four files.** JS, CSS, and fonts are inlined into the one page as the outline says; `sw.js`, `manifest.webmanifest`, and the icons stay separate because an installable app needs real URLs for them.
  - **Screens a later phase will add** disable their button with the reason "Not built yet" rather than going missing, so the layout never shifts as phases land. `router.has(id)` reports what exists.
  - **The URL fragment may name a screen** (`#settings`), which is how `npm run check` and `npm run shots` open each one. Unknown fragments start at the Title screen.

- **2026-09-18 — Supplied engine modules.** `src/dungeon/dungeon-generator.js` and `src/dungeon/raycaster.js` from Depths of Dreadmoor are the floor generator and renderer. They're vendored unchanged; Underkeep wraps them (`docs/07-engine-modules.md`). This replaces the growing-tree carving described in `05` section 3 steps 1–4.
- **2026-09-18 — Tiles hold terrain only.** Locks, traps, chests, hazards, keys, and the waystone live in side tables keyed "x,y", not in the tile grid. ILLUSION tiles are secret doors; PIT tiles are discovered pit traps.
- **2026-09-18 — No sprites in the 3D view.** The raycaster draws walls only, so monsters, chests, and waystones appear in UI panels and on the automap. A billboard layer would be a later decision.

- **2026-09-17 — Landscape and tablets.** The game supports both orientations from one source. Frames: tall 9 × 18 and wide 18 × 9, chosen by aspect ratio (wide at 1.2 or higher), with `--u` capped at 72 px. Screens fold automatically (rows 1–9 left, rows 10–18 right) unless the build outline gives a wide placement. This replaces the earlier "Turn your phone upright" card, which is gone.

- **2026-09-16 — Temple prices.** Cure ailments 10 gp × hero level; restore one Drained stack 100 gp × level; remove curse 50 gp × the floor the item was found on (destroys the item); respec 100 gp × level.
- **2026-09-16 — Inn and Sage** use the Temple's screen layout. Inn: full rest for 5 gp × level. Sage: identify for 20 gp per item.
- **2026-09-16 — XP formula.** Monsters give HD × 10 XP (×1.5 with a dangerous trait); bosses give roughly one level's worth, as listed in the Bestiary. This replaced an earlier HD² × 10 formula.
- **2026-09-16 — Low-level monster damage.** Regular monsters deal 1d6 + ⌊HD ÷ 2⌋ (1d4 at HD 1).
- **2026-09-16 — Condition durations** count down at the end of the affected unit's own turn, not at the end of the round (exceptions in `06` section 10).
- **2026-09-16 — Summon XP.** Only the first 4 summoned monsters killed in a fight give XP.
- **2026-09-16 — Level-up timing.** Leveling happens immediately after combat, not at the Inn.
- **2026-09-16 — Solo hero protections** (control immunity, Grit, no crits on a helpless hero, 2 free attacks on a failed flee, 5-enemy cap) apply to every fight.
- **2026-09-16 — Mockup sample data.** Names, numbers, and items shown in the screen mockups (for example, the hero "Harrow") are illustrative only. The real values always come from game state.
- **2026-09-16 — Reaction mockup** shows a Shadow/Arcana hero's options (Lucky, Arcane Shield). The real prompt lists only reactions the hero owns.

## Open questions

- **Tap targets inside scrolling lists.** The build outline's own Settings mockup uses 52 px segmented controls, which is under the 2-row minimum (about 80 px). Phase 1 reads the minimum as applying to grid-placed regions only. Confirm, or raise the in-list controls and accept more scrolling.
- **Letterbox.** Space left over in either frame is plain black bars. Keep that, or fill the bars with a subtle dungeon pattern? (Default: plain black.)
- **Tablet in portrait.** Currently the phone layout scaled up, capped at 72 px units. Worth a wider two-pane portrait layout later, or leave it? (Default: leave it.)
- **Art style.** The raycaster starts with its flat shaded fallback (no textures). Wall textures are plain ImageData when someone makes them. Monster and portrait art are still placeholders. Pixel art, line art, or text-only cards? (Default: bold line-art walls; enemy cards are text with HP bars.)
- **Sound.** No sound design is specified yet. (Default: short synthesized effects via Web Audio; no music until decided.)
- **Story.** The reason for descending, town characters, and the ending text aren't written yet. (Default: a short intro card and an ending card with placeholder text.)
- **Onboarding text.** The floor 1 tips need wording. (Default: one short sentence per first-time event.)
- **Game title.** "Underkeep" is a working title.
