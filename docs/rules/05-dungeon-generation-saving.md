# UNDERKEEP — Dungeon Generation, Waystones & Saving
*Companion to the Core Rule Set, Bestiary, Traps, Locks & Treasure, and Item Database. How floors are built and kept solvable, how the hero gets back to the depths quickly, and how the game saves so a phone call never costs progress.*

---

## 1. Structure of a Game

- A game has **10 dungeon floors** and a **town**.
- The town is a **menu hub**, not a walkable map: Inn, Shop, Temple, Sage, Alchemist, Stash, and the **Dungeon Gate**.
- Each game has one **master seed**. Every floor is generated from that seed, so the same seed always produces the same dungeon.
- **Floors are generated once and stay fixed for the whole game.** Mapping a floor is permanent progress, as in Wizardry. Only monsters, some traps, and some chests refresh (see *Restocking*).
- Players can type in a seed when starting a new game to share or replay a dungeon.

### Getting Between Floors

| From | To | How |
|---|---|---|
| Town | Floor 1 | Dungeon Gate → floor 1 arrival |
| Floor N | Floor N + 1 | Down stairs, which sit behind floor N's boss arena |
| Floor N | Floor N − 1 | Up stairs in floor N's arrival room lead to floor N − 1's down stairs |
| Floor 1 | Town | Up stairs |
| Town | Any attuned floor | Dungeon Gate → Waystone (see *Waystones*) |
| Anywhere in the dungeon | Town | Touch an attuned Waystone, or read a Scroll of Return |

**Boss gates:** the down stairs on floors 1–9 are behind the boss arena. The first time through, the boss must be defeated to reach them. A defeated boss never comes back.

---

## 2. Floor Specifications

The map is a **block-tile grid**: each tile is either floor or wall, and doors sit on floor tiles between two walls. This works directly with a DDA raycaster or a top-down view. Grid sizes are odd so maze carving lines up.

| Floor | Theme | Grid | Rooms | Hazards allowed | Theme features |
|---|---|---|---|---|---|
| 1 | The Cellars | 33 × 33 | 8–10 | — | Wine racks |
| 2 | The Old Crypt | 33 × 33 | 8–10 | Spinners | Sarcophagi |
| 3 | Goblin Warrens | 33 × 33 | 9–11 | Spinners | Goblin camps; twistier corridors |
| 4 | Fungal Caverns | 41 × 41 | 10–12 | Spinners, Dark Zones | Glowcap rooms, Web Curtains |
| 5 | The Drowned Halls | 41 × 41 | 10–12 | + Deep Water, Teleporter Pads | Flooded corridors |
| 6 | Sanctum of the Pale Flame | 41 × 41 | 11–13 | + Anti-Magic Fields | Altars and chapels |
| 7 | The Iron Forge | 41 × 41 | 11–13 | All above | Lava channels, heat vents |
| 8 | The Silent Library | 49 × 49 | 12–14 | All above | Bookshelves |
| 9 | The Frozen Deep | 49 × 49 | 12–14 | All above + Ice Slides | Frozen lakes |
| 10 | The Ashen Lair | 49 × 49 | 12–15 | All | Ash pits, the dragon's hoard |

### Pacing Targets

| Measure | Target |
|---|---|
| Arrival to boss (critical path) | 150–300 steps |
| Full clear of a floor | 600–1,000 steps |
| One play session | 5–10 minutes: reach a new area, a Safe Room, or a Waystone |
| Hollow Stalker threshold | 1,500 steps on one floor (well past a full clear) |

---

## 3. The Generation Pipeline

> **Note:** steps 1–4 below are handled by the supplied `dungeon-generator.js`, which uses room templates and a carved maze instead. See `docs/07-engine-modules.md` for what the floor builder does on top; the rest of this section still applies.

Every step uses the **floor's layout RNG stream** (see *Random Number Streams*), so the result is identical every time the floor is loaded.

### Step 1 — Rooms

1. Fill the grid with wall.
2. Try up to 200 random room placements. Rooms are odd-sized, **3–9 tiles** wide and tall, and can't overlap or touch (1-tile margin).
3. Stop when the floor's room count is reached.
4. Stamp the **boss arena** template first (see *Boss Arenas*), then the other rooms.

### Step 2 — Corridors

1. Fill the remaining space with a maze using the **growing-tree** algorithm.
   - Pick the newest cell 50% of the time and a random cell 50% of the time. This gives a mix of long winding halls and branches.
   - Floor 3 (Goblin Warrens) uses 80% newest for twistier tunnels.
2. Connect every room and corridor region with a **spanning tree** of connector tiles, so everything is reachable.
3. Add **extra connectors** at an 8% chance per remaining candidate. These create **loops**, which matter because they let the hero escape monsters and make shortcuts possible.

### Step 3 — Prune

Remove dead-end corridors one tile at a time until **6–10 dead ends** remain. Dead ends are useful: they hold chests and secret stashes.

### Step 4 — Doors

- **70%** of connectors between a room and a corridor become doors.
- The rest are open archways.

### Step 5 — Key Rooms

1. Pick the **arrival room**: the room farthest from the boss arena (measured by walking distance). The up stairs and the floor's **Waystone** go here.
2. The **boss arena** leads to the **down stairs**. The room right before the arena becomes the **Safe Room** (see *Boss Arenas*).
3. Find the **critical path**: the shortest walking route from the arrival room to the arena.
4. Measure every room's walking distance from the arrival room. This **depth** score is used for placing rewards and danger.

### Step 6 — Room Roles

Assign each remaining room a role:

| Role | Count | Placement |
|---|---|---|
| **Lair** | 2 + ⌊F ÷ 2⌋ | Any room. Holds a fixed encounter from the floor's table, often guarding a chest |
| **Treasure Room** | 1–2 | Deepest rooms **off** the critical path |
| **Curiosity Room** | 1–2 | Holds a fountain or shrine |
| **Theme Room** | 1–3 | Holds the floor's theme feature |
| **Secret Stash** | 1 | A dead end sealed with a secret door, holding a chest |
| **Plain** | The rest | Wandering monsters only |

### Step 7 — Special Doors

This step places keyed, sealed, barred, and one-way doors, then checks them (see *Solvability*).

| Door | Floors | How many | Where it's allowed |
|---|---|---|---|
| Stuck / Locked | 1+ | 25% + 2% × F of all doors | Anywhere. Doors **on the critical path are capped at Good locks**, so bashing always remains possible |
| Keyed | 3+ | 0–2 | On the critical path or in front of a Treasure Room. The Floor Key is placed where the hero can reach it first |
| Sealed | 5+ | 0–1 | **Only** in front of a Treasure Room or Secret Stash, never on the critical path. The Rune Key is placed where the hero can reach it |
| Barred | 3+ | 0–2 | Only on a loop, so the far side can be reached another way. Opening it from the far side creates a **shortcut** |
| One-Way | 4+ | 0–2 | Only on a loop, so the hero can always get back |
| Secret | 1+ | 2–4 | Secret Stash entrances, plus optional shortcuts. **Never** the only way along the critical path |

### Step 8 — Hazards

| Hazard | Rules |
|---|---|
| Spinner | Corridors only; at least 5 tiles from stairs and doors |
| Dark Zone | Up to 10% of floor tiles; never covering stairs, the Waystone, or the boss arena |
| Deep Water | Up to 3 tiles in a row on the critical path; longer pools only off it |
| Teleporter Pad | Its fixed destination must be a reachable tile |
| Anti-Magic Field | Never in the boss arena or Safe Room |
| Ice Slide (floor 9) | Only in rooms. Every entry must lead to a non-ice exit (checked by simulating the slides) |
| Web Curtain (floor 4) | Blocks a corridor until burned (torch, oil flask, or fire spell) or bashed (TN 10 + F) |

### Step 9 — Traps, Chests, and Curiosities

Placed using the counts from **Traps, Locks & Treasure**:

- **Floor traps:** 4 + F, on corridors and rooms. Never on stairs, Waystones, the Safe Room, or the boss arena, and never within 3 tiles of the arrival point.
- **Chests:** 3 + ⌊F ÷ 2⌋, preferring dead ends, Treasure Rooms, Lairs, and the Secret Stash.
  - **Depth bonus:** chests in the deepest 40% of rooms add +2 to their lock and trap tier rolls, and to their loot roll.
- **Door traps:** 1 in 6 doors (1 in 4 on floors 6+). Doors on the critical path can't have Arcane traps.
- **Curiosities:** one fountain or shrine per Curiosity Room.

### Step 10 — Validate

Run the **solvability check** below. If it fails, add 1 to the floor seed and regenerate. The result is still deterministic because the same failures always happen in the same order.

---

## 4. Solvability

The generator must guarantee that a hero with **no special skills or items** can always:

1. reach the boss arena from the arrival room,
2. reach the down stairs after the boss falls,
3. get back to the arrival room from anywhere.

### What the Checker Assumes

The "minimum hero" can:
- walk on floor tiles, including spinners, dark zones, and short deep water;
- open stuck and locked doors by bashing (critical path locks are capped at Good);
- pick up keys and use them;
- burn or bash Web Curtains.

The minimum hero **can't** find secret doors, open Sealed doors, or rely on teleporters and chutes.

### The Check (flood fill with keys)

```text
reachable = flood_fill(arrival, passable = minimum_hero_rules, keys = {})
repeat:
    for each key found inside reachable:
        add key to keys
    reachable = flood_fill(arrival, passable = minimum_hero_rules, keys)
until no new keys are found

FAIL if boss arena entrance not in reachable
FAIL if any tile in reachable cannot walk back to arrival
    (one-way doors and ice slides can trap the hero)
FAIL if a Rune Key is not reachable for its Sealed door
PASS otherwise
```

### Optional Content

Secret Stashes and Sealed Treasure Rooms are allowed to need skills (Keen Senses, Dispel Ward) or items (Rune Keys, Dust of Revealing). That's the reward for building a character who can find them. Their keys still have to be placed where the hero can reach them.

---

## 5. Boss Arenas and Safe Rooms

Boss arenas are **handmade templates** stamped into the procedural map, so every boss fight has the right shape.

- **Arena:** 9 × 9 tiles (11 × 11 for floor 10), with **one entrance door** that is never locked or trapped.
- **Down stairs:** in a small alcove behind the arena, reachable only through it.
- **Safe Room:** the room right before the arena.
  - No wandering monster checks inside it.
  - Camping here is never interrupted.
  - No traps or hazards.
  - On entering, the log gives a warning: *"Something enormous shifts beyond the door…"*
- **Boss arenas and Safe Rooms don't count toward the step clock's wandering monster checks.**

Each template also marks positions for objects the boss fight uses, such as the Hydra's body, the Colossus's coolant valves, or the Lich's phylactery.

---

## 6. Theme Features

| Floor | Feature | Interaction |
|---|---|---|
| 1 | Wine Racks | Search once: 1-in-6 chance for a ration or a Healing Potion |
| 2 | Sarcophagus | Open: d6 → 1–2 a Skeleton fight, 3–5 empty, 6 a Common loot roll |
| 3 | Goblin Camp | A Lair whose chest gets +10 on its loot roll |
| 4 | Glowcap Room | Naturally lit; torches don't burn down while inside |
| 4 | Web Curtain | Blocks a corridor (see *Hazards*) |
| 5 | Flooded Corridor | Deep Water tiles |
| 6 | Altar | Works as an Offering Shrine |
| 7 | Lava Channel | Impassable scenery that shapes rooms |
| 7 | Heat Vent | A visible Flame Jet trap that fires every 3rd step. It can be timed, and it doesn't need detecting |
| 8 | Bookshelf | Search once: 1-in-8 chance for a random Uncommon scroll |
| 9 | Frozen Lake | An Ice Slide puzzle room |
| 10 | Ash Pit | Impassable scenery; some hold a Gemstone that can be reached with a ten-foot pole |

### New Hazard: Ice Slide (floor 9)

Stepping onto ice slides the hero in the direction they're facing until they hit a wall or a non-ice tile. The hero can't turn while sliding. Wandering monster checks still count each tile slid. Frozen Lakes are small puzzle rooms; the generator verifies every one can be crossed and exited.

---

## 7. Encounters on the Map

- **Lair encounters** are placed during generation and stay put until defeated. They don't come back, except through *Restocking*.
- **Wandering monsters** use the step clock from the Core Rule Set (a d6 every 10 steps) and the floor's encounter table from the Bestiary.
- **No wandering checks** inside the Safe Room, boss arena, or town.
- **Retreat rule:** if the hero flees, the monsters stay on the tile where the fight happened. Walking onto that tile again restarts the fight with the monsters' HP as it was.

---

## 8. Restocking

Floors are fixed, but a dungeon that never changes turns into a hallway. **Each time the hero comes back from town**, every previously visited floor restocks:

| What | Restock |
|---|---|
| Lair encounters | 1–2 defeated Lairs refill with a new encounter from the floor's table |
| Chests | 1 new chest appears in a random dead end (max 3 unopened restocked chests per floor) |
| Traps | 1d3 disarmed or sprung floor traps re-arm |
| Bosses, Unique items, secret doors, keys | Never restock |
| Map, opened shortcuts, unlocked doors | Stay as the hero left them |

---

## 9. Waystones

Every floor has a **Waystone** in its arrival room. This is the main answer to getting back to the depths.

- **Attuning:** stepping on a Waystone attunes it permanently. Since floor N + 1 can only be reached by beating boss N, each Waystone is earned by a boss victory.
- **From town:** the Dungeon Gate lists every attuned Waystone. Travel is free and instant.
- **From the dungeon:** stepping on any attuned Waystone offers a free trip to town (not during combat).
- **Step clock:** traveling by Waystone resets the floor's Hollow Stalker count.

### Return Mark

A **Scroll of Return** (Item Database) teleports the hero to town and leaves a **Return Mark** on the tile where it was read.

- The Dungeon Gate offers **"Return to Mark"** once. Using it removes the mark.
- Only one mark can exist at a time; reading another Scroll of Return replaces it.
- A mark can't be placed inside a boss arena.

### Graves (Adventurer mode)

When an Adventurer hero dies, they wake in town having lost half their carried gold and all unidentified items. Those losses are left in a **Grave** on the tile where the hero died.

- The Grave is marked on the map.
- Walking onto it returns everything that was dropped.
- If the hero dies again before reaching it, the old Grave is lost and a new one is made.
- The Grave lasts through restocking, but a Lair may refill near it.

---

## 10. The Automap

- **Explored tiles** are remembered permanently and shown on the map screen.
- **Dark Zones** never fill in on the map.
- **Scroll of Mapping** reveals the layout of the current floor (walls and doors, but not traps, secret doors, or hazards).
- **Map icons** (from Traps, Locks & Treasure) mark found traps, hazards, locked doors, and unopened chests. This document adds icons for **Waystones**, **Safe Rooms**, the **Return Mark**, and **Graves**.
- **Floor feeling (optional):** on first arrival, the log hints at the floor's best treasure: *"You sense something valuable in the depths of this level."*

---

## 11. Saving

### Principles

1. **Nothing is ever lost to closing the app.** The game can be closed at any moment, including mid-combat, and reopens at exactly the same spot.
2. **Reloading can't change luck.** All randomness comes from saved seeded RNG streams, so the same state plus the same action always gives the same result.
3. **Saves are small.** Floors are stored as a seed plus a list of changes, not full maps.

### When the Game Saves

| Trigger | Timing |
|---|---|
| Every step while exploring | Batched, written within 250 ms |
| Every random outcome (attack, save, trap, loot, wandering check) | **Written before the result is shown** |
| Every combat round, combat start, and combat end | Immediately |
| Any inventory, gold, or equipment change | Immediately |
| Every town transaction | Immediately |
| Floor change, Waystone travel, camping | Immediately |
| App goes to the background | Immediately (flush anything pending) |

### Random Number Streams

Use a seeded generator such as **sfc32** or **mulberry32**, with a separate stream for each purpose so one system never shifts another's results:

| Stream | Used for | Seeded from |
|---|---|---|
| Layout | Generating a floor | Master seed + floor number |
| Encounter | Wandering monster checks and encounter rolls | Master seed, then carried in the save |
| Combat | Attack rolls, damage, saves, AI choices | Master seed, then carried in the save |
| Loot | Drops, chest contents, item properties, curses | Master seed, then carried in the save |
| Restock | Restocking floors | Master seed + number of town visits |

The current state of every carried stream is part of the save file.

### Save Slots and Modes

| Mode | Slots | Manual save or load | On death |
|---|---|---|---|
| **Adventurer** | 3 | No manual saving (it's always automatic), but the player can switch between slots | Wake in town; Grave created |
| **Ironman** | 1 per character | None. Only the single automatic save exists | Save is deleted; a tombstone goes to the Hall of the Dead |

**Ironman protections:**
- Every random outcome is committed to storage before it's shown, so quitting mid-roll changes nothing.
- There's no export for Ironman saves.
- A backup copy is kept only to recover from corruption, and it's only used if the main save fails its checksum.

### Safe Writing

1. Write the new save to a temporary key.
2. Verify its checksum.
3. Swap it in as the main save and keep the previous one as the backup.

If the main save is ever unreadable, the game loads the backup automatically and tells the player.

### Storage

- **IndexedDB** holds save slots, the Hall of the Dead, and the backup.
- Settings are stored separately and shared across all slots.
- Expected size: under **200 KB** per save.

### Versioning

Every save carries a `version` number. When the game updates, a chain of small migration functions upgrades old saves one version at a time (for example, v3 → v4 → v5), so no save is ever stranded.

### Export and Import (Adventurer only)

The Settings screen can export a slot as a file or a copyable text string and import one back. This doubles as a manual backup and a way to move a game to a new phone.

---

## 12. Hall of the Dead

When an Ironman hero dies, or any hero finishes the game, a record is added:

- Name, level, origin, and skill Paths
- Floor and cause of death (*"Slain by a Ghast on floor 5"*)
- Days in the dungeon (town visits), total steps, and play time
- Gold carried, bosses defeated, and the best item owned

**Score** = XP + gold carried + (deepest floor × 1,000) + (bosses defeated × 500), doubled for a victory and ×1.5 for Ironman.

The screen shows the top 20 records, styled as tombstones in the tradition of Rogue.

---

## 13. Resume Flow

- On launch, the title screen shows **Continue** with the last-played slot's hero, floor, and play time.
- Tapping Continue loads straight into the exact screen: mid-corridor, mid-combat, or in a shop.
- A mid-combat resume shows the last three combat log lines so the player remembers what was happening.

---

## 14. Data Templates

### Generated Floor (rebuilt from the seed; never saved)

```json
{
  "floor": 4,
  "seed": 918273645,
  "size": [41, 41],
  "tiles": "base64-encoded wall/floor grid",
  "rooms": [
    { "id": "r0", "rect": [3, 5, 7, 5], "role": "arrival", "depth": 0 },
    { "id": "r7", "rect": [30, 28, 9, 9], "role": "bossArena", "depth": 212 }
  ],
  "stairs": { "up": [5, 7], "down": [34, 38] },
  "waystone": [6, 7],
  "doors": [
    { "pos": [10, 7], "kind": "locked", "lockTier": "good", "trap": null },
    { "pos": [18, 21], "kind": "keyed", "keyId": "floorkey_4" }
  ],
  "chests": ["chest_f4_00", "chest_f4_01"],
  "traps": [{ "pos": [14, 9], "kind": "dart_plate", "tier": "standard" }],
  "hazards": [{ "pos": [22, 15], "kind": "spinner" }],
  "lairs": [{ "room": "r3", "encounter": "giant_spider_x2" }]
}
```

### Floor Changes (saved)

```json
{
  "floor": 4,
  "seed": 918273645,
  "explored": "base64 bitset",
  "doorsOpened": [[10, 7]],
  "doorsJammed": [],
  "chestsOpened": ["chest_f4_00"],
  "trapsFound": [[14, 9]],
  "trapsDisarmed": [[14, 9]],
  "secretsFound": [[27, 3]],
  "keysTaken": ["floorkey_4"],
  "lairsCleared": ["r3"],
  "retreatedEncounters": [{ "pos": [20, 12], "enemies": [{ "id": "giant_spider", "hp": 9 }] }],
  "bossDefeated": false,
  "waystoneAttuned": true,
  "restockedChests": [],
  "stepsThisVisit": 412
}
```

### Save File

```json
{
  "version": 1,
  "checksum": "sha1-…",
  "savedAt": "2026-09-16T18:30:00Z",
  "mode": "adventurer",
  "masterSeed": 123456789,
  "playTimeSec": 5230,
  "townVisits": 7,
  "location": { "place": "dungeon", "floor": 4, "pos": [14, 10], "facing": "N" },
  "hero": { "name": "Harrow", "level": 6, "hp": 41, "fp": 9, "xp": 1620, "attributes": {}, "skills": {}, "conditions": [] },
  "inventory": { "equipped": {}, "pack": [], "quickSlots": [], "gold": 312 },
  "knowledge": { "potionLooks": {}, "scrollTitles": {}, "knownTypes": [] },
  "town": { "shopTier": 3, "rotatingStock": [], "stash": [], "alchemistOpen": true },
  "floors": [],
  "returnMark": null,
  "grave": { "floor": 3, "pos": [8, 22], "gold": 140, "items": ["itm_0088"] },
  "rng": { "encounter": [1, 2, 3, 4], "combat": [5, 6, 7, 8], "loot": [9, 10, 11, 12] },
  "combat": null
}
```

When the hero is mid-combat, `combat` holds the full fight: each enemy's HP, conditions, and cooldowns; the round number and turn order; whose turn it is; any telegraphed attack waiting to fire; and the last three log lines.
