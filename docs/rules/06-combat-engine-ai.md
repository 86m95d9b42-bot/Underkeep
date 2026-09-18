# UNDERKEEP — Combat Engine & Monster AI
*Companion to the Core Rule Set and Bestiary. The exact order the combat code runs in, how every rule and trait plugs into it, and a behavior script for every monster.*

This document is the **tiebreaker**: if another document's wording is unclear about timing, this one decides.

---

## 1. Engine Principles

1. **Resolve first, animate second.** Each action is fully resolved, then saved (per the Saving rules), then played back as animations and log lines. Closing the app mid-animation changes nothing.
2. **Event hooks.** Skills, traits, conditions, and items don't get special code paths. Each one registers a **hook** on a named event (see *Event Hooks*). The engine fires events in a fixed order.
3. **One source of randomness per system.** Combat uses the combat RNG stream only.
4. **Rounding:** always round **down**. Damage from a hit is at least 1 unless every part of it is Immune. Healing can be 0.

---

## 2. Combat Setup

When an encounter starts:

1. **Build the field.** Place monsters in their rows (Front and Back, up to 4 each), left to right in the order the encounter lists them. Objects (valves, the Phylactery, the Hydra's body) take a Back-row position but don't count toward the **5-enemy crowd cap**.
2. **Apply elite traits** and boss phase 1.
3. **Roll surprise** (d6 each side; see the Core Rule Set and skill modifiers).
   - Only one side surprised: the other side gets a **surprise round** (round 0) in which only it acts.
   - Both or neither surprised: no surprise round.
4. **Record the starting group size** (for morale), not counting objects.
5. **Save**, then show the battle screen.

---

## 3. Round Order

```text
ROUND START
  1. round += 1  (the surprise round is round 0)
  2. Reset per-round reaction flags (Riposte, Arcane Shield, Shield Block, Guardian)
  3. Grimoire turns its page (d6)
  4. Start-of-round effects, in this order:
       Ghast Stench  →  Basilisk Gaze  →  Fallen-troll countdown
  5. Boss phase changes queued last round take effect
  6. Roll initiative and build the turn order

TURNS
  7. Each unit takes its turn in order (see Hero Turn / Monster Turn)
     After every action: check morale triggers, row movement, and combat end

ROUND END
  8. End-of-round effects, in this order:
       Shrieker Shriek  →  Hydra Regrowth  →  Skeleton Reassemble
       →  queued summons and reinforcements arrive  →  Sickened expires
  9. Check combat end
 10. Save
```

### Initiative

1. Each unit rolls **d6 + initiative modifier**. The hero adds AGI mod plus any bonuses. Monsters of the same type share one roll.
2. Sort into three bands, and sort within each band by the roll:
   - **First:** units under *Quicksilver*.
   - **Normal:** everyone else.
   - **Last:** units that are *Slowed*, plus the Zombie, which always acts last.
3. **Ties:** the hero wins. Between monster groups, the higher initiative modifier wins, then a coin flip from the combat stream.
4. **Units that share a roll** act one after another, Front row left to right, then Back row left to right.
5. **New arrivals** (summons, reinforcements) join the turn order at the start of the next round.

---

## 4. The Hero's Turn

```text
TURN START
  1. Hidden check: if Hidden has lasted 2 of your turns, it ends
  2. Defend bonus from your last turn ends
  3. Grit: if you have lost 2 turns in a row, remove Stunned, Asleep,
     Paralyzed, Petrified, and Webbed; you act this turn
  4. Stunned: if Stunned, remove it, start control immunity (2 turns),
     count a lost turn, and skip to TURN END
  5. Start-of-turn damage, in this order:
       Poisoned → Burning → Bleeding → Latched leeches
       → Grip of Winter → Veyra's aura → Colossus heat
  6. Start-of-turn healing:
       Regeneration skill → Ring of Regeneration → Troll Blood
     (any healing ends Bleeding)
  7. Death check (once, after steps 5 and 6)
  8. Helpless check: if Asleep, Paralyzed, or Petrified,
     count a lost turn and skip to TURN END

ACTION
  9. Offer the action menu, with illegal choices dimmed (see Legality)
 10. The hero may use one FREE action before or after the main action
 11. Pay costs (FP, item), then resolve the action
 12. Lost-turn counter resets to 0

TURN END
 13. End-of-turn saves, in this order: Poisoned → Burning → Feared → Paralyzed
 14. Tick durations on your conditions and buffs (see Durations)
 15. Tick control-immunity timers
```

### Action Legality

| Condition or situation | Can't use |
|---|---|
| Feared | Melee attacks and melee skills |
| Webbed | Attack, attack skills, Swap, Flee. **Allowed:** Break Free, Defend, potions and herbs, non-attack skills (Mend, Cleanse) |
| Grabbed | Flee, Swap |
| Blinded, Sickened, Knocked Down | Nothing blocked; they only give disadvantage |
| Anti-Magic Field | Active Arcana and Spirit skills, scrolls |
| Not enough FP | That skill |
| Boss fight, Frozen Revenant present | Flee (Smoke Bomb, Vanish, and Teleport also fail against bosses) |
| No legal target | That action (for example, melee with only Back-row enemies and no Reach) |

### Free Actions

At most **one** per turn: Second Wind, Archmage's free spell, the once-per-combat free Swap, or toggling *Averted Eyes*.

### Break Free (Webbed only)

Uses the action: **d20 + the better of MIG or AGI mod vs. TN 12**. Any fire damage also frees the hero (and deals 1d4).

### Defend

+4 DEF until the start of the hero's next turn. Regain 1 FP immediately. Telegraphed attacks that resolve while the hero is Defending deal half damage, and their saves get advantage.

### Hidden

A new condition, used by Vanish, the Potion of Invisibility, and Whisper:
- Monsters attack the hero with disadvantage.
- The hero's next attack counts for Backstab, Death Strike, and Arcane Trickster.
- Hidden ends when the hero attacks or uses an active skill, or after 2 of the hero's turns.

---

## 5. A Monster's Turn

```text
TURN START
  1. If fleeing (failed morale): leave the field, drop half its gold → TURN END
  2. Stunned: remove it, skip → TURN END
  3. Start-of-turn damage (same order as the hero), then
     start-of-turn healing (Troll regeneration: skipped if the troll
     took fire or holy damage since its last turn)
  4. Death check
  5. Helpless (Asleep, Paralyzed, Petrified): skip → TURN END
  6. Recharge rolls: for each ability that isn't ready, roll d6;
     on 5–6 it becomes ready (4–6 for Vyrmathrax below 10% HP)
  7. Free start-of-turn traits: Bat Swarm Snuff, Brood Mother Egg Sacs

ACTION
  8. If a telegraphed attack is waiting AND the hero has had a turn
     since the wind-up → resolve it
  9. Otherwise run the monster's AI script (Section 11)

TURN END
 10. End-of-turn saves and duration ticks (same as the hero)
```

### Telegraph Timing

1. On the wind-up turn, the monster spends its action announcing the attack in the log. The hero's screen shows a warning icon over the monster.
2. The attack resolves on the monster's **first turn after the hero has had a turn**. This matters because initiative is rerolled every round: without this rule, a monster could wind up after the hero and strike again before the hero could react.
3. If the monster is Stunned, Asleep, Paralyzed, Petrified, or killed before it resolves, the telegraphed attack is **cancelled**.
4. The half-damage check looks at whether the hero is Defending **at the moment it resolves**.

---

## 6. Resolving an Attack

This applies to weapon attacks, attack-roll spells, and monster attacks.

```text
1.  DECLARE        attacker, target, attack type (melee, ranged, spell)
2.  REDIRECT       Guardian (Ashbound Knight) may take the attack instead
3.  LEGALITY       row, reach, submerged, fleeing units, etc.
4.  AUTO-HIT?      Magic Missile, or the target is helpless
                   → skip to step 9 (helpless: roll d20 only to check crits;
                     the hero can never be critically hit while helpless)
5.  ROLL           d20, with advantage/disadvantage (one of each at most; they cancel)
6.  NATURALS       natural 1 → MISS (go to 10)
                   natural 20 → HIT and critical (go to 8)
7.  COMPARE        total = d20 + attack bonus + modifiers
                   target DEF = base + Defend, Slowed −2, Knocked Down −2, etc.
                   total ≥ DEF → HIT, else MISS
                   HIT with a natural roll inside the crit range → critical
8.  DEFENDER       in this order:
    REACTIONS        a) Lucky (hero): force a reroll; go back to step 6
                     b) Arcane Shield (hero) / Shield Block (monster) /
                        Warded affix: add DEF and compare again
                     c) Blink: 50% chance the hit becomes a miss
9.  HIT            go to Damage (Section 7), then On-Hit effects
10. MISS           miss triggers: Riposte (hero, melee misses only)
```

### Attack Modifiers

| Modifier | Applies to |
|---|---|
| −2 Half Cover | Ranged weapon attacks and **spell attacks** against the Back row while any Front-row monster stands. Doesn't affect auto-hit spells or area saves |
| −2 requirement not met | Weapons whose attribute requirement the hero doesn't meet |
| Advantage | Stunned target; hero Asleep/Paralyzed (monsters auto-hit anyway); latched leech; Sorrow vs. a Feared hero; Echolocation in darkness |
| Disadvantage | Blinded, Sickened, Knocked Down (next attack only), Hex, attacking a Hidden hero, *Averted Eyes*, darkness |

### Multiple Attacks

**Juggernaut**, **Twin Shot**, **Volley**, and multi-attack monsters (claws ×2, Hydra heads) resolve each attack completely, including damage and death checks, before the next one begins. If the first attack kills the target, the second may pick a new legal target; otherwise it is lost.

---

## 7. Damage Order of Operations

```text
1.  GATHER DICE      weapon or spell dice
                     + extra dice (Power Strike, Backstab ×2, Spellblade, Smite)
                     + property dice (Flaming, Holy, Ashen Fang)
                     each part keeps its own damage type
2.  CRITICAL         multiply the NUMBER of dice in every part:
                     ×2, or ×3 with Weapon Mastery
3.  ROLL             roll all dice
4.  FLAT BONUSES     add to the weapon's main part:
                     attribute mod + magic bonus + Mighty + Hunter's Tooth
                     + Ram's Horn (crush only) + monster flat bonuses
5.  WEAKENED         attacker Weakened → halve every part of a weapon attack
6.  TARGET TYPE      per part: Immune ×0, Resistant ×½, Weak ×1½
                     (Resistant and Weak together cancel; two Resistances
                     don't stack)
                     Special cases, applied here:
                       • Incorporeal / Gargoyle: physical parts of
                         non-magic weapons are Resistant
                         (Gargoyle: crush ignores this)
                       • Bound Grimoire: fire ×2
                       • Warded Binding: all parts ×½
7.  TELEGRAPH        telegraphed attack vs. a Defending hero: each part ×½
8.  SUM              add the parts
9.  DAMAGE REDUCTION subtract DR once per hit
                     Crush-bearing hits ignore part of it
                     (Animated Armor: all; Colossus: 2)
                     Spirit Ward, Fortified, Forgeheart, Petrified stack
10. MINIMUM          if any part wasn't Immune, the hit deals at least 1
11. TEMPORARY HP     absorbs damage first (Mystic)
12. APPLY            subtract from HP; wake an Asleep target if damage > 0
13. ZERO HP?         go to Section 9
```

**Damage-over-time and aura damage** (Poisoned, Burning, Bleeding, auras, Molten Shell, Heat Aura, Thorned) skip steps 2, 7, and 9. Damage types still matter, so a fire-immune unit ignores Burning.

**Magic Missile:** each missile is its own hit and applies DR separately (still at least 1 each).

---

## 8. On-Hit, On-Kill, and Saves

### On-Hit Effects (after damage, if the target survived)

Resolved in this order:

1. **Condition riders** — Poisoned, Grabbed, Paralyzed, Knocked Down, and so on. Each allows its listed save. A rider is skipped if the target is immune or inside a control-immunity window.
2. **Attacker healing** — Vampiric, Crusader, Mystic.
3. **Target reactions to being hit** — Green Slime Divide, Leech Latch, Pickpocket.
4. **Retaliation against the attacker** — Thorned, Molten Shell, Heat Aura, Corrode.
5. **Grab release** — hitting the monster that grabbed you frees you.

### On-Kill Effects

1. **Death traits** — Martyr's Flame, Rot Bloom, Cursed elite.
2. **Hero triggers** — Cleave (once per turn), Mana Siphon, Whisper.
3. **Morale triggers** — group halved, leader killed.
4. **Row movement** — if the Front row is now empty, non-anchored Back-row monsters step forward immediately.

### Saving Throws

**d20 + save bonus vs. DC.** A natural 20 always succeeds; a natural 1 always fails.

- **Area effects** (Fireball, Sleep, breath) roll a save for each target, left to right.
- **Half-damage saves** halve after step 6 of the damage order.
- **Evasion rank 2:** a successful Reflex save against an area effect means no damage.

---

## 9. Zero HP

### The Hero

1. **Undying** (skill, once per rest) → back to 50% HP.
2. **Phylactery Shard** (once per trip) → back to 50% HP.
3. Otherwise the hero is defeated (Ironman death, or an Adventurer wakes in town).

### Monsters (check in this order)

| Trait | Result |
|---|---|
| Lich *Undying Vessel* | If the Phylactery survives, the Lich becomes *Reforming* (untargetable) and returns at full HP at the start of its next turn |
| Orc *Ferocity* | Once per combat, 1-in-2 chance to stay at 1 HP for one more turn, then it dies |
| Zombie *Relentless* | Once, unless killed by fire, holy damage, or a crit: 1-in-3 chance to rise with 1 HP |
| Troll *Won't Stay Down* | Becomes **Fallen** (see below) |
| Hydra head | Dies and leaves a stump. At round end, the stump regrows two heads unless it was burned (fire, cold, or a torch) during this round |
| Hydra body | The body and every head die |
| Otherwise | The monster dies |

**Fallen Troll:**
- It revives after 3 rounds with 10 HP, unless it's burned first with fire, holy damage, or an Item action using a torch or oil flask.
- The combat **doesn't end** while an unburned troll is Fallen. The log warns: *"The troll's wounds are already closing…"*

### Morale Triggers

Each can happen at most once per monster:
- The encounter is reduced to half or fewer of its starting count (excluding summons).
- The monster drops below 25% HP.
- Its leader dies.

**Roll 2d6.** If the result is higher than the monster's Morale, it's marked **Fleeing** and leaves on its next turn. Morale "—" (mindless) and 12 (fearless) never roll.

---

## 10. Conditions and Durations

### How Durations Count

- Durations count **the affected unit's own turns**. They tick down at the end of that unit's turn.
- A condition applied during the unit's own turn doesn't tick until the end of its next turn.
- **Exceptions:**
  - *Stunned* is removed when it costs the unit a turn.
  - *Sickened* ends at the end of the current round.
  - *Knocked Down* ends after the unit's next attack or at the end of its next turn, whichever comes first.
  - *Weakened* and *Drained* last beyond combat.

### Stacking

- Applying a condition the unit already has **refreshes** the duration to the longer of the two; it doesn't add damage.
- A stronger version **replaces** a weaker one (the Brood Mother's 1d6 poison replaces normal 1d4 poison).
- **Drained** is the only condition that stacks.
- **Buffs:** effects with the same name don't stack with themselves. Different effects stack.

### Control Immunity

When Stunned, Asleep, Paralyzed, Petrified, or Webbed **ends** on the hero, the hero is immune to that same condition for 2 of the hero's turns. The hero's status bar shows a small shield icon with a countdown.

### After Combat

| Condition | After combat |
|---|---|
| Poisoned | Continues as exploration poison (1d4 every 10 steps) |
| Weakened, Drained | Remain |
| Everything else | Ends, including temporary HP, Hidden, and all combat buffs |

---

## 11. Monster AI

### How Scripts Work

Each monster has an **ordered list of rules**. On its turn, the engine checks the rules from the top and runs the **first** one whose condition is true and whose action is legal. The last rule is always a fallback, usually a basic attack.

**Condition vocabulary:**

| Condition | Meaning |
|---|---|
| `ready(X)` | Recharge ability X is ready |
| `unused(X)` | A once-per-combat ability hasn't been used |
| `every(N)` | The round number is a multiple of N |
| `hp < P%` | The monster's own HP is below P% |
| `ally hp < P%` | Any ally's HP is below P% |
| `count(type) < N` | Fewer than N of that monster type are on the field |
| `hero has / lacks C` | The hero has or lacks condition C |
| `hero can be C` | The hero isn't immune to C and isn't inside a control-immunity window |
| `in back row` / `in front row` | The monster's current row |
| `phase = N` | Boss phase |
| `chance(p)` | A roll from the combat stream |

**Monsters don't waste abilities.** A control ability (Sleep, Web, Paralyze, Stun, Fear, Petrify) is only chosen if `hero can be C`. If the hero turns out to be immune to something (from a charm, for example), the monster remembers that for the rest of the fight.

### Difficulty Settings

| Setting | Effect on AI |
|---|---|
| **Easy** | On 25% of turns, a monster just attacks instead of following its script. Monsters may try control abilities the hero is immune to |
| **Normal** | On 10% of turns, a monster just attacks instead |
| **Hard** | Scripts are always followed. Elite chance +5% |

### Archetypes

Most monsters follow one of these patterns:

| Archetype | Pattern |
|---|---|
| **Brute** | Attack |
| **Controller** | Use a control ability if the hero can be affected; otherwise attack |
| **Archer** | Ranged attack from the Back row; weak knife attack if forced forward |
| **Caster** | Strongest spell first, then cheap spells; defensive spell when hurt |
| **Support** | Heal a hurt ally, then buff or debuff, then attack |
| **Thief** | Attack to steal; flee once holding gold |
| **Breather** | Use the recharge ability when ready; otherwise attack |
| **Boss** | Resolve telegraphs, then scheduled abilities, then phase abilities, then attack |

---

## 12. Monster Scripts

### Floor 1 — The Cellars

| Monster | Archetype | Script (first true rule wins) |
|---|---|---|
| Giant Rat | Brute | 1. Bite |
| Kobold | Brute | 1. Spear attack |
| Goblin Archer | Archer | 1. `unused(Volley)` and `count(Goblin Archer) ≥ 2` → **Volley**: every archer fires at +2; this uses the turns of all archers in the group. 2. `in front row` → Knife (−2). 3. Shoot |
| Green Slime | Brute | 1. Attack |
| **The Rat King** | Boss | 1. `every(3)` and `count(Giant Rat) < 4` → **Call the Swarm**. 2. `in back row` → Wait (its passive buff is already active). 3. Bite |

### Floor 2 — The Old Crypt

| Monster | Archetype | Script |
|---|---|---|
| Skeleton | Brute | 1. Attack |
| Zombie | Brute | 1. Attack (Grab rider) |
| Cave Bat Swarm | Brute | *Free at turn start:* 1-in-6 **Snuff** if the hero has a lit torch. 1. Attack |
| Grave Robber | Thief | 1. Holding stolen gold → Flee. 2. Attack (Pickpocket rider) |
| Ghoul | Controller | 1. Attack (Paralyzing Claw rider; Feast bonus if the hero is Paralyzed) |
| **The Bone Warden** | Boss | 1. `hp < 50%` and `unused(Raise)` → **Raise the Fallen**. 2. `every(4)` → wind up **Grave Cleave**. 3. `every(3)` → **Tower Shield**. 4. Attack |

### Floor 3 — Goblin Warrens

| Monster | Archetype | Script |
|---|---|---|
| Orc | Brute | 1. Attack |
| Goblin Shaman | Support | 1. `ally hp < 50%` and heals left → **Mend Kin** on the lowest-HP ally. 2. `unused(Hex)` → **Hex**. 3. Fire spark |
| Worg | Brute | 1. Round 1 → **Pounce**. 2. `unused(Howl)`, `count(Worg) ≥ 2`, and a goblin ally is present → **Howl** (only one worg per fight). 3. Bite |
| Hobgoblin Captain | Brute (leader) | 1. Attack. *Leader* and *Shield Block* are passive |
| **Grukk** | Boss | 1. `every(3)` → wind up **Fire Pot**. 2. Attack. *Royal Temper* (below 50%) and *Coward's Gold* (below 25%) trigger automatically. Coward's Gold pauses combat for the hero's choice |

### Floor 4 — Fungal Caverns

| Monster | Archetype | Script |
|---|---|---|
| Shrieker | — | 1. Wait (its Shriek happens at round end) |
| Myconid Sporecaller | Controller | 1. No myconid has used **Sleep Spores** yet and `hero can be Asleep` → Sleep Spores. 2. Attack |
| Giant Spider | Controller | 1. `ready(Web)` and `hero can be Webbed` → **Web**. 2. Bite |
| Rot Crawler | Controller | 1. Tentacles ×2 |
| **The Brood Mother** | Boss | *Free at turn start:* `every(3)` → **Egg Sacs**. 1. Rounds 2, 6, 10, … and `hero can be Webbed` → wind up **Cocoon**. 2. Bite |
| Spiderling | Brute | 1. Bite |

### Floor 5 — The Drowned Halls

| Monster | Archetype | Script |
|---|---|---|
| Ghast | Controller | 1. Attack (Stench is a start-of-round effect) |
| Lizardfolk Warrior | Brute | 1. Submerged → resurface and attack at +4. 2. `chance(1/6)` → **Submerge**. 3. Even round → spear **and** Tail Sweep. 4. Spear |
| Giant Leech | Brute | 1. Latched → Hold on (no action; it drains at the hero's turn start). 2. Bite (Latch rider) |
| Drowned Dead | Brute | 1. Attack |
| **The Hydra** | Boss | Each head is its own unit on the Hydra's initiative: 1. Bite. The body takes no actions. Regrowth happens at round end |

### Floor 6 — Sanctum of the Pale Flame

| Monster | Archetype | Script |
|---|---|---|
| Cultist | Support / Caster | 1. `unused(Dark Prayer)` and a Front-row ally exists → **Dark Prayer** on the highest-HD ally. 2. **Frost Shard** |
| Zealot | Brute | 1. Attack. *Martyr's Flame* is a death trait |
| Gargoyle | Brute | 1. Airborne → **Dive** (+4), return to the Front row. 2. `hp < 25%` and hasn't flown → **Take Flight** to the Back row. 3. Claws ×2 |
| Ember Hound | Breather | 1. `ready(Flame Breath)` → Flame Breath. 2. Bite |
| **High Priestess Veyra** | Boss | **Phase 1:** 1. `hp < 75%`, a Zealot is alive, and Dark Pact used fewer than 2 times → wind up **Dark Pact** (if the targeted zealot dies first, it fizzles). 2. `every(3)` and `count(Zealot) < 2` → **Summon Zealot**. 3. `hero lacks Slowed` → **Frost Lance**. 4. **Pale Fire**. **Phase 2** (starts on her first turn after dropping below 50%): moves to the Front row. 1. Burning Strike ×2 |

### Floor 7 — The Iron Forge

| Monster | Archetype | Script |
|---|---|---|
| Ogre | Brute | 1. The hero threw gold this round and `chance(2/6)` → grab the gold (turn lost). 2. Club |
| Animated Armor | Brute | 1. Attack |
| Magma Beetle | Brute | 1. Attack |
| Salamander | Controller | 1. `every(3)` and `hero lacks Grabbed` → **Constrict**. 2. Spear |
| **The Forge Colossus** | Boss | 1. `every(3)` → wind up **Hammerfall**. 2. Slam. *Stoke the Furnace* triggers automatically below 50% |

### Floor 8 — The Silent Library

| Monster | Archetype | Script |
|---|---|---|
| Wraith | Brute | 1. Attack (Life Drain rider) |
| Mimic | Brute | 1. Attack (Adhesive rider) |
| Dark Mage | Caster | *Reaction:* **Counterspell** the first hero spell that costs 3+ FP, or any spell once the mage is below 50% HP. 1. `unused(Fireball)` → **Fireball**. 2. `hp < 50%` and `unused(Blink)` → **Blink**. 3. **Magic Missile** |
| Banshee | Controller | 1. `every(3)` and `hero can be Feared` → **Wail**. 2. Touch |
| **The Bound Grimoire** | Boss | 1. Cast this round's page. **Rerolls:** Summon with 3 Ink Wraiths already present, Sleep when the hero can't be put to sleep, or Erase when the hero has no buffs (one reroll per round) |
| Ink Wraith | Brute | 1. Attack |

### Floor 9 — The Frozen Deep

| Monster | Archetype | Script |
|---|---|---|
| Troll | Brute | 1. Claws ×2 |
| Rime Wolf | Breather | 1. `ready(Frost Breath)` → Frost Breath. 2. Bite |
| Frozen Revenant | Brute | 1. Attack (Grip of Winter rider) |
| Frost Giant | Brute | 1. `every(3)` → wind up **Stomp**. 2. Axe |
| **Malgorath the Lich** | Boss | 1. `every(4)` and `count(Frozen Revenant) < 2` → **Raise the Frozen**. 2. `unused(Finger of Death)`, round ≥ 3, and hero HP > 50% → wind up **Finger of Death**. 3. `hp < 60%` → **Drain Life**. 4. `hero can be Paralyzed` and Gaze not used in the last 2 rounds → **Paralyzing Gaze**. 5. `hero lacks Slowed` → **Cone of Cold**. 6. **Drain Life** |

### Floor 10 — The Ashen Lair

| Monster | Archetype | Script |
|---|---|---|
| Drake | Breather | 1. `ready(Flame Spit)` → Flame Spit. 2. `every(3)` → **Wing Buffet**. 3. Bite |
| Ashbound Knight | Brute | *Reaction:* **Guardian**. 1. `every(3)` and `hero can be Stunned` → **Shield Bash**. 2. Sword |
| Basilisk | Controller | 1. Bite (the Gaze is a start-of-round effect) |

**Vyrmathrax the Ashen** uses a state machine rather than a list:

| State | Behavior | Next state |
|---|---|---|
| **Phase 1** | `every(3)` → Tail Sweep; otherwise Bite + Claw | Phase 2 below 66% HP |
| **Phase 2** | On its first turn: **Frightful Presence**, then summon one Ashbound Knight (once). Afterward: `ready(Ash Breath)` → wind up Ash Breath; `every(3)` → Tail Sweep; otherwise Bite + Claw | Phase 3 below 33% HP |
| **Phase 3: Grounded** | Bite + Claw for 2 turns | Takeoff |
| **Phase 3: Takeoff** | Moves to the Back row and winds up Ash Breath (*"It rises, embers glowing"*) | Air 1 |
| **Phase 3: Air 1** | Resolves Ash Breath | Air 2 |
| **Phase 3: Air 2** | Winds up **Dive** | Air 3 |
| **Phase 3: Air 3** | Resolves Dive, lands in the Front row, and becomes Stunned (skips its next turn) | Grounded |

Below 10% HP, Ash Breath recharges on 4–6 and may also be used while Grounded.

### Rare Wanderers and Elites

| Unit | Script |
|---|---|
| Coin Imp | 1. Taunt (no effect). Leaves automatically at the end of round 2 |
| Hollow Stalker | 1. Attack |
| **Arcane** elite | Inserts at the top of its script: every other round → Magic Missile |
| **Swift** elite | Takes an extra basic attack after its action every other round |

---

## 13. Summons and Rows

- **Row capacity:** up to 4 units per row, with **5 enemies total** (objects don't count). A summon that doesn't fit simply fails.
- **Where summons appear:** in the row the ability names, filling the leftmost open spot.
- **XP from summons:** only the **first 4 summoned units** killed in a combat give XP. This stops Rat King and Brood Mother fights from being farmed.
- **Anchored units never step forward:** the Hydra's body, the Phylactery, coolant valves, the Bound Grimoire, and Veyra in phase 1.
- **The Rat King** is anchored only while at least one rat stands.

---

## 14. Fleeing

### The Hero Flees

1. Roll **d20 + AGI mod + LCK mod vs. 10 + the number of living enemies** (objects don't count).
2. **Success:** combat ends. The monsters stay on that tile with their current HP (see *Retreat rule* in the Dungeon document). The hero gets no XP or loot.
3. **Failure:** the **two highest-HD** enemies each make one free attack immediately. They still take their normal turns later in the round.
4. **Automatic escapes** (Smoke Bomb, Vanish, Scroll of Teleport) skip the roll but fail against bosses and Frozen Revenants.

### Monsters Flee

A Fleeing monster leaves on its next turn. It gives no XP and drops half its gold on the tile, which the hero collects after combat.

---

## 15. Ending Combat

Combat ends when:
- no enemies remain (dead, fled, or Fallen trolls that have been burned), **or**
- the hero flees, **or**
- the hero is defeated.

### After a Victory

1. Remove combat-only effects (see *After Combat*).
2. **Post-combat healing:** Bloodstone, then Forager's herb roll.
3. **Award XP** for every defeated monster, including the first 4 summons.
4. **Loot:** each monster's own drops, then one encounter loot roll (Bestiary), plus gold.
5. **Level-up check:** leveling happens **immediately**, showing the level-up screen.
6. **Save**, then return to exploration.

---

## 16. Event Hooks

The engine fires these events in order. Every trait, skill, and item effect is a hook on one of them.

| Event | Fires | Example hooks |
|---|---|---|
| `combatStart` | After setup | Sneak, Statue ambush, Ceiling Drop, Pounce flag |
| `roundStart` | Section 3 steps 1–5 | Ghast Stench, Basilisk Gaze, Grimoire page |
| `turnStart` | Start of any unit's turn | Poison, Burning, Bleeding, Latch, Regeneration, Troll regeneration, auras, recharge rolls |
| `beforeAction` | After the action is chosen | Legality checks, Counterspell, Guardian |
| `attackRoll` | After the d20 | Lucky, Arcane Shield, Shield Block, Blink |
| `hit` / `miss` | After the attack is confirmed | Riposte (miss); riders, Vampiric, Crusader, Divide, Latch, Pickpocket (hit) |
| `damageCalc` | During Section 7 | Crits, Backstab, Weakened, resistances, DR, telegraph halving |
| `damageTaken` | After HP changes | Wake from sleep, Grab release, phase thresholds, morale (below 25%) |
| `zeroHP` | Section 9 | Undying, Phylactery Shard, Ferocity, Relentless, Won't Stay Down, Reform |
| `kill` | After a death | Cleave, Mana Siphon, Whisper, Martyr's Flame, Rot Bloom, row movement, morale |
| `turnEnd` | End of any unit's turn | End-of-turn saves, duration ticks |
| `roundEnd` | Section 3 step 8 | Shriek, Regrowth, Reassemble, summons arrive, Sickened expires |
| `combatEnd` | Section 15 | Bloodstone, Forager, XP, loot |

**Hook priority:** within one event, hooks run in this order: the target's hooks, then the attacker's hooks, then field-wide hooks. Within each group, they run in the order listed in the table above.

---

## 17. Combat Screen Behavior

- **Reaction prompts.** When an enemy attack hits and the hero has Lucky or Arcane Shield available, the game can pause and ask. A setting controls this: **Ask** (default), **Auto** (use when the hit would take more than 25% of max HP), or **Never**.
- **Telegraph warning.** A pulsing icon over the monster, plus the log line. The Defend button glows while a telegraph is pending.
- **Target picker.** Illegal targets are dimmed. Back-row targets show the −2 cover penalty when it applies.
- **Odds display (optional setting).** Shows hit chance on each enemy and save chance on the hero's conditions.
- **Speed setting.** Normal, Fast, or Instant animations. The log always shows everything.

### Auto-Fight (optional)

For routine fights, the player can turn on Auto-Fight. The hero then:
1. drinks a Healing Potion below 30% HP (if one is in a quick slot);
2. otherwise makes a basic Attack on the lowest-HP enemy it can legally target.

**Auto-Fight stops immediately** when a telegraph appears, the hero gains a condition, an elite or boss is present, or HP drops below 30% with no potion left.

---

## 18. Reference Pseudocode

```js
function runCombat(state) {
  setup(state);
  if (state.surpriseSide) runRound(state, { surpriseRound: true });
  while (!combatOver(state)) runRound(state);
  finishCombat(state);
}

function runRound(state, opts = {}) {
  state.round = opts.surpriseRound ? 0 : state.round + 1;
  fire('roundStart', state);
  const order = rollInitiative(state, opts);
  for (const unit of order) {
    if (!unit.alive || combatOver(state)) continue;
    takeTurn(state, unit);
    commitAndSave(state);          // results saved before they're shown
  }
  fire('roundEnd', state);
  commitAndSave(state);
}

function resolveAttack(state, atk) {
  atk = fire('beforeAction', state, atk);       // Guardian, Counterspell, legality
  if (!atk.legal) return;
  if (atk.autoHit) return applyHit(state, atk, rollCritOnly(atk));
  let roll = rollD20(atk.adv);                  // advantage / disadvantage
  let result = judge(roll, atk);                // naturals, total vs DEF, crit
  result = fire('attackRoll', state, atk, result); // Lucky, Arcane Shield, Blink
  if (result.hit) applyHit(state, atk, result);
  else fire('miss', state, atk);                // Riposte
}

function applyHit(state, atk, result) {
  const dmg = calcDamage(state, atk, result);   // Section 7, in order
  dealDamage(state, atk.target, dmg);           // temp HP, HP, wake, thresholds
  if (atk.target.hp <= 0) fire('zeroHP', state, atk.target, atk);
  if (atk.target.alive) fire('hit', state, atk, dmg);
  else fire('kill', state, atk);
}
```
