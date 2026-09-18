# Underkeep — Decisions and Open Questions

Rulings here override the other documents. Add new entries at the top of each list, with a date.

## Decisions

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

- **Letterbox.** Space left over in either frame is plain black bars. Keep that, or fill the bars with a subtle dungeon pattern? (Default: plain black.)
- **Tablet in portrait.** Currently the phone layout scaled up, capped at 72 px units. Worth a wider two-pane portrait layout later, or leave it? (Default: leave it.)
- **Art style.** The raycaster starts with its flat shaded fallback (no textures). Wall textures are plain ImageData when someone makes them. Monster and portrait art are still placeholders. Pixel art, line art, or text-only cards? (Default: bold line-art walls; enemy cards are text with HP bars.)
- **Sound.** No sound design is specified yet. (Default: short synthesized effects via Web Audio; no music until decided.)
- **Story.** The reason for descending, town characters, and the ending text aren't written yet. (Default: a short intro card and an ending card with placeholder text.)
- **Onboarding text.** The floor 1 tips need wording. (Default: one short sentence per first-time event.)
- **Game title.** "Underkeep" is a working title.
