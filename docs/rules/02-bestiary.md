# UNDERKEEP — Bestiary
*Companion to the Core Rule Set. 38 regular monsters, 10 floor bosses, 2 rare wanderers, elite variants, and encounter tables for all 10 floors.*

---

## 1. Reading a Stat Block

Every monster uses this layout:

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| Hit points | Attack bonus (d20 + this vs. hero DEF) | Target number to hit it | Damage per hit and damage type | Added to its d6 initiative roll | Body / Reflex / Mind save bonus |

Under the table:

- **Header line:** Hit Dice (HD), row (Front or Back), group size, and creature type.
- **Morale:** when the monster's group is cut in half, or the monster drops below 25% HP, roll 2d6. If the roll is **higher** than its Morale, it flees (no XP, but it drops half its gold). **12** means fearless; **—** means mindless and never checks.
- **Res / Weak / Imm:** Resistant takes half damage, Weak takes ×1.5 (round down), Immune takes none or ignores the condition.
- **Traits:** special abilities.
- **Tactics:** how the AI chooses what to do. The exact behavior scripts are in the **Combat Engine & Monster AI** document.
- **Reward:** XP, gold, and drop chances.

---

## 2. Rules This Bestiary Adds

These are also folded into the updated Core Rule Set.

### Damage Types

| Type | Sources |
|---|---|
| Slash | Blade weapons |
| Crush | Blunt weapons, Shield Bash |
| Pierce | Bows, polearms, thrown daggers |
| Fire | Fireball, fire pots, torches, burning |
| Cold | Frost Shard |
| Force | Magic Missile (nothing resists Force) |
| Holy | Smite, Turn Undead |
| Necrotic | Undead touches, life drain |
| Acid | Slimes |
| Poison | Venom, Poisoned condition |

### Telegraphs

Big attacks are announced one turn early in the combat log (for example, *"The Colossus raises its hammer!"*). If the hero chooses **Defend** in response, a telegraphed attack deals **half damage**, and any save it forces is made with **advantage**. Telegraphs are the main skill test in boss fights: they reward reading the log rather than just tapping Attack.

### Row Behavior

A melee-only monster in the Back row can't attack. It waits, or steps forward when there's room in the Front row. Monsters with ranged attacks or spells act normally from the Back row.

### New Conditions

| Condition | Effect | Ends |
|---|---|---|
| Grabbed | Can't Flee or Swap | You hit the grabber, or it dies |
| Knocked Down | −2 DEF and disadvantage on your next attack | End of your next turn |
| Webbed | Can't attack or Flee. Use your action for a MIG or AGI check (TN 12) to break free. Any fire damage frees you but deals 1d4 to you | Breaking free |
| Sickened | Disadvantage on attacks | End of the round |
| Petrified | As Paralyzed, but you gain DR 5 | 2 rounds |

### Solo Hero Protections

All of these monsters are tuned for **one hero**. The Core Rule Set's solo protections apply to every fight: control immunity after recovering, Grit (never more than 2 lost turns in a row), no critical hits against a helpless hero, only 2 free attacks on a failed flee, and a cap of 5 enemies on the field. Summon abilities that would exceed the cap simply fail.

### Torches as Tools

Using a lit torch with the **Item** action cauterizes a Hydra stump or burns a fallen Troll. It counts as fire for those purposes only and uses up the torch. This gives every build, even ones without fire magic, an answer to regenerating monsters.

---

## 3. Monster Math

These formulas replace the ones in the first draft of the rules. Low-level monsters hit softer so a level 1 hero isn't worn down by a single fight, and XP now scales so a hero needs roughly **10 even-level kills per level** throughout the game.

| Stat | Regular monster | Boss |
|---|---|---|
| HP | HD × 5 | HD × 10 early, up to HD × 22 for the final boss |
| ATK | HD + 1 | HD + 1 to HD + 2 |
| DEF | 11 + ⌊HD ÷ 2⌋ | +1 to +3 above normal |
| DMG | 1d6 + ⌊HD ÷ 2⌋ (1d4 at HD 1) | Larger dice; multiple attacks |
| Saves | ⌊HD ÷ 2⌋, shifted by creature type | Higher |
| Effect DC | 10 + ⌊HD ÷ 2⌋ | Listed per ability |
| XP | HD × 10 (×1.5 with a dangerous trait) | About one level's worth (listed) |

**Encounter budget:** total HD ≈ hero level × 1.5 (round up).

### Progression Targets

| Floor | Theme | Hero Level | Typical HD | Boss (HD) |
|---|---|---|---|---|
| 1 | The Cellars | 1–2 | 1 | The Rat King (3) |
| 2 | The Old Crypt | 2–4 | 2–3 | The Bone Warden (5) |
| 3 | Goblin Warrens | 4–5 | 2–4 | Grukk, the Goblin King (6) |
| 4 | Fungal Caverns | 5–7 | 1–4 | The Brood Mother (8) |
| 5 | The Drowned Halls | 7–9 | 3–6 | The Hydra (10) |
| 6 | Sanctum of the Pale Flame | 9–11 | 4–6 | High Priestess Veyra (11) |
| 7 | The Iron Forge | 11–13 | 6–8 | The Forge Colossus (13) |
| 8 | The Silent Library | 13–15 | 8–9 | The Bound Grimoire (14) |
| 9 | The Frozen Deep | 15–17 | 8–12 | Malgorath the Lich (16) |
| 10 | The Ashen Lair | 17–20 | 10–12 | Vyrmathrax the Ashen (15) |

---

## 4. Floor 1 — The Cellars

*Damp storerooms and collapsed wine vaults. This floor teaches the basics: rows, fleeing, and not hitting slimes with swords.*

### Giant Rat
`HD 1 · Front · groups 2–5 · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 4 | +2 | 11 | 1d4 pierce | +2 | 0/1/0 |

- **Morale:** 6
- **Traits:** *Filthy Bite* — on a natural 18–20, the hero makes a Body save (DC 10) or is Weakened until rest.
- **Tactics:** Always attacks. The pack breaks quickly once half of it is dead.
- **Reward:** 10 XP · no gold · 25% rat tail (sells for 1 gp)

### Kobold
`HD 1 · Front · groups 2–4 · humanoid`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 5 | +2 | 12 | 1d4 pierce | +1 | 0/1/0 |

- **Morale:** 7
- **Traits:** *Pack Tactics* — +1 ATK for each other kobold still standing (max +2).
- **Tactics:** Attacks. When it's the last kobold standing, it checks morale immediately.
- **Reward:** 10 XP · 1d6 gp · 15% dagger

### Goblin Archer
`HD 1 · Back · groups 1–3 · humanoid`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 5 | +3 ranged | 12 | 1d4+1 pierce | +1 | 0/1/0 |

- **Morale:** 7
- **Traits:** *Volley* — with two or more archers present, once per combat they all fire together at +2. If forced into the Front row, it fights with a knife at −2.
- **Tactics:** Stays in the Back row. Usually appears behind kobolds or rats.
- **Reward:** 10 XP · 1d8 gp · 10% shortbow

### Green Slime
`HD 1 · Front · single · ooze`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 10 | +1 | 8 | 1d4 acid | −2 | 1/0/0 |

- **Morale:** —
- **Res / Weak / Imm:** Weak to fire and cold · Immune to poison, Asleep, and Feared
- **Traits:** *Divide* — when hit by Slash damage for 5 or more, it splits into two slimes that share its remaining HP (max 4 slimes). *Corrode* — each time a metal weapon hits it, there's a 1-in-6 chance the weapon suffers −1 damage until repaired in town (10 gp).
- **Tactics:** Slowly attacks. A lesson that crush and fire are sometimes better than blades.
- **Reward:** 15 XP · 30% chance it has swallowed 2d10 gp

### 👑 Boss — The Rat King
`HD 3 · Back, then Front · with 2 Giant Rats · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 30 | +4 | 13 | 1d6+1 pierce | +2 | 2/2/1 |

- **Morale:** 12
- **Traits:**
  - *Hiding in the Swarm* — stays in the Back row while any rat stands, where it only squeaks orders (all rats +1 ATK). Once no rats remain, it steps into the Front row and fights.
  - *Call the Swarm* — every 3rd round, 1d3 Giant Rats join the Front row (max 4 rats).
  - *Plague Bite* — on a hit, Body save (DC 11) or Weakened.
- **Tactics:** Ranged attackers and Magic Missile can hit it early. Melee builds have to thin the swarm faster than it refills.
- **Reward:** 100 XP · 3d10 gp · **Ratcatcher's Charm** (charm: immune to disease, +1 LCK)

---

## 5. Floor 2 — The Old Crypt

*Burial niches, cracked sarcophagi, and the first real undead. Blunt weapons and Spirit skills shine here.*

### Skeleton
`HD 2 · Front · groups 2–4 · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 10 | +3 | 13 | 1d6+1 slash | 0 | 1/1/1 |

- **Morale:** —
- **Res / Weak / Imm:** Resistant to slash and pierce · Weak to crush and holy · Immune to poison, Asleep, and Feared
- **Traits:** *Reassemble* — at the end of each round, a destroyed skeleton has a 1-in-6 chance to rise with half HP, unless the killing blow was crush or holy damage.
- **Tactics:** Mindlessly attacks.
- **Reward:** 20 XP · 1d6 gp · 10% short sword · 5% shield

### Zombie
`HD 2 · Front · groups 1–4 · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 16 | +2 | 10 | 1d6+1 crush | −3 | 2/0/1 |

- **Morale:** —
- **Res / Weak / Imm:** Weak to fire and holy · Immune to poison, Asleep, and Feared
- **Traits:** *Grab* — on a hit, Body save (DC 11) or Grabbed. *Relentless* — the first time it drops to 0 HP, it has a 1-in-3 chance to get back up with 1 HP, unless killed by fire, holy damage, or a critical hit.
- **Tactics:** Slow and steady. Always acts last.
- **Reward:** 20 XP · 1d4 gp

### Cave Bat Swarm
`HD 2 · Front · groups 1–2 · swarm`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 10 | +3 | 14 | 1d4 pierce | +3 | 0/3/0 |

- **Morale:** 6
- **Res / Weak / Imm:** Resistant to single-target weapon attacks · Weak to area effects (Fireball, Cleave)
- **Traits:** *Snuff* — each round, a 1-in-6 chance its wings put out the hero's torch (relighting takes the Item action). *Blinding Flurry* — a critical hit Blinds. *Echolocation* — has advantage on attacks while the hero is in darkness.
- **Tactics:** Swarms relentlessly and scatters once hurt.
- **Reward:** 30 XP · no gold

### Grave Robber
`HD 2 · Front · groups 1–3 · human`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 12 | +3 | 13 | 1d6 slash | +2 | 1/3/1 |

- **Morale:** 7
- **Traits:** *Pickpocket* — on a hit, steals 2d10 gp. *Slippery* — on its next turn after stealing, it flees automatically unless Stunned, Grabbed, Asleep, or Slowed. If it escapes, it may reappear later on this floor still carrying the stolen gold.
- **Tactics:** Goes for the purse, not the kill. Killing it returns everything it stole.
- **Reward:** 20 XP · 3d6 gp plus any stolen gold · 20% lockpicks · 10% healing potion

### Ghoul
`HD 3 · Front · groups 1–3 · undead · rare on floor 2, common on floor 5`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 15 | +4 | 13 | 1d6+1 slash | +1 | 2/2/1 |

- **Morale:** —
- **Res / Weak / Imm:** Weak to holy and fire · Immune to poison, Asleep, and Feared
- **Traits:** *Paralyzing Claw* — on a hit, Body save (DC 11) or Paralyzed. *Feast* — deals +1d6 damage to a Paralyzed hero.
- **Tactics:** The classic early-game killer. It's rare on this floor on purpose.
- **Reward:** 45 XP · 2d6 gp

### 👑 Boss — The Bone Warden
`HD 5 · Front · alone · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 50 | +6 | 16 | 1d8+2 slash | 0 | 3/2/3 |

- **Morale:** —
- **Res / Weak / Imm:** Resistant to slash and pierce · Weak to crush and holy · Immune to poison, Asleep, Feared, and Paralyzed
- **Traits:**
  - *Tower Shield* — every 3rd round, it raises its shield for +4 DEF until its next turn (telegraphed). This is a good moment to Defend or use Mend.
  - *Grave Cleave* — every 4th round, a telegraphed overhead blow for 2d8+4.
  - *Raise the Fallen* — the first time it drops below 50% HP, 2 Skeletons rise into the Front row.
- **Tactics:** Punishes players who attack without reading the log.
- **Reward:** 250 XP · 5d10 gp · **Warden's Mace** (+1 mace; grants Turn Undead)

---

## 6. Floor 3 — Goblin Warrens

*Twisting tunnels, cookfires, and an organized enemy. Kill the leaders and support casters first.*

### Orc
`HD 3 · Front · groups 1–4 · humanoid`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 15 | +4 | 13 | 1d6+3 slash | 0 | 2/1/1 |

- **Morale:** 8
- **Traits:** *Ferocity* — once per combat, when reduced to 0 HP, it has a 1-in-2 chance to keep fighting at 1 HP for one more turn.
- **Tactics:** Hits hard, simple.
- **Reward:** 30 XP · 2d8 gp · 5% spear

### Goblin Shaman
`HD 2 · Back · groups 1 · humanoid`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 10 | +3 spell | 12 | 1d6 fire | +1 | 1/1/3 |

- **Morale:** 6
- **Traits:** *Mend Kin* — heals an ally below 50% HP for 2d4 (up to 3 times per combat). *Hex* — once per combat, the hero makes a Mind save (DC 11) or has disadvantage on their next attack.
- **Tactics:** Heal first, then Hex, then fire spark.
- **Reward:** 30 XP · 2d6 gp · 25% healing herb · 10% scroll

### Worg
`HD 3 · Front · groups 1–3 · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 16 | +4 | 13 | 1d6+2 pierce | +3 | 2/2/1 |

- **Morale:** 7
- **Traits:** *Pounce* — in round 1, +2 to hit, and a hit forces a Reflex save (DC 11) or the hero is Knocked Down. *Howl* — with two or more worgs present, once per combat every goblin gets +1 ATK for the rest of the fight.
- **Tactics:** Opens aggressively. Worgs are often paired with goblin groups.
- **Reward:** 45 XP · 20% worg pelt (sells for 10 gp)

### Hobgoblin Captain
`HD 4 · Front · 1 per group · humanoid (leader)`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 24 | +5 | 16 | 1d8+2 slash | 0 | 3/1/2 |

- **Morale:** 10
- **Traits:** *Leader* — while it's alive, all allies use Morale 10 and get +1 ATK. When it dies, all allies check morale immediately. *Shield Block* — once per round, +2 DEF against one attack (automatic).
- **Tactics:** Kill it first to break the group.
- **Reward:** 60 XP · 4d10 gp · 25% chain mail · 20% long sword · 10% +1 weapon

### 👑 Boss — Grukk, the Goblin King
`HD 6 · Front · with 2 Orcs and 2 Goblin Archers · humanoid`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 70 | +7 | 15 | 1d12+3 slash | +1 | 4/2/2 |

- **Morale:** special (see *Coward's Gold*)
- **Traits:**
  - *Fire Pot* — every 3rd round, a telegraphed throw ("The king reaches for a clay pot!") dealing 2d6 fire. Reflex save (DC 13) for half; failing also means Burning.
  - *Royal Temper* — below 50% HP, he gets +2 ATK and +2 damage but −2 DEF.
  - *Coward's Gold* — at 25% HP, he begs for his life and offers a bribe. The player chooses: **accept** 200 gp and he flees (no XP, no unique item), or **refuse** and finish the fight.
- **Tactics:** A good early test of taking out the archers versus pushing straight for the king.
- **Reward:** 400 XP · 6d10+50 gp · **Kingsplitter** (+1 great sword; grants Cleave)

---

## 7. Floor 4 — Fungal Caverns

*Glowing mushrooms, spore clouds, and webs. Status effects become the main threat.*

### Shrieker
`HD 1 · Back · groups 1–2 · fungus`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 10 | — | 8 | — | −5 | 1/0/0 |

- **Morale:** —
- **Res / Weak / Imm:** Weak to fire · Immune to Mind effects
- **Traits:** *Shriek* — at the end of each round, roll d6. On a 1–2, a wandering monster group joins next round (max twice per combat).
- **Tactics:** Does nothing else. Kill it first, or the fight snowballs.
- **Reward:** 15 XP · 30% spore sac (sells for 5 gp)

### Myconid Sporecaller
`HD 3 · Front · groups 1–3 · fungus`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 18 | +4 | 12 | 1d6+1 crush | −1 | 2/0/2 |

- **Morale:** 9
- **Res / Weak / Imm:** Weak to fire · Immune to poison
- **Traits:** *Sleep Spores* — once per combat (the first myconid to act), the hero makes a Mind save (DC 11) or falls Asleep. *Rot Bloom* — when it dies, the hero makes a Body save (DC 11) or is Poisoned.
- **Tactics:** Sleep first, then the rest attack a helpless hero.
- **Reward:** 45 XP · 1d6 gp · 25% healing herb

### Giant Spider
`HD 4 · Front · groups 1–2 · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 22 | +5 | 14 | 1d6+2 pierce | +2 | 2/3/1 |

- **Morale:** 8
- **Res / Weak / Imm:** Weak to fire · Immune to poison
- **Traits:** *Venom* — on a hit, Body save (DC 12) or Poisoned. *Web* — usable when it rolls a 5–6 on a d6 at the start of its turn: Reflex save (DC 12) or Webbed. *Ceiling Drop* — surprises the hero on a 1–3 instead of a 1.
- **Tactics:** Web first, then bite.
- **Reward:** 60 XP · no gold (its lair tile holds 3d10 gp) · 20% spider silk (sells for 15 gp)

### Rot Crawler
`HD 4 · Front · single · aberration`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 26 | +4 ×2 | 13 | 1d4+1 crush each | 0 | 3/1/1 |

- **Morale:** 9
- **Traits:** *Tentacles* — two attacks per turn. Each hit forces a Body save (DC 12) or the hero is Paralyzed.
- **Tactics:** Two chances to lock the hero down each turn. Resilience and Cleanse make this fight much easier.
- **Reward:** 60 XP · 2d10 gp (found in its gut)

### 👑 Boss — The Brood Mother
`HD 8 · Front · with 2 Spiderlings · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 110 | +9 | 16 | 2d6+2 pierce | +2 | 5/4/3 |

**Spiderling** (summon): HD 1 · HP 6 · ATK +2 · DEF 12 · 1d4 pierce · Poison (DC 10) · 5 XP each

- **Morale:** 12
- **Res / Weak / Imm:** Weak to fire · Immune to poison
- **Traits:**
  - *Potent Venom* — on a hit, Body save (DC 14) or Poisoned, taking 1d6 per turn instead of 1d4.
  - *Egg Sacs* — every 3rd round, 1d3 Spiderlings hatch (max 4).
  - *Cocoon* — on rounds 2, 6, 10, and so on, telegraphed ("She rears back, spinnerets glistening"). Next turn, Reflex save (DC 14) or the hero is Webbed and takes 1d6 poison each turn while stuck.
- **Tactics:** Fireball and Cleave clear the spiderlings. Single-target builds should save Focus for the Mother herself.
- **Reward:** 600 XP · 8d10+100 gp · **Silkweave Cloak** (armor: DEF +3, no penalties; grants Evasion rank 1)

---

## 8. Floor 5 — The Drowned Halls

*Flooded tombs and sunken corridors. Undead return in force, joined by things from the water.*

### Ghast
`HD 6 · Front · groups 1–2, often with Ghouls · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 30 | +7 | 15 | 1d8+3 slash | +1 | 4/3/3 |

- **Morale:** —
- **Res / Weak / Imm:** Weak to holy and fire · Immune to poison, Asleep, and Feared
- **Traits:** *Stench* — at the start of each round, Body save (DC 13) or the hero is Sickened. *Paralyzing Claw* — on a hit, Body save (DC 13) or Paralyzed.
- **Tactics:** The Ghoul's big brother. Its stench makes the claw harder to avoid.
- **Reward:** 90 XP · 3d10 gp · 15% +1 weapon

### Lizardfolk Warrior
`HD 5 · Front · groups 2–3 · humanoid`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 28 | +6 | 15 | 1d8+2 pierce | 0 | 3/2/2 |

- **Morale:** 9
- **Res / Weak / Imm:** Weak to cold (any cold damage also Slows it)
- **Traits:** *Tail Sweep* — every other round, an extra 1d6 crush attack; a hit forces a Reflex save (DC 12) or Knocked Down. *Submerge* — each round, a 1-in-6 chance it dives and can't be targeted, then returns next round with +4 to hit.
- **Tactics:** Disciplined fighters with an unpredictable dive.
- **Reward:** 75 XP · 3d8 gp · 20% spear · 10% shield

### Giant Leech
`HD 4 · Front · groups 1–3 · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 22 | +5 | 11 | 1d4 pierce | −1 | 2/0/0 |

- **Morale:** —
- **Res / Weak / Imm:** Weak to fire
- **Traits:** *Latch* — on a hit, it attaches. At the start of each of the hero's turns, the hero takes 1d6 and the leech heals that much, until the leech dies or the hero uses an action and passes a MIG check (TN 12) to pull it off. Attacks against a latched leech have advantage.
- **Tactics:** Weak alone, dangerous in groups.
- **Reward:** 60 XP

### Drowned Dead
`HD 5 · Front · groups 2–4 · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 36 | +5 | 12 | 1d8+2 crush | −3 | 4/0/2 |

- **Morale:** —
- **Res / Weak / Imm:** Resistant to fire (waterlogged) · Weak to holy · Immune to poison, Asleep, and Feared
- **Traits:** *Waterlogged Grip* — on a hit, Body save (DC 12) or Slowed. *Drag Under* — deals +1d6 against a hero who is already Slowed.
- **Tactics:** Slow, tough, and wears the hero down.
- **Reward:** 75 XP · 2d6 gp

### 👑 Boss — The Hydra
`HD 10 · Body in Back row, Heads in Front row · beast`

| Part | HP | ATK | DEF | DMG |
|---|---|---|---|---|
| Body | 60 | — | 16 | — |
| Head (starts with 3, max 5) | 15 each | +9 | 15 | 1d8+3 pierce |

Body saves 6/3/3 · Init +1

- **Morale:** 12
- **Traits:**
  - *Many Heads* — each living head attacks once per round.
  - *Regrowth* — when a head dies, two heads grow back at the end of the round (max 5), unless the stump took fire or cold damage that round, or the hero used a lit torch on it (see *Torches as Tools*).
  - *Shielded Body* — the Body can't be targeted in melee while 3 or more heads live. Ranged attacks and spells can hit it at any time (with the usual −2 Half Cover). Killing the Body kills every head.
- **Tactics:** Cutting heads blindly makes things worse. The hero should bring torches or a fire or cold source, or go straight for the Body with ranged attacks.
- **Reward:** 800 XP · 10d10+200 gp · **Hydra Fang** (+2 spear; a critical hit Poisons)

---

## 9. Floor 6 — Sanctum of the Pale Flame

*A cult's temple of white fire. Enemies work together, and some punish careless kills.*

### Cultist
`HD 4 · Back · groups 2–3 · human`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 20 | +5 spell | 12 | 2d6 cold | 0 | 2/2/3 |

- **Morale:** 7
- **Traits:** *Frost Shard* — on a hit, Reflex save (DC 12) or Slowed. *Dark Prayer* — once per combat, grants an ally +2 ATK for the rest of the fight.
- **Tactics:** Buffs zealots first, then fires shards. Flees below 25% HP.
- **Reward:** 60 XP · 3d8 gp · 20% scroll · 20% focus tonic

### Zealot
`HD 5 · Front · groups 1–3 · human`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 26 | +6 | 13 | 1d8+2 slash | +1 | 3/2/4 |

- **Morale:** 12
- **Res / Weak / Imm:** Immune to Feared
- **Traits:** *Martyr's Flame* — below 25% HP, it begins to glow (shown in the log). When it dies, it explodes for 2d6 fire (Reflex save, DC 12, for half), **unless** the killing blow was cold damage.
- **Tactics:** Charges in without fear. Frost Shard users can finish zealots safely.
- **Reward:** 75 XP · 2d10 gp

### Gargoyle
`HD 6 · Front · groups 1–2 · construct`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 32 | +7 ×2 | 17 | 1d6+2 slash each | +1 | 4/3/2 |

- **Morale:** 12
- **Res / Weak / Imm:** Resistant to non-magic weapons (except crush damage, which ignores this) · Immune to poison, Asleep, and Paralyzed
- **Traits:** *Statue* — surprises the hero on a 1–4, unless the hero has Keen Senses. *Take Flight* — below 25% HP, it flies into the Back row, then dives next round at +4 to hit.
- **Tactics:** By this floor the hero should own at least one +1 weapon.
- **Reward:** 90 XP · 10% gemstone (worth 50 gp)

### Ember Hound
`HD 6 · Front · groups 2 · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 30 | +7 | 15 | 1d8+3 pierce + 1d4 fire | +3 | 3/4/2 |

- **Morale:** 9
- **Res / Weak / Imm:** Immune to fire · Weak to cold
- **Traits:** *Flame Breath* — usable when it rolls a 5–6 on a d6 at the start of its turn: 3d6 fire, Reflex save (DC 13) for half, and Burning on a failed save.
- **Tactics:** Fast, and the breath can come from both hounds in the same round.
- **Reward:** 90 XP · 25% ember heart (sells for 40 gp)

### 👑 Boss — High Priestess Veyra
`HD 11 · Back (Phase 1), Front (Phase 2) · with 2 Zealots · human`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 150 | +10 spell / +12 melee | 17 | varies | +2 | 5/5/8 |

- **Morale:** 12
- **Res / Weak / Imm:** Weak to holy · Immune to fire in Phase 2
- **Phase 1 (100–50% HP)** — each round she chooses one:
  - *Pale Fire:* 4d6 fire, Reflex save (DC 15) for half.
  - *Frost Lance:* 3d8 cold, and the hero is Slowed.
  - *Summon Zealot:* every 3rd round, if fewer than 2 zealots remain.
  - *Dark Pact:* up to twice per combat, once she's below 75% HP, telegraphed ("She reaches toward her faithful"). Next turn she sacrifices a zealot, which doesn't explode, and heals 30 HP. Killing that zealot first denies the heal.
- **Phase 2 (below 50% HP)** — *Ascension:* she steps into the Front row and stops summoning. She makes two burning strikes per turn (2d6+4 fire), and the hero takes 1d6 fire at the start of each of their turns from her aura.
- **Tactics:** A war of attrition in Phase 1, then a damage race in Phase 2. Save potions for the second half.
- **Reward:** 1,000 XP · 12d10+300 gp · **Pale Flame Staff** (+2 staff; +4 max FP; grants Fireball)

---

## 10. Floor 7 — The Iron Forge

*Rivers of slag and hammering machinery. Enemies are armored, and many punish melee contact.*

### Ogre
`HD 7 · Front · groups 1–2 · giant`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 45 | +8 | 14 | 2d6+6 crush | −1 | 5/1/2 |

- **Morale:** 8
- **Traits:** *Crushing Blow* — a critical hit also Knocks Down and Stuns. *Greedy* — the hero can throw 50 gp as an Item action; there's a 2-in-6 chance the ogre stops to grab it and loses its turn.
- **Tactics:** Huge hits, low accuracy against a well-armored hero.
- **Reward:** 105 XP · 5d10 gp · 20% greater healing potion

### Animated Armor
`HD 7 · Front · groups 1–3 · construct`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 35 | +8 | 19 | 1d10+3 slash | 0 | 4/1/— |

- **Morale:** —
- **Res / Weak / Imm:** DR 2 (crush damage ignores it) · Immune to poison and all conditions except Knocked Down and Slowed
- **Traits:** *Empty Shell* — no vital organs, so Backstab and Death Strike deal only normal damage.
- **Tactics:** A hard wall for rogue builds. Magic and blunt weapons work best.
- **Reward:** 105 XP · 10% +1 armor

### Magma Beetle
`HD 6 · Front · groups 2–3 · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 30 | +7 | 17 | 1d8+3 pierce (fire) | 0 | 4/2/1 |

- **Morale:** 9
- **Res / Weak / Imm:** Immune to fire · Weak to cold (while Slowed, it also loses 4 DEF)
- **Traits:** *Molten Shell* — each time a metal melee weapon hits it, the hero takes 1d4 fire.
- **Tactics:** Punishes melee. Spells and bows avoid the shell.
- **Reward:** 90 XP · 20% magma gland (sells for 30 gp)

### Salamander
`HD 8 · Front · groups 1–2 · elemental`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 44 | +9 | 16 | 1d8+4 pierce + 1d6 fire | +2 | 4/4/4 |

- **Morale:** 9
- **Res / Weak / Imm:** Immune to fire · Weak to cold
- **Traits:** *Heat Aura* — each time the hero hits it in melee, the hero takes 1d6 fire. *Constrict* — every 3rd round, a tail attack; a hit means Grabbed, and the hero takes 1d6 fire each turn while held.
- **Tactics:** The strongest regular enemy on this floor.
- **Reward:** 120 XP · 4d10 gp · 20% +1 spear

### 👑 Boss — The Forge Colossus
`HD 13 · Front · with 2 Coolant Valves in the Back row · construct`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 220 | +12 | 18 | 2d10+6 crush | −2 | 8/2/— |

**Coolant Valve** (object, ×2): HP 10 · DEF 10 · no attacks

- **Morale:** —
- **Res / Weak / Imm:** DR 4 (crush damage ignores 2 of it) · Immune to fire, poison, and all Mind conditions and Paralyzed · Weak to cold (cold damage also Slows it and removes its DR for 1 round)
- **Traits:**
  - *Hammerfall* — every 3rd round, telegraphed ("The Colossus raises its hammer!"): 6d8 crush.
  - *Stoke the Furnace* — below 50% HP, it glows red: +1d6 fire on every hit, and the hero takes 1d4 fire each round from the heat.
  - *Coolant Valves* — breaking a valve Stuns the Colossus for 1 round and ends Stoke the Furnace. Each valve works once.
- **Tactics:** Smart players save the valves for Phase 2 and the Stun for right before a Hammerfall.
- **Reward:** 1,300 XP · 15d10+400 gp · **Forgeheart Plate** (+2 plate; DR 1; no spell fizzle)

---

## 11. Floor 8 — The Silent Library

*Endless shelves, whispering dark, and enemies that attack the mind and drain the body.*

### Wraith
`HD 8 · Front · groups 1–2 · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 36 | +9 | 16 | 1d8+4 necrotic | +2 | 4/4/5 |

- **Morale:** —
- **Res / Weak / Imm:** Resistant to non-magic weapons (incorporeal) · Weak to holy · Immune to poison, Asleep, Feared, and Paralyzed
- **Traits:** *Life Drain* — on a hit, Body save (DC 14) or Drained. *Through the Walls* — surprises the hero on a 1–3.
- **Tactics:** The most feared regular monster. Drain stacks only go away at the temple or with a full rest in town.
- **Reward:** 120 XP · 20% ectoplasm (sells for 50 gp)

### Mimic
`HD 8 · Front · single · aberration`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 50 | +9 | 15 | 2d6+4 crush | 0 | 5/1/3 |

- **Morale:** 12
- **Traits:** *Disguise* — looks exactly like a treasure chest. Opening it gives the mimic a free surprise round, unless the hero inspected the chest first (see the chest sequence in **Traps, Locks & Treasure**): a successful Search against TN 18 reveals it, and the Lore skill reveals it automatically. *Adhesive* — on a hit, the hero is Grabbed.
- **Tactics:** Teaches players that searching before opening is worth the extra tap.
- **Reward:** 120 XP · 5d10 gp · a guaranteed Uncommon item (the real treasure inside it)

### Dark Mage
`HD 8 · Back · with 1–2 Animated Armors or Cultists · human`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 36 | +9 spell | 14 | varies | +1 | 3/3/6 |

- **Morale:** 8
- **Traits:**
  - *Magic Missile* — 3 missiles, each 1d4+1 force, never miss.
  - *Fireball* — once per combat: 6d6 fire, Reflex save (DC 14) for half.
  - *Blink* — below 50% HP, attacks against it have a 50% chance to miss for 3 rounds.
  - *Counterspell* — once per combat, cancels one of the hero's spells (the FP is still spent).
- **Tactics:** Opens with Fireball and keeps its guards in front.
- **Reward:** 120 XP · 6d10 gp · 30% scroll · 15% focus tonic · 10% +1 staff

### Banshee
`HD 9 · Front · single · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 40 | +10 | 16 | 1d8+4 necrotic | +2 | 4/4/6 |

- **Morale:** —
- **Res / Weak / Imm:** Resistant to non-magic weapons (incorporeal) · Weak to holy · Immune to poison, Asleep, Feared, and Paralyzed
- **Traits:** *Wail* — every 3rd round: Mind save (DC 14) or Feared for 2 rounds. Failing by 5 or more also deals 3d6 necrotic. *Sorrow* — has advantage on attacks against a Feared hero.
- **Tactics:** Fear shuts down melee builds. Resilience, Cleanse, and ranged attacks are the counters.
- **Reward:** 135 XP · 20% silver locket (charm: +2 to Mind saves)

### 👑 Boss — The Bound Grimoire
`HD 14 · Back · with 2 Ink Wraiths · construct`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 200 | +11 spell | 17 | varies | +1 | 6/5/10 |

**Ink Wraith** (summon): HD 6 · HP 20 · ATK +7 · DEF 14 · 1d8+3 necrotic · incorporeal · 30 XP each

- **Morale:** —
- **Res / Weak / Imm:** Takes **double** fire damage (it's paper) · Immune to poison and Mind conditions
- **Traits:**
  - *Turn the Page* — at the start of each round, it rolls d6 for the page it casts:

    | d6 | Page |
    |---|---|
    | 1 | Magic Missile ×5 (1d4+1 force each) |
    | 2 | Fireball: 8d6 fire, Reflex save (DC 16) for half |
    | 3 | Sleep: Mind save (DC 15) or Asleep |
    | 4 | Summon 2 Ink Wraiths (max 3) |
    | 5 | Frost Lance: 4d8 cold, and the hero is Slowed |
    | 6 | Erase: removes one of the hero's active buffs and drains 1d6 FP |

  - *Read Ahead* — a hero with Lore or INT 15+ sees the next page one round early, which effectively telegraphs it.
  - *Warded Binding* — takes half damage while any Ink Wraith stands.
- **Tactics:** Clear the wraiths, then burn the book. Intellect builds get a real advantage here.
- **Reward:** 1,500 XP · 16d10+500 gp · **The Unbound Page** (charm: +3 max FP; grants Blink)

---

## 12. Floor 9 — The Frozen Deep

*Ice caverns under the world. Big bodies, regeneration, and cold that slows everything.*

### Troll
`HD 9 · Front · groups 1–2 · giant`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 60 | +10 ×2 | 15 | 1d8+4 slash each | +1 | 6/2/2 |

- **Morale:** 10
- **Res / Weak / Imm:** Weak to fire
- **Traits:** *Regeneration* — heals 5 HP per round, unless it took fire or holy damage that round. *Won't Stay Down* — at 0 HP it falls, then gets back up after 3 rounds with 10 HP, unless it's burned with fire, holy damage, or a lit torch (see *Torches as Tools*).
- **Tactics:** A classic. Players who forget to burn the body get a nasty surprise.
- **Reward:** 135 XP · 5d10 gp · 20% troll blood (potion: regenerate 3 HP per turn for one combat)

### Rime Wolf
`HD 8 · Front · groups 2–3 · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 40 | +9 | 16 | 1d10+4 pierce | +3 | 4/5/2 |

- **Morale:** 8
- **Res / Weak / Imm:** Immune to cold · Weak to fire
- **Traits:** *Frost Breath* — usable when it rolls a 5–6 on a d6 at the start of its turn: 4d6 cold, Reflex save (DC 14) for half, and Slowed on a failed save. *Pack* — +1 ATK for each other wolf. *Hamstring* — a critical hit Slows.
- **Tactics:** Fast pack hunters that often escort Frost Giants.
- **Reward:** 120 XP · 20% rime pelt (sells for 40 gp)

### Frozen Revenant
`HD 10 · Front · groups 1–2 · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 50 | +11 | 17 | 1d10+5 cold | 0 | 6/3/5 |

- **Morale:** —
- **Res / Weak / Imm:** Weak to fire and holy · Immune to cold, poison, Asleep, Feared, and Paralyzed
- **Traits:** *Grip of Winter* — on a hit, Body save (DC 15) or Slowed and taking 1d6 cold per turn for 2 rounds. *Grudge* — the hero can't Flee from it.
- **Tactics:** Relentless and can't be escaped. The hero has to commit to the fight.
- **Reward:** 150 XP · 6d10 gp · 15% +2 armor

### Frost Giant
`HD 12 · Front · single, sometimes with 2 Rime Wolves · giant`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 80 | +13 | 17 | 2d10+6 slash | −1 | 8/3/4 |

- **Morale:** 10
- **Res / Weak / Imm:** Immune to cold · Weak to fire
- **Traits:** *Stomp* — every 3rd round, telegraphed ("The giant lifts its foot!"): 4d10 crush, and the hero is Knocked Down.
- **Tactics:** Big, readable, and punishing for a hero who doesn't Defend on cue.
- **Reward:** 180 XP · 8d10 gp · 25% +2 weapon

### 👑 Boss — Malgorath the Lich
`HD 16 · Back · with 2 Frozen Revenants and the Phylactery · undead`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 180 | +12 spell | 18 | varies | +2 | 8/8/12 |

**Phylactery** (object, Back row): HP 60 · DEF 10 · takes half damage while the Lich is alive · no attacks

- **Morale:** —
- **Res / Weak / Imm:** Weak to holy · Immune to cold, poison, Asleep, Feared, and Paralyzed
- **Traits:**
  - *Finger of Death* — once per combat, telegraphed ("Malgorath points at you and speaks your name"). Next turn, Body save (DC 18) or drop to 1 HP; on a success, take 6d6 necrotic instead.
  - *Cone of Cold* — 8d6 cold, Reflex save (DC 17) for half, and Slowed on a failed save.
  - *Drain Life* — 4d8 necrotic, and the Lich heals the same amount.
  - *Paralyzing Gaze* — Mind save (DC 16) or Paralyzed.
  - *Raise the Frozen* — every 4th round, refills the Front row to 2 Revenants.
  - *Undying Vessel* — if the Lich reaches 0 HP while the Phylactery survives, it re-forms at full HP next round. This repeats every time.
- **Tactics:** The real target is the Phylactery. Players can chip at it throughout (at half damage) or finish it in the round right after the Lich falls, when it takes full damage.
- **Reward:** 1,800 XP · 20d10+800 gp · **Phylactery Shard** (charm: grants Undying, but only once per trip into the dungeon)

---

## 13. Floor 10 — The Ashen Lair

*A volcanic cavern of scorched bones and a hoard beyond counting. The dragon's servants guard the way.*

### Drake
`HD 10 · Front · groups 1–2 · dragon`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 60 | +11 | 17 | 2d8+5 pierce | +2 | 6/5/4 |

- **Morale:** 9
- **Res / Weak / Imm:** Immune to fire
- **Traits:** *Flame Spit* — usable when it rolls a 5–6 on a d6 at the start of its turn: 5d6 fire, Reflex save (DC 15) for half. *Wing Buffet* — every 3rd round, Reflex save (DC 15) or Knocked Down.
- **Tactics:** A small preview of the boss.
- **Reward:** 150 XP · 30% dragon scale (sells for 100 gp)

### Ashbound Knight
`HD 12 · Front · groups 1–2 · human`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 75 | +13 | 20 | 2d8+6 slash + 1d6 fire | 0 | 8/3/6 |

- **Morale:** 12
- **Res / Weak / Imm:** Resistant to fire
- **Traits:** *Guardian* — once per round, when the hero targets a Back-row ally, the knight intercepts and takes the attack instead. *Shield Bash* — every 3rd round, Body save (DC 16) or Stunned.
- **Tactics:** Protects the dragon's casters. Area spells get around Guardian.
- **Reward:** 180 XP · 10d10 gp · 25% +2 long sword or +2 plate

### Basilisk
`HD 11 · Front · single · beast`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 70 | +12 | 17 | 2d8+5 pierce | −1 | 7/2/5 |

- **Morale:** 9
- **Traits:** *Petrifying Gaze* — at the start of each round, Body save (DC 16) or Petrified. The save is skipped if the hero is Defending or has *Averted Eyes*. *Averted Eyes* — a toggle in the hero's combat menu: immune to the gaze, but disadvantage on attacks.
- **Tactics:** A pure decision puzzle: take the gaze risk, or fight half-blind.
- **Reward:** 165 XP · 6d10 gp · 20% basilisk eye (charm: immune to Petrified)

### 👑 Final Boss — Vyrmathrax the Ashen
`HD 15 · Front (sometimes Back) · alone · dragon`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| 330 | +15 ×2 | 20 | Bite 2d10+7 pierce · Claw 2d6+7 slash | +2 | 10/7/9 |

- **Morale:** —
- **Res / Weak / Imm:** Immune to fire, Asleep, Feared, and Paralyzed · Weak to cold
- **Phase 1 (100–66% HP):**
  - Bite and Claw every turn.
  - *Tail Sweep* — every 3rd round: 2d8+7 crush, Reflex save (DC 17) or Knocked Down.
- **Phase 2 (66–33% HP):**
  - *Frightful Presence* — when the phase begins, Mind save (DC 17) or Feared for 2 rounds.
  - *Ash Breath* — recharges on a 5–6 on a d6. Telegraphed ("Embers glow between its teeth"): 10d6 fire, Reflex save (DC 18) for half, and Burning on a failed save. Defending halves the damage again.
  - Summons 1 Ashbound Knight, once.
- **Phase 3 (below 33% HP):**
  - *Take Wing* — flies into the Back row for 2 rounds, where only ranged attacks, spells, and Reach weapons can hit it. It uses Ash Breath from the air.
  - *Dive* — telegraphed: 12d6 crush. It then lands in the Front row and is Stunned for 1 round, which is the hero's big damage window. The cycle repeats.
  - *Last Fury* — below 10% HP, Ash Breath recharges on a 4–6.
- **Tactics:** Tests everything the game has taught: reading telegraphs, managing conditions, and saving Focus for the stun window.
- **Reward:** 2,500 XP · 50d10+5,000 gp · **Ashen Fang** (+3 long sword; +1d6 fire on every hit) · **the ending**

---

## 14. Rare Wanderers (any floor)

### Coin Imp
`HD = floor · Front · single · fiend`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| floor × 4 | — | 14 + ⌊floor ÷ 2⌋ | — | +5 | floor/floor/floor |

- **Appears:** 1 in 50 encounters.
- **Traits:** Never attacks. It jingles, taunts, and **flees automatically at the end of round 2.** Immune to Asleep.
- **Tactics:** A burst-damage check. A hero who has saved Focus get rewarded.
- **Reward:** floor × 10 XP · floor × 50 gp · 25% Uncommon item

### The Hollow Stalker
`HD = floor + 6 · Front · single · unknown`

| HP | ATK | DEF | DMG | Init | Saves B/R/M |
|---|---|---|---|---|---|
| (floor + 6) × 8 | floor + 8 | 14 + floor | 2d8 + floor necrotic | +4 | high/high/immune |

- **Appears:** when the hero spends more than **1,500 steps** on one floor. The log warns at 1,000 steps ("You feel watched") and at 1,250 ("Something follows your footsteps"). The step count resets on changing floors.
- **Res / Weak / Imm:** Immune to all Mind conditions, Asleep, and Paralyzed
- **Traits:** The hero can Flee from it, but it returns after 100 steps until the hero leaves the floor.
- **Purpose:** An anti-grinding pressure, in the spirit of Rogue's hunger clock. Players who beat it early have earned it.
- **Reward:** triple normal XP for its HD · a guaranteed Rare item

---

## 15. Elite Monsters

Each non-boss encounter has a **10% + (2% × floor)** chance that one monster is **Elite**. Elites have their name shown in gold, **double HP**, **double XP**, and a guaranteed drop roll. Roll d12 for the elite trait:

| d12 | Trait | Effect |
|---|---|---|
| 1 | Hulking | +2 damage and an extra +25% HP |
| 2 | Swift | +4 Init; an extra attack every other round |
| 3 | Venomous | Hits Poison (monster's DC) |
| 4 | Blazing | +1d6 fire on hits; immune to fire |
| 5 | Frostbound | +1d6 cold on hits; a critical hit Slows; immune to cold |
| 6 | Vampiric | Heals half the damage it deals |
| 7 | Ironhide | DR 3 |
| 8 | Arcane | Casts Magic Missile every other round (1 missile per 3 HD) |
| 9 | Warded | Once per round, +4 DEF against one attack after it hits |
| 10 | Berserker | Below 50% HP: +3 ATK, +3 damage, −3 DEF |
| 11 | Cursed | When it dies, the hero makes a Mind save or is Weakened |
| 12 | Gilded | Triple gold and a guaranteed Uncommon or better item |

---

## 16. Encounter Tables

Roll d12 when a wandering monster check succeeds. On a **12**, roll d6: a 1 means a **Coin Imp**; otherwise, roll again on the table and make one monster **Elite** automatically.

### Floor 1 — The Cellars
| d12 | Encounter |
|---|---|
| 1–3 | 2–4 Giant Rats |
| 4–5 | 2–3 Kobolds |
| 6–7 | 2 Kobolds + 1 Goblin Archer |
| 8–9 | 1 Green Slime |
| 10 | 2 Giant Rats + 1 Green Slime |
| 11 | 1 Kobold + 2 Goblin Archers |

### Floor 2 — The Old Crypt
| d12 | Encounter |
|---|---|
| 1–3 | 2–3 Skeletons |
| 4–5 | 2–3 Zombies |
| 6–7 | 1 Cave Bat Swarm |
| 8 | 1–2 Grave Robbers |
| 9 | 2 Skeletons + 1 Zombie |
| 10 | 1 Grave Robber + 1 Cave Bat Swarm |
| 11 | 1 Ghoul |

### Floor 3 — Goblin Warrens
| d12 | Encounter |
|---|---|
| 1–3 | 1–2 Orcs + 1 Goblin Archer |
| 4–5 | 1 Worg + 2 Kobolds |
| 6–7 | 2 Orcs + 1 Goblin Shaman |
| 8 | 2 Worgs |
| 9 | 1 Hobgoblin Captain + 1 Orc + 1 Goblin Archer |
| 10 | 1 Hobgoblin Captain + 2 Goblin Archers |
| 11 | 1 Orc + 1 Worg + 1 Goblin Shaman |

### Floor 4 — Fungal Caverns
| d12 | Encounter |
|---|---|
| 1–2 | 2 Myconid Sporecallers |
| 3–4 | 1 Giant Spider |
| 5 | 1 Rot Crawler |
| 6–7 | 1 Myconid Sporecaller + 1 Shrieker |
| 8 | 1 Giant Spider + 1 Shrieker |
| 9 | 2 Giant Spiders |
| 10 | 3 Myconid Sporecallers |
| 11 | 1 Rot Crawler + 1 Myconid Sporecaller |

### Floor 5 — The Drowned Halls
| d12 | Encounter |
|---|---|
| 1–2 | 2–3 Ghouls |
| 3–4 | 2 Lizardfolk Warriors |
| 5 | 2–3 Giant Leeches |
| 6–7 | 2 Drowned Dead |
| 8 | 1 Ghast + 1 Ghoul |
| 9 | 2 Lizardfolk Warriors + 1 Giant Leech |
| 10 | 1 Ghast + 1 Drowned Dead |
| 11 | 2 Ghasts |

### Floor 6 — Sanctum of the Pale Flame
| d12 | Encounter |
|---|---|
| 1–2 | 1 Zealot + 2 Cultists |
| 3–4 | 2 Zealots + 1 Cultist |
| 5 | 1 Gargoyle |
| 6–7 | 2 Ember Hounds |
| 8 | 1 Gargoyle + 1 Cultist |
| 9 | 1 Ember Hound + 1 Zealot + 1 Cultist |
| 10 | 2 Gargoyles |
| 11 | 2 Ghasts (a crypt beneath the temple) |

### Floor 7 — The Iron Forge
| d12 | Encounter |
|---|---|
| 1–2 | 1 Ogre + 1 Magma Beetle |
| 3–4 | 2 Animated Armors |
| 5–6 | 2–3 Magma Beetles |
| 7 | 1 Salamander |
| 8 | 2 Ogres |
| 9 | 1 Salamander + 1 Magma Beetle |
| 10 | 3 Animated Armors |
| 11 | 1 Ogre + 1 Salamander |

### Floor 8 — The Silent Library
| d12 | Encounter |
|---|---|
| 1–2 | 1 Wraith |
| 3–4 | 1 Dark Mage + 1 Animated Armor |
| 5 | 1 Banshee |
| 6–7 | 1 Mimic (appears as a chest on the next tile) |
| 8 | 2 Wraiths |
| 9 | 1 Dark Mage + 2 Animated Armors |
| 10 | 1 Banshee + 1 Wraith |
| 11 | 1 Dark Mage + 2 Cultists |

### Floor 9 — The Frozen Deep
| d12 | Encounter |
|---|---|
| 1–2 | 1 Troll |
| 3–4 | 2–3 Rime Wolves |
| 5–6 | 1 Frozen Revenant |
| 7 | 1 Frost Giant |
| 8 | 2 Trolls |
| 9 | 1 Frost Giant + 2 Rime Wolves |
| 10 | 2 Frozen Revenants |
| 11 | 1 Troll + 1 Rime Wolf |

### Floor 10 — The Ashen Lair
| d12 | Encounter |
|---|---|
| 1–3 | 1–2 Drakes |
| 4–5 | 1 Ashbound Knight + 1 Dark Mage |
| 6 | 1 Basilisk |
| 7–8 | 1 Ashbound Knight + 1 Drake |
| 9 | 2 Ashbound Knights |
| 10 | 1 Basilisk + 1 Drake |
| 11 | 1 Frost Giant + 1 Troll (captives broken loose) |

---

## 17. Loot

After each combat, roll **d100 + (LCK mod × 5)** once for the whole encounter, in addition to each monster's own drops:

| Roll | Result |
|---|---|
| 01–50 | Gold only |
| 51–75 | One Common item: potion, torch, ration, antidote, or herb |
| 76–92 | One Uncommon item: +1 gear, scroll, focus tonic, or greater healing potion |
| 93–99 | One Rare item: +2 gear (floor 4+) or a charm |
| 100+ | One Rare item, plus a second roll on this table |

Floor limits from the Core Rule Set still apply: +1 gear only on floors 1–3, +2 on floors 4–7, and +3 on floors 8+. The **Item Database** has the d12 tables for picking the exact item in each category.

---

## 18. Counterplay Check

Every hard monster has an answer that doesn't depend on one specific build:

| Threat | Answers available to every build |
|---|---|
| Regeneration (Hydra, Troll) | Torches, fire pots, fire and cold spells |
| Paralysis (Ghoul, Rot Crawler) | Resilience, Cleanse, antidote-style cures, killing them fast |
| Incorporeal (Wraith, Banshee) | Magic weapons (found by floor 6), holy damage, spells |
| Non-magic resistance (Gargoyle) | Crush weapons, magic weapons, spells |
| Petrification (Basilisk) | Defend, Averted Eyes, basilisk eye charm |
| Summoners (Rat King, Brood Mother, Grimoire) | Area attacks, or focusing the summoner directly |
| Telegraphed blows (all late bosses) | Defend on cue |
| Level drain (Wraith) | Temple cure or a full rest in town |

---

## 19. Data Template

Every monster in this document fits this JSON shape:

```json
{
  "id": "giant_spider",
  "name": "Giant Spider",
  "hd": 4,
  "hp": 22,
  "atk": 5,
  "def": 14,
  "init": 2,
  "saves": { "body": 2, "reflex": 3, "mind": 1 },
  "row": "front",
  "group": [1, 2],
  "type": "beast",
  "morale": 8,
  "attacks": [
    {
      "name": "bite",
      "dmg": "1d6+2",
      "dmgType": "pierce",
      "onHit": { "save": "body", "dc": 12, "condition": "poisoned" }
    }
  ],
  "abilities": [
    {
      "id": "web",
      "trigger": { "recharge": [5, 6] },
      "effect": { "save": "reflex", "dc": 12, "condition": "webbed" }
    }
  ],
  "resist": [],
  "weak": ["fire"],
  "immune": ["poison"],
  "surprise": 3,
  "xp": 60,
  "gold": "0",
  "drops": [{ "item": "spider_silk", "chance": 0.2 }],
  "floors": [4]
}
```

**Bosses** add a `phases` array (HP threshold → ability set), `summons`, and `objects` (valves, the Phylactery). **Telegraphs** are abilities with `"telegraph": "log text"`, which queue for the monster's next turn.
