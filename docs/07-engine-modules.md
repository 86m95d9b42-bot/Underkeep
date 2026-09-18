# Underkeep — Supplied Engine Modules

Two working modules from *Depths of Dreadmoor* ship with this project and are the game's floor generator and 3D renderer:

- `src/dungeon/dungeon-generator.js` — rooms from templates, a carved maze, doors, illusionary walls, pits, and a connectivity pass. Exports `generate`, `findDeadEnds`, `findNearestFloor`, `pickDeadEndNear`, `deadEndFacing`, `TILE`.
- `src/dungeon/raycaster.js` — DDA raycaster that draws one frame into a canvas. Exports `create(canvas, options)` → `{ resize, render, width, height, canvas }`, and `TILE`.

**Treat both as vendored code.** Don't rewrite or restructure them. Everything Underkeep needs on top goes in new files that call them: `src/dungeon/floor-builder.js` and `src/dungeon/view.js`. If one of them genuinely must change, note the change and why in `docs/DECISIONS.md`.

They already share a tile enum, so they drop in together:

```
FLOOR 0   WALL 1   STAIRS_DOWN 2   STAIRS_UP 3   DOOR 4   ILLUSION 5   PIT 6
```

---

## 1. Tiles: what each value means in Underkeep

The map holds **terrain only**. Everything else — lock state, traps, chests, the waystone, hazards, keys — lives in side tables keyed `"x,y"`, the same shape the raycaster already uses for `doorStates`. That keeps the generator's output untouched and keeps saves small (`05` section 14 already stores floors this way).

| Tile | Underkeep meaning |
| --- | --- |
| `FLOOR` | Walkable floor |
| `WALL` | Solid wall |
| `STAIRS_DOWN` / `STAIRS_UP` | Placed by the floor builder, not the generator (see below) |
| `DOOR` | A door. Its type (open, stuck, locked, keyed, sealed, barred, one-way) and lock tier live in `doors["x,y"]` |
| `ILLUSION` | **Secret door.** It renders as wall until found, then behaves as floor — exactly the behavior `03` describes. Keen Senses and Dust of Revealing flip `secrets["x,y"].found` |
| `PIT` | A **pit trap** that has already been found, so the player can see it. Undiscovered traps are not tiles at all: they live in `traps["x,y"]` and only become visible on the automap and in the log |

Side tables per floor: `doors`, `traps`, `chests`, `hazards` (spinner, dark zone, deep water, teleporter, anti-magic, ice, web curtain), `keys`, `lairs`, `waystone`, `arena`, `grave`, `returnMark`.

---

## 2. Seeding the generator

The module calls `Math.random()` directly, and Underkeep needs floors to rebuild identically from a seed (`05` section 11). Wrap the call instead of forking the file:

```js
// src/dungeon/floor-builder.js
export function withRng(rng, fn) {
  const real = Math.random;
  Math.random = rng;              // rng() is the seeded layout stream
  try { return fn(); } finally { Math.random = real; }
}

const { map, rooms } = withRng(layoutStream, () =>
  DungeonGenerator.generate(size, size, { roomDensity })
);
```

Every later placement step (stairs, roles, doors, traps, chests, hazards) must also draw from the layout stream, so the whole floor is reproducible from `masterSeed + floorNumber`.

---

## 3. What the floor builder adds

`generate()` covers steps 1–4 of `05` section 3 (rooms, corridors, connections, doors) and guarantees every walkable tile is reachable, which is a large part of the solvability requirement. The floor builder runs after it and adds the rest, in this order:

1. **Stamp the boss arena.** Carve a 9 × 9 room (11 × 11 on floor 10) with one door into the largest clear region, plus the Safe Room in front of it. If there's no room for it, regenerate with `seed + 1`. Put the down stairs in an alcove behind the arena.
2. **Arrival room and waystone.** Use `pickDeadEndNear` / `findNearestFloor` to place the up stairs far from the arena, then the waystone on an adjacent tile. `deadEndFacing` gives the player's starting facing.
3. **Measure.** Flood-fill distances from the arrival tile: critical path to the arena, and a depth score per room for placing rewards and danger.
4. **Room roles** (`05` section 3 step 6): lairs, treasure rooms, curiosity rooms, theme rooms, secret stash.
5. **Door types.** Walk the `DOOR` tiles and assign types and lock tiers per `05` step 7, honoring the placement limits (critical-path locks capped at Good, sealed doors only in front of optional rooms, barred and one-way only on loops).
6. **Secret doors.** The generator already scatters `ILLUSION` tiles. Keep the ones that make sense (dead-end stashes, shortcuts), convert the rest to `WALL`, and add any missing ones to reach 2–4 per floor. **Never leave an `ILLUSION` on the critical path.**
7. **Traps, chests, hazards, curiosities** per `03` and `05` step 9. Pits the generator placed become found pit traps or are converted to hidden trap entries.
8. **Validate** with the solvability checker from `05` section 4: flood fill with keys, using the minimum hero's abilities. On failure, regenerate with `seed + 1`.

Dead ends are useful here rather than noise: `findDeadEnds` gives ready-made spots for chests, the secret stash, and the Hollow Stalker's approach. Don't prune them the way `05` step 3 suggests; that step described a different carving algorithm and this module's dead-end count is already reasonable.

---

## 4. Wiring the raycaster

```js
const rc = Raycaster.create(canvas, {
  fov: frame === 'wide' ? WIDE_FOV : TALL_FOV,
  aspect: frame === 'wide' ? 2 : 1.125,   // the view region's own aspect: 12×6 units wide, 9×8 tall
  fogDistance: light.fogDistance,          // torch 14, lantern 16, darkness 1.5
  flicker: light.source === 'torch',
});

rc.render({
  map: floor.map, mapW: floor.w, mapH: floor.h,
  x: view.x + 0.5, y: view.y + 0.5, angle: view.angle,
  doorStates: openDoorOffsets,             // "x,y" -> {offset: 0..0.5}
  fillColor: theme.fog,
  texturesEnabled: settings.textures,
  floorCeilingEnabled: settings.floorTextures,
});
```

**Field of view when the frame changes.** The renderer's vertical field of view is set by canvas height, so it stays fixed on its own. Keep wall height identical between frames by deriving the wide FOV from the tall one:

```
WIDE_FOV = 2 * atan( tan(TALL_FOV / 2) * (2 / 1.125) )
```

with `TALL_FOV = PI / 3`. Recreate the raycaster on a frame switch (it only allocates buffers and lookup tables) and call `resize()` with the view region's pixel box.

**Movement.** The game is turn-based on a grid, but the renderer takes continuous coordinates, so the shell tweens `x`, `y`, and `angle` between tile centers over about 140 ms with ease-in-out, and renders each frame from the tween. That tween is display only: the game state changes in one step, and the save is written before the animation starts.

**Performance.** Rendering is per-pixel in JavaScript, so cap the canvas at roughly 480 px on its long side and let CSS scale it up; the chunky look suits the art direction. Keep `floorCeilingEnabled` off by default and offer it as a Settings toggle.

**Art.** No textures exist yet, so the flat shaded fallback is the starting look: it needs no assets and reads clearly. When art arrives, textures are plain `ImageData` objects (`{width, height, data}`), one set per floor theme, passed in `render({ textures })`.

**Dark Zones** (`03`) set `fogDistance` to about 1.5 and `flicker` off; a Light scroll raises it to 2.5. The automap doesn't fill in there, per the rules.

---

## 5. Things the modules don't do

Build these in the floor builder or the view layer, not inside the vendored files:

- Seeded randomness (section 2 above)
- Boss arenas, Safe Rooms, stairs, waystones, room roles, key-and-lock placement, hazards, chests, traps
- The solvability checker
- Ice slides and web curtains (both are hazard entries, not tiles: ice changes how a step resolves, a web curtain blocks a tile until burned)
- Sprites for monsters or objects — the raycaster draws walls only, so chests, waystones, and enemies appear in the UI panels and on the automap, not in the 3D view. If a billboard sprite layer is wanted later, it's a new file drawing over the canvas, and it's a decision worth writing down first.
