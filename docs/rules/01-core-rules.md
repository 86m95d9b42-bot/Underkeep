# UNDERKEEP — Core Rule Set
*Working title. A single-hero, classless, turn-based dungeon RPG in the spirit of 1979–1987 computer RPGs (Temple of Apshai, Wizardry, Rogue, Phantasie), designed for a phone in portrait mode.*

---

## 1. Design Pillars

1. **One hero, many builds.** No classes. The skill tree *is* the class system, and hybrid builds are rewarded.
2. **Small numbers, readable math.** Everything resolves with a d20 plus small modifiers, so players can reason about odds.
3. **Resource tension.** HP, Focus, torches, and rations make every trip down a push-your-luck decision.
4. **One-thumb play.** Every action is reachable in two taps or fewer.

---

## 2. The Core Mechanic

Every uncertain action uses one roll:

> **d20 + modifiers ≥ Target Number (TN) → success**

- **Natural 20:** always succeeds (and is a critical hit on attacks).
- **Natural 1:** always fails.
- **Advantage / Disadvantage** (from skills, conditions, lighting): roll 2d20, keep the higher / lower. They cancel each other out and never stack.

| Difficulty | TN |
|---|---|
| Easy | 8 |
| Standard | 12 |
| Hard | 16 |
| Heroic | 20 |
| Dungeon-scaled (traps, locks) | 10 + floor number |

---

## 3. Attributes

Six attributes, each scored 3–20.

| Attribute | Abbr. | Governs |
|---|---|---|
| Might | MIG | Melee hit and damage, carrying capacity, bashing doors, heavy gear requirements |
| Agility | AGI | Defense, ranged attacks, initiative, Reflex saves, locks and traps |
| Vigor | VIG | Hit points, Body saves, resisting poison and disease |
| Intellect | INT | Spell power, Focus pool, identifying items, reading scrolls |
| Wits | WIT | Perception, secret doors, healing power, Mind saves, Focus pool |
| Luck | LCK | Critical range, loot quality, flee chance, shop prices |

### Attribute Modifier Table

| Score | 3 | 4–5 | 6–8 | 9–12 | 13–15 | 16–17 | 18–19 | 20 |
|---|---|---|---|---|---|---|---|---|
| Mod | −3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 |

### Character Creation

Offer two modes on the title screen:

- **Classic (hard):** roll 3d6 for each attribute *in order*. The player may reroll the whole set as many times as they like, but can't rearrange.
- **Standard:** roll 4d6, drop the lowest, six times, and assign the results to attributes freely.

Natural maximum at creation is 18. Attributes can reach 20 only through level-up points and magic.

### Origins

Pick one. An origin grants one free skill (it doesn't count against Path requirements) and a starting kit.

| Origin | Attribute | Free Skill | Kit |
|---|---|---|---|
| Sellsword | +1 MIG | Weapon Training (rank 1) | Long sword, leather armor, 2 rations, 10 gp |
| Cutpurse | +1 AGI | Lockpicking (rank 1) | Short sword, 3 daggers, lockpicks, ten-foot pole, 25 gp |
| Apprentice | +1 INT | Magic Missile | Staff, robe, 1 scroll of Sleep, 15 gp |
| Pilgrim | +1 WIT | Mend | Mace, leather armor, 2 healing herbs, 10 gp |

---

## 4. Derived Statistics

| Stat | Formula |
|---|---|
| **Hit Points (HP)** | Level 1: 10 + VIG *score*. Each level after: +1d6 + VIG mod (minimum +2) |
| **Focus Points (FP)** | 4 + level + INT mod + WIT mod (minimum 2) |
| **Base Attack (BA)** | ⌊level ÷ 2⌋ |
| **Melee Attack** | d20 + BA + MIG mod + weapon/skill bonuses |
| **Ranged Attack** | d20 + BA + AGI mod + weapon/skill bonuses |
| **Spell Attack** | d20 + BA + INT mod |
| **Defense (DEF)** | 10 + AGI mod + armor + shield + bonuses |
| **Initiative** | d6 + AGI mod (rolled each round) |
| **Saves** | d20 + attribute mod + ⌊level ÷ 3⌋ vs. the effect's DC |
| **Inventory Slots** | 10 + (MIG mod × 2) |
| **Critical Range** | Natural 20. Natural 19–20 if LCK mod is +2 or higher |

**Saves:** *Body* (VIG) resists poison, disease, and paralysis. *Reflex* (AGI) resists traps, breath, and blasts. *Mind* (WIT) resists sleep, fear, and charm.

**Effect DCs:** Monster abilities use DC 10 + ⌊HD ÷ 2⌋. Player abilities use DC 10 + ⌊level ÷ 2⌋ + the governing attribute mod.

**Focus** is shared by martial techniques and spells. It regenerates only by resting, potions, or skills. This single pool is what keeps hybrid builds balanced.

---

## 5. Leveling

**XP needed to reach level L = 50 × L × (L − 1).** Level cap is 20.

| Level | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 15 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| Total XP | 100 | 300 | 600 | 1,000 | 1,500 | 2,800 | 4,500 | 6,600 | 10,500 | 19,000 |

**On each level-up:**
- Gain HP (see above); FP rises automatically.
- Gain **1 Skill Point (SP)**. The hero also starts with 1 SP at level 1.
- At levels **4, 8, 12, 16, and 20**, gain **+1 to any attribute** (max 20).

XP sources: defeating monsters, disarming traps (10 × floor), picking locks (5 × floor), finding secret doors (10 × floor), and discovering a floor's stairs for the first time (25 × floor). *Optional old-school rule:* treasure carried back to town is worth 1 XP per gold piece.

**Respec:** a temple in town resets all Skill Points for 100 gp × level.

---

## 6. The Skill Tree

### Structure

There are four **Paths**, each with four tiers. A tier unlocks once enough points are spent in that Path:

| Tier | Points already spent in the Path |
|---|---|
| I | 0 |
| II | 3 |
| III | 6 |
| IV (Capstone) | 10, plus an attribute of 15 or higher |

**Skill types:**
- **Passive** — always on.
- **Active** — uses your action and costs FP.
- **Reaction** — triggers on an enemy's action, at most once per round.

A hero gets **21 SP by level 20** (20 from levels plus 1 at start), out of about 68 available. That means a player can master one Path and dabble in another, or split two Paths evenly and pick up a Crossroads skill.

---

### ⚔️ Path of the Blade (Might / Vigor) — the warrior

| Tier | Skill | Type | Ranks | Effect |
|---|---|---|---|---|
| I | Weapon Training | Passive | 3 | +1 melee attack per rank |
| I | Power Strike | Active, 2 FP | 1 | Melee attack at −2 to hit; roll one extra weapon die of damage |
| I | Toughness | Passive | 3 | +5 max HP per rank |
| I | Brute Force | Passive | 2 | +3 per rank to bash doors and chests. R2: bashing a chest never breaks its contents, and the noise check drops to 1-in-6 |
| II | Cleave | Passive | 1 | When you drop a front-row enemy, make a free attack on another front-row enemy (once per turn) |
| II | Armor Training | Passive | 2 | R1: no attack or spell penalty in heavy armor. R2: also Damage Reduction 1 in heavy armor |
| II | Shield Bash | Active, 2 FP | 1 | Requires a shield. Deal 1d4 + MIG mod; target makes a Body save or is Stunned for 1 round |
| III | Riposte | Reaction, 2 FP | 1 | When a melee attack misses you, counterattack immediately |
| III | Second Wind | Active, free action | 1 | Heal 25% of max HP. Once per combat |
| III | Weapon Mastery | Passive | 1 | Choose a weapon group: +1 critical range, and criticals deal ×3 damage instead of ×2 |
| IV | **Juggernaut** | Passive | 1 | *Requires MIG 15.* The Attack action makes two attacks |

### 🗡️ Path of Shadow (Agility / Luck) — the rogue and archer

| Tier | Skill | Type | Ranks | Effect |
|---|---|---|---|---|
| I | Marksman | Passive | 3 | +1 ranged attack per rank |
| I | Sneak | Passive | 1 | Surprise enemies on 1–2 on a d6 (base is 1); a surprised enemy group loses its first round |
| I | Lockpicking | Passive | 3 | +2 per rank to pick locks. R2: lockpicks never break. R3: picking takes 1 step instead of 5 |
| I | Trapfinding | Passive | 3 | +2 per rank to detect and disarm traps. R2: no −4 penalty on passive notice. R3: salvage on success by 5+ instead of 10+ |
| II | Backstab | Passive | 1 | Attacks against Surprised, Stunned, Asleep, or Blinded targets deal +2 weapon dice |
| II | Evasion | Passive | 2 | +1 DEF per rank. R2: a successful Reflex save against an area effect means you take no damage |
| II | Envenom | Active, 2 FP | 1 | Your next hit this combat Poisons the target |
| II | Nimble Fingers | Passive | 1 | Disarming takes 1 step. Once per trap, a disarm that fails by 5+ counts as a plain failure instead of setting it off |
| III | Twin Shot | Active, 3 FP | 1 | Make two ranged attacks at −2 each |
| III | Vanish | Active, 3 FP | 1 | Either flee automatically, or become Hidden (your next attack counts for Backstab). Once per combat |
| III | Lucky | Passive | 1 | Once per combat, force a reroll of any single d20: your own roll or an attack against you |
| IV | **Death Strike** | Active, 5 FP | 1 | *Requires AGI 15.* Attack a Surprised, Stunned, or Asleep target, or any target while you're Hidden. On a hit, it makes a Body save or dies. Bosses take triple damage instead |

### ✨ Path of Arcana (Intellect) — the mage

| Tier | Skill | Type | Ranks | Effect |
|---|---|---|---|---|
| I | Magic Missile | Active, 1 FP | 1 | Never misses. Fire 1 missile + 1 per 4 levels (max 5), each dealing 1d4 + 1. Can target any row |
| I | Arcane Well | Passive | 3 | +3 max FP per rank |
| I | Lore | Passive | 1 | Auto-identify items; see enemy HP bars and weaknesses. +3 to detect and dispel magical traps (and learn their type), and reveals Mimics |
| I | Knock | Active, 2 FP | 1 | Opens a Simple or Good lock automatically; Masterwork needs an INT check. Out of combat only |
| II | Sleep | Active, 3 FP | 1 | Every enemy in one row with HD ≤ level + 2 makes a Mind save or falls Asleep. Undead are immune |
| II | Frost Shard | Active, 2 FP | 1 | Spell attack dealing 2d6 + INT mod; target makes a Reflex save or is Slowed |
| II | Dispel Ward | Active, 3 FP | 1 | Disarm an Arcane trap or open a Sealed lock, with +4 to the INT roll |
| II | Arcane Shield | Reaction, 2 FP | 1 | After an attack roll hits you, gain +4 DEF against it (which may turn it into a miss) |
| III | Fireball | Active, 5 FP | 1 | 1d6 per level (max 10d6) to one entire row; Reflex save for half |
| III | Blink | Active, 3 FP | 1 | For 3 rounds, each attack against you has a 50% chance to miss outright |
| III | Mana Siphon | Passive | 1 | Regain 1 FP whenever you kill an enemy |
| IV | **Archmage** | Passive | 1 | *Requires INT 15.* All spells cost 1 less FP (minimum 1). Once per combat, cast a spell as a free action |

### 🌿 Path of Spirit (Wits / Vigor) — the healer and survivor

| Tier | Skill | Type | Ranks | Effect |
|---|---|---|---|---|
| I | Mend | Active, 2 FP | 1 | Heal 2d6 + WIT mod. Usable outside combat |
| I | Keen Senses | Passive | 2 | +3 per rank to find traps, secret doors, and hazards. R2: you can't be surprised, and you're warned when a hidden trap or secret door is within 1 tile |
| I | Forager | Passive | 1 | Rations last twice as long. After each combat, a 1-in-6 chance to find a healing herb |
| II | Turn Undead | Active, 3 FP | 1 | Undead with HD ≤ level make a Mind save or Flee; those with HD ≤ half your level are destroyed |
| II | Resilience | Passive | 2 | +2 to all saves per rank |
| II | Cleanse | Active, 2 FP | 1 | Remove one condition |
| III | Regeneration | Passive | 1 | Heal 1 HP at the start of each of your turns, and 1 HP per 10 steps while exploring |
| III | Spirit Ward | Active, 4 FP | 1 | Damage Reduction 3 for the rest of the combat |
| III | Smite | Active, 3 FP | 1 | Weapon attack adding WIT mod to hit and +2d6 damage. Double damage against undead and demons |
| IV | **Undying** | Passive | 1 | *Requires WIT 15.* Once per rest, when you would drop to 0 HP, you're restored to 50% HP instead |

---

### 🔀 Crossroads Skills (hybrids)

Each Crossroads skill costs 1 SP and requires **4 points in each of its two Paths**. These are the heart of build variety.

| Skill | Paths | Effect |
|---|---|---|
| **Duelist** | Blade + Shadow | Use AGI instead of MIG for attack and damage with Light weapons. +1 DEF while not using a shield |
| **Spellblade** | Blade + Arcana | When a melee attack hits, spend up to 3 FP to add 1d6 damage per FP spent |
| **Crusader** | Blade + Spirit | Heal 2 HP each time your melee attack hits |
| **Arcane Trickster** | Shadow + Arcana | Damage spells cast while you're Hidden, or against Surprised targets, get Backstab dice |
| **Ranger** | Shadow + Spirit | *Hunter's Mark* (1 FP): +2 to hit and +1d6 damage against the marked foe. Your ranged attacks ignore the Half Cover penalty |
| **Mystic** | Arcana + Spirit | Healing beyond max HP becomes temporary HP. Damage spells heal you for 25% of the damage dealt |

### Example Builds at Level 20 (21 SP)

- **Pure Warrior:** Blade 16 (everything except Brute Force rank 2) + Spirit 4 (Resilience ×2, Mend, Cleanse) + Crusader.
- **Battle Mage:** Arcana 11 (through Archmage) + Blade 4 + Spellblade + 5 spare.
- **Assassin:** Shadow 16 (everything except Marksman ranks 2–3 and Twin Shot) + Arcana 4 + Arcane Trickster.
- **Wanderer:** Shadow 8 + Spirit 8 + Ranger + 4 spare. No capstone, but very flexible.

---

## 7. Combat

### Battlefield

Enemies stand in up to **two rows**: **Front** and **Back**. The hero always fights from the front.

- **Melee** attacks can only target the Front row. Weapons with *Reach* can hit the Back row.
- **Ranged** attacks and **spells** can target either row. Ranged attacks against the Back row take −2 (**Half Cover**) while any Front-row enemy is standing.
- When the Front row is empty, Back-row enemies step forward.
- Enemy archers and casters placed in the Back row are what give fights their tactics.

### Round Sequence

1. Everyone rolls **initiative** (d6 + AGI mod). Enemies of the same type share one roll. Ties go to the hero.
2. Act in order from highest to lowest.
3. Condition durations count down at the end of the affected unit's own turn.

The exact order of every step, from initiative to damage to death checks, is defined in the **Combat Engine & Monster AI** document. When timing is unclear anywhere else, that document decides.

### Hero Actions (choose one per turn)

| Action | Effect |
|---|---|
| **Attack** | Weapon attack vs. target's DEF |
| **Skill / Spell** | Use an Active skill; pay its FP |
| **Item** | Use a potion, scroll, herb, or thrown weapon |
| **Defend** | +4 DEF until your next turn, and regain 1 FP |
| **Swap** | Change weapon or shield. Free once per combat, otherwise uses the action |
| **Flee** | d20 + AGI mod + LCK mod ≥ 10 + number of enemies. On a failure, every enemy gets a free attack. Bosses can't be fled |

### Damage

- **Weapon damage** = weapon die + MIG mod for melee (AGI mod for thrown weapons; ranged bows add no attribute unless a skill says so) + magic bonus.
- **Critical hit:** double all damage dice (triple with Weapon Mastery).
- **Damage Reduction (DR)** subtracts from each hit, to a minimum of 1.
- **Minimum damage** on any hit is 1.
- **Damage types:** Slash, Crush, Pierce, Fire, Cold, Force, Holy, Necrotic, Acid, and Poison. A monster **Resistant** to a type takes half damage, **Weak** takes ×1.5 (round down), and **Immune** takes none.

### Telegraphs

Big monster attacks are announced one turn early in the combat log. If the hero Defends in response, the telegraphed attack deals half damage, and any save it forces is made with advantage.

### Conditions

| Condition | Effect | Ends |
|---|---|---|
| Poisoned | 1d4 damage at the start of each turn | Body save at end of turn, or 3 rounds |
| Burning | 1d6 damage at the start of each turn | Reflex save at end of turn |
| Bleeding | 2 damage per turn | Any healing |
| Stunned | Lose your next turn; attacks against you have advantage | 1 round |
| Asleep | Helpless; attacks against you auto-hit | Taking damage, or 3 rounds |
| Slowed | Act last each round; −2 DEF | 2 rounds |
| Feared | Can't make melee attacks | Mind save at end of turn |
| Blinded | Disadvantage on attacks | 2 rounds |
| Paralyzed | Helpless (as Asleep, but damage doesn't wake you) | Body save at end of turn |
| Weakened | Half weapon damage | Rest |
| Drained | −1 level's worth of HP and BA per stack (see Wraith) | Temple cure, or a full rest in town |
| Grabbed | Can't Flee or Swap | You hit the grabber, or it dies |
| Knocked Down | −2 DEF and disadvantage on your next attack | End of your next turn |
| Webbed | Can't attack or Flee; use your action for a MIG or AGI check (TN 12) to break free. Fire frees you but deals 1d4 | Breaking free |
| Sickened | Disadvantage on attacks | End of the round |
| Petrified | As Paralyzed, but DR 5 | 2 rounds |
| Hidden | Enemies attack you with disadvantage; your next attack counts for Backstab, Death Strike, and Arcane Trickster | You attack or use an active skill, or after 2 of your turns |

### Solo Hero Protections

With no party to help, a single hero can get locked down or swarmed. These rules keep fights hard but fair:

- **Control immunity:** when Stunned, Asleep, Paralyzed, Petrified, or Webbed ends, the hero is immune to that same condition for 2 rounds.
- **Grit:** the hero never loses more than 2 turns in a row. On the third turn, all of those conditions end and the hero acts.
- **No helpless crits:** attacks against a helpless hero hit automatically, but they aren't critical hits.
- **Failed flee:** only the two strongest enemies (highest HD) get free attacks, not the whole group.
- **Crowd cap:** no more than 5 enemies (summons included) can be on the field at once. Extra summons fail.

### Defeat

Offer two modes at character creation:

- **Ironman:** 0 HP means death. The save file is deleted.
- **Adventurer:** at 0 HP you wake in town, lose half your carried gold and every unidentified item, but keep XP and gear. The lost gold and items wait in a **Grave** where you fell; reach it to take them back.

---

## 8. Equipment

The full list of weapons, armor, charms, potions, scrolls, tools, and valuables is in the **Item Database** document. The key rules:

- **Equipment slots:** Weapon, Off-Hand (shield), Armor, and one Charm. Equipped items don't use inventory space.
- **Inventory:** 10 + (MIG mod × 2) slots. Consumables stack 5 per slot; gold takes no space. A Town Stash holds 50 more slots.
- **Weapons:** 17 types in four groups (Blade, Blunt, Polearm, Bow) with properties such as Light, Thrown, Reach, and Reload. Using a weapon without its attribute requirement gives −2 to hit.
- **Armor:** Robe through Plate, plus Shield and Tower Shield. Chain, Scale, and Plate are **heavy**. Heavier armor limits your AGI bonus to DEF, and adds Stealth penalties (to picking and disarming), to-hit penalties, and spell fizzle. Armor Training removes the to-hit and fizzle penalties.
- **Magic gear:** +1 (floors 1+), +2 (floors 4+), +3 (floors 8+), and Rare gear may carry a property such as Flaming or Fortified.
- **Identification:** magic gear, most potions, and all scrolls are found unidentified. Potion looks and scroll titles are reshuffled each game. Cursed gear binds when equipped.
- **Scrolls:** Arcane scrolls need INT 11 and Spirit scrolls need WIT 11. They use the reader's level and attribute mods.
- **Durability:** none. Only specific events (slime corrosion, broken lockpicks, destroyed potions) damage items.
- **Ammunition:** unlimited. Thrown weapons are recovered after combat.

---

## 9. Exploration

### The Dungeon

- A grid-based, first-person or top-down dungeon of **10 floors** plus a town hub.
- Movement is one tile per tap/swipe. Each step or turn advances the game clock by 1.
- **Wandering monsters:** every 10 steps, roll d6; an encounter happens on a 1. Add +1 to the encounter range on floors 6+.
- **Surprise:** when an encounter starts, roll d6 for each side. The hero surprises on a 1 (1–2 with Sneak); enemies surprise on a 1 (never with Keen Senses rank 2).
- **Fixed floors:** each floor is generated once from the game's seed and stays the same all game, so mapping is permanent. Monsters, a few traps, and a few chests restock between trips.
- **Boss gates:** each floor's down stairs sit behind its boss arena. The room before the arena is a **Safe Room** with no wandering monsters.
- **Waystones:** each floor's arrival room has a Waystone. Once attuned, it allows free travel to and from town.
- Generation, solvability, Waystones, Graves, and saving are covered in the **Dungeon Generation, Waystones & Saving** document.

### Light

A lit torch shows the map normally. **Darkness** hides the automap, gives disadvantage on attacks, and doubles the wandering monster chance. The Light spell from scrolls or magic items replaces torches.

### Traps, Locks & Treasure

Non-combat challenges have their own companion document, **Traps, Locks & Treasure**. In short:

- **Every action costs steps** on the wandering monster clock: Search 5, Careful Search 20, pick 5, disarm 5, bash 2 plus a noise check.
- **Detection:** d20 + WIT mod + bonuses vs. 10 + floor (tier-adjusted). The game also rolls automatically at −4 before the hero steps on or opens something trapped. Success by 5+ reveals the exact trap type.
- **Traps** can be disarmed (d20 + AGI mod + Trapfinding; failing by 5+ sets them off), sprung safely with a ten-foot pole, walked around, or ignored. An undetected trap is saved against with disadvantage.
- **Locks** can be picked, bashed, opened with keys, or opened with Knock and Dispel Ward. Sealed locks need magic or a rune key.
- **Chest sequence:** Inspect → handle the trap → unlock → open → loot. Harder traps and locks mean better loot.
- **Hazards:** spinners, dark zones, deep water, teleporter pads, anti-magic fields, and curiosities such as fountains and shrines.

### Resting

- **Camp** (anywhere without adjacent enemies): uses 1 ration. Restores 50% HP and all FP. Roll d6: on 1–2, a wandering monster interrupts before you recover anything.
- **Inn** (town): full HP and FP, removes all conditions. Costs 5 gp × level.

### Town

Offers the Inn, a Shop (buys at 50%, except gems and valuables at 100%; prices drop 5% per positive LCK mod; repairs corrosion for 10 gp; stock grows as bosses fall), a Temple (cures, curse removal, respec; resurrection is *not* offered for Ironman), a Sage (identifies items for 20 gp each, free with Lore), a Stash (50 slots of storage), and, after the floor 2 boss, an Alchemist who turns monster parts into potions and bombs. Details are in the **Item Database**.

---

## 10. Monsters

Every monster is built from its **Hit Dice (HD)**. The full list of monsters, bosses, elite variants, and encounter tables is in the separate **Bestiary** document.

| Stat | Regular monster | Boss |
|---|---|---|
| HP | HD × 5 | HD × 10 early, up to HD × 22 for the final boss |
| ATK | HD + 1 | HD + 1 to HD + 2 |
| DEF | 11 + ⌊HD ÷ 2⌋ | +1 to +3 above normal |
| DMG | 1d6 + ⌊HD ÷ 2⌋ (1d4 at HD 1) | Larger dice; multiple attacks |
| Saves | ⌊HD ÷ 2⌋, shifted by creature type | Higher |
| XP | HD × 10 (×1.5 with a dangerous trait) | About one level's worth |
| Gold | HD × 1d10 | Listed per boss |

**Encounter budget:** total HD ≈ hero level × 1.5 (round up). With these numbers, a hero needs about 10 kills of even-level monsters per level.

**Morale:** when a monster's group is cut in half, or it drops below 25% HP, roll 2d6. If the roll is higher than its Morale score, it flees (no XP, half its gold dropped).

---

## 11. Mobile Interface Rules

- **Portrait layout:** top 55% is the dungeon view; middle strip shows HP/FP bars, torch, and rations; bottom 35% holds the controls.
- **Exploration controls:** a D-pad (forward, back, turn left, turn right, strafe) and a context button that becomes *Open*, *Search*, *Disarm*, or *Descend*.
- **Combat controls:** six large action buttons (Attack, Skills, Items, Defend, Swap, Flee). Tapping *Skills* opens a scrollable list showing FP cost and whether each skill is usable right now.
- **Targeting:** tap an enemy portrait; the Front and Back rows are drawn as two stacked strips.
- **Combat log:** a three-line scrolling text log in classic style ("The ORC swings... and HITS for 7!"), expandable to full screen.
- **Skill tree screen:** four vertical columns (one per Path), with Crossroads nodes drawn between neighboring columns. Locked nodes are dimmed and show their requirements on tap.
- **Saving:** the game saves automatically after every action, including mid-combat, and resumes at the exact moment it was closed. Adventurer has 3 slots; Ironman has one save per character with no reloading.

---

## 12. Implementation Notes

Keep the rules **data-driven** so balance changes don't touch game logic. Suggested shapes:

```json
{
  "id": "power_strike",
  "path": "blade",
  "tier": 1,
  "type": "active",
  "maxRank": 1,
  "cost": { "fp": 2 },
  "requires": { "pathPoints": 0, "attr": null, "skills": [] },
  "effect": { "kind": "attack", "toHit": -2, "extraDice": 1 }
}
```

```json
{
  "id": "spellblade",
  "path": "crossroads",
  "type": "passive",
  "maxRank": 1,
  "requires": { "pathPoints": { "blade": 4, "arcana": 4 } },
  "effect": { "kind": "onHit", "spendFp": { "max": 3, "perFp": "1d6" } }
}
```

```json
{
  "id": "ghoul",
  "hd": 3,
  "row": "front",
  "tags": ["undead"],
  "attacks": [{ "name": "claw", "dmg": "1d6+3", "onHit": { "save": "body", "condition": "paralyzed" } }],
  "floors": [3, 6]
}
```

**Suggested build order:** (1) dice and derived-stat functions, (2) a combat sandbox with one monster, (3) conditions, (4) the skill tree screen and skill effects, (5) dungeon exploration, (6) town and shops, (7) loot and balancing passes.

**Seeded RNG:** use a seeded generator (for example, mulberry32 or sfc32) with separate streams for layout, encounters, combat, and loot, so bugs can be reproduced exactly and reloading can't change luck.
