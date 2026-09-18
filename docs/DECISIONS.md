# Underkeep — Decisions and Open Questions

Rulings here override the other documents. Add new entries at the top of each list, with a date.

## Decisions

- **2026-09-18 — The solvability check, and repairing rather than rebuilding.** `05` section 4 is implemented as written: a pessimistic flood fill with keys, then a second one run backwards for the "get back from anywhere" rule. Three readings, and one change of approach:
  - **A teleporter pad is impassable to the checker.** `05` says the minimum hero "can't rely on teleporters". Stepping on a pad moves the hero somewhere fixed, so a pad in a one-tile corridor genuinely severs it. Rather than loosen the checker, pads are now kept off the critical path and off any tile whose loss would cut the floor in two.
  - **Deep water is passable.** `05` lets the minimum hero cross "short deep water"; the hazard is a save against damage, not a wall, so the checker treats every pool as crossable.
  - **A one-directional door that strands the hero is opened up, not regenerated.** Barred and one-way doors go on loops so there is always a way round, but the way round can be shut afterwards by a second one on the same loop, by a secret door, or by a teleporter pad landing in it. `repairOneWayDoors` runs on the *finished* floor, using the checker's own passability, and demotes the door nearest the trouble to a plain archway.

  The order matters, and getting it wrong is what made this worth writing down. Repairing before the hazards were placed left 3.5% of first attempts unsolvable, because the repair could not see a pad that had not been placed yet. Running it last, with the same rules the checker uses, brought first-attempt failures from **17% to 1.3%**; what remains is rebuilt with the next attempt, as `05` section 3 step 10 allows.

- **2026-09-18 — Side tables, and a count the documents never give.** Traps, chests, hazards, lairs and curiosities are now side tables keyed "x,y", finishing the list in `07` section 1. Three things needed deciding:
  - **How many hazards a floor gets.** `05` section 3 step 8 and `03` section 8 give every hazard's placement rules and effects but never a count. `hazardCount` in `floors.json` is 1 + ⌊F ÷ 2⌋, spread across the kinds the floor allows, which runs from one hazard on floor 2 to six on floor 10.
  - **The 10% darkness cap is on the floor, not on one patch.** `05` says a Dark Zone may cover "up to 10% of floor tiles". Read per patch it produced a single 125-tile blackout on floor 9. It is now a running total, with each patch 6 to 20 tiles; measured over 200 floors the worst floor is 5.4% dark.
  - **What each thing does is left to its own phase.** A trap entry carries its position, whether an Arcane kind is allowed there, and its found/disarmed/sprung state, but `kind` is null until `traps.json` arrives in Phase 7. A lair carries its room and `encounter: null` until the encounter tables arrive in Phase 3. Chests carry a lock, a tier and the depth bonus, but no contents until Phase 5.

  One chest to a room, so a lair cannot end up holding three.

- **2026-09-18 — Doors, locks and secret doors.** Four readings the documents left open, plus a new data file:
  - **`src/data/locks.json`** holds `03` section 6: the tier TN table, the d10 + F lock-tier bands, the door kinds and the secret-door numbers. The build outline's data pipeline names `traps.json` for `03` sections 3–5; the lock half needed a home before Phase 7, and the tier TN table is shared by both.
  - **The Good cap applies to locked doors, not keyed ones.** `05` section 3 step 7 states "capped at Good locks" on the **Stuck / Locked** row only, and gives its reason as "so bashing always remains possible". A Keyed door is its own row, and `03` section 6 sets its pick difficulty at Masterwork TN + 2 deliberately; its guarantee is that the key is reachable first, which the builder enforces by sealing every keyed door before choosing where the keys go.
  - **The Stuck / Locked share is split about one third stuck.** The documents give one combined share (25% + 2% x F) and never split it. `stuckShare` in `locks.json` is 0.34.
  - **The Secret Stash is sealed by turning the corridor tile into the dead end into a secret door**, with the dead end itself as the chamber. Digging a fresh chamber beyond the dead end was the first attempt; it needs a walled-in tile on the far side, which three floors in four do not have, and 313 of 400 floors lost their stash. The corridor tile is used only when it has exactly two open sides, so sealing it cuts off the stash and nothing else.

  A consequence worth knowing: **a finished floor is no longer fully connected.** The stash is meant to be unreachable until its secret door is found, so connectivity is now checked with secret doors counted as passable.

- **2026-09-18 — Room roles are assigned most-constrained first.** `05` section 3 step 6 gives each role a count but no order, and every floor wants more rooms than it reliably has: floor 10 asks for up to 14 roles across 12–15 rooms. The order is therefore:
  1. **Treasure, all of it at once.** It is the only role the document ties to depth ("the deepest rooms **off** the critical path"), so anything placed before it could take a deeper room. Placing it in two passes was the first implementation, and a lair did exactly that.
  2. **One each of curiosity and theme**, so a cramped floor still has one of everything.
  3. **Every lair**, since lairs carry the floor's fixed encounters.
  4. **The extras** of curiosity and theme, only while rooms remain.

  Measured over 300 floors (30 seeds x 10 floors): lairs are never short of the documented count, and 11% of floors end with no plain rooms at all, which the table permits ("Plain | The rest").

  **Depth is measured from the arrival tile, not an arrival room.** `07` step 3 says to flood-fill from the arrival tile, and arrival is a dead end here rather than a room, so there is usually no room to call the arrival room. **The arena is listed as a room** with role `bossArena`, as the save template in `05` section 14 has it, even though the generator never placed it. **The Secret Stash is chosen as a dead end here**; the secret door that seals it is placed with the other doors in the next step.

- **2026-09-18 — Stamping the boss arena over a finished floor.** `07` section 3 step 1 says to carve the arena "into the largest clear region". No generated floor has one: the maze fills the grid, and the emptiest 11 × 11 block still holds about 50 walkable tiles. So the arena is stamped over the map at the site that destroys fewest walkable tiles (ties break outward from the middle, deterministically), and the floor is then repaired by digging the shortest run of wall back to anything the stamp cut off.

  Two rules of `05` section 5 needed protecting explicitly, and both were wrong in the first working version:
  - **The alcove is sealed on its outward side.** Otherwise the down stairs sit in a through-passage and can be reached without entering the arena.
  - **The arena's wall ring is off limits to the repair pass**, which would otherwise dig a second way in and break the one-entrance rule.

  A floor that cannot be finished throws `RegenerateFloor` and is rebuilt with the next attempt number, up to 8, as `05` section 3 step 10 allows.

  **Arrival is the farthest dead end by walking distance.** `07` step 2 names `pickDeadEndNear` / `findNearestFloor`, and `05` section 3 step 5 wants the point farthest from the arena. Both are honoured: `findDeadEnds` supplies the candidates, and walking distance picks between them, falling back to `findNearestFloor` from the opposite corner when no dead end is usable.

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

- **Floors 1–3 cannot reach the critical-path pacing target.** `05` section 2 asks for 150–300 steps from arrival to the boss, and defines the critical path as the *shortest* walking route (section 3 step 5). On a 33 × 33 grid that is not reachable: measured over 40 seeds, floor 1 runs 58–190 steps (median 112) and floor 3 runs 64–156 (median 110), with only 1–5 seeds in 40 landing in range. This is the grid, not the placement — the arrival point chosen averages 116 steps against a theoretical ceiling of 121, within 4% of the farthest tile that exists. Floors 4–7 land in range about 60% of the time; floors 8–10 about 85%. Options: accept that early floors are shorter (a quick floor 1 reads as intentional), enlarge floors 1–3, or read the target as including exploration rather than the beeline. This blocks the Phase 2 sweep test, which asks every floor to hit the pacing targets. (Default: accept shorter early floors and relax the target for 33 × 33 grids.)
- **Tap targets inside scrolling lists.** The build outline's own Settings mockup uses 52 px segmented controls, which is under the 2-row minimum (about 80 px). Phase 1 reads the minimum as applying to grid-placed regions only. Confirm, or raise the in-list controls and accept more scrolling.
- **Letterbox.** Space left over in either frame is plain black bars. Keep that, or fill the bars with a subtle dungeon pattern? (Default: plain black.)
- **Tablet in portrait.** Currently the phone layout scaled up, capped at 72 px units. Worth a wider two-pane portrait layout later, or leave it? (Default: leave it.)
- **Art style.** The raycaster starts with its flat shaded fallback (no textures). Wall textures are plain ImageData when someone makes them. Monster and portrait art are still placeholders. Pixel art, line art, or text-only cards? (Default: bold line-art walls; enemy cards are text with HP bars.)
- **Sound.** No sound design is specified yet. (Default: short synthesized effects via Web Audio; no music until decided.)
- **Story.** The reason for descending, town characters, and the ending text aren't written yet. (Default: a short intro card and an ending card with placeholder text.)
- **Onboarding text.** The floor 1 tips need wording. (Default: one short sentence per first-time event.)
- **Game title.** "Underkeep" is a working title.
