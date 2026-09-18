# Underkeep

A single-hero, classless, turn-based dungeon crawler for phones, in the spirit of 1970s–80s computer RPGs. It's built as a fullscreen, installable web app at a strict 9:18 ratio.

This folder is the project starter kit: the complete design plus two working engine modules, ready for Claude in VS Code to build from. Phase 1 creates the rest of the code.

## What's here

```
underkeep/
  CLAUDE.md                         Standing instructions Claude reads every session
  README.md                         This file
  docs/
    00-build-outline.md             Tech stack, 9:18 shell, design tokens, all 26 screen layouts, phases
    TASKS.md                        Phase-by-phase checklist
    DECISIONS.md                    Rulings and open questions (these override other docs)
    rules/
      01-core-rules.md              Attributes, skills, conditions, leveling
      02-bestiary.md                Monsters, bosses, elites, encounters, loot roll
      03-traps-locks-treasure.md    Traps, locks, doors, chests, hazards
      04-item-database.md           Every item, identification, curses, shops
      05-dungeon-generation-saving.md  Floor generator, waystones, saving
      06-combat-engine-ai.md        Order of operations, event hooks, monster AI
    07-engine-modules.md          How to use the supplied generator and raycaster
    design/
      mockups/index.html            All 26 screens side by side (open in a browser)
      mockups/*.html                One file per screen; buttons link between them
  src/
    dungeon/
      dungeon-generator.js        Supplied: rooms + maze + doors floor generator
      raycaster.js                Supplied: DDA raycaster renderer
```

Those two files are working code from Depths of Dreadmoor. They're vendored essentially as-is; Underkeep builds `floor-builder.js` and `view.js` around them. Their logic is untouched — only `dungeon-generator.js`'s module wrapper changed, because its UMD form cannot load in an ES module project at all (see `docs/DECISIONS.md`).

## Getting started in VS Code

1. Unzip this folder and open it in VS Code.
2. (Optional) Run `git init` and make a first commit, so every change Claude makes is easy to review.
3. Open Claude and start with a prompt like:

   > Read CLAUDE.md, docs/00-build-outline.md, and docs/TASKS.md. Then start Phase 1. Set up the project, then work through the Phase 1 tasks one at a time, checking them off as you go.

4. When a phase finishes, test on your phone using the "Done when" line in `docs/TASKS.md`, then ask Claude to start the next phase.

## Useful prompts along the way

- "Implement the next unchecked task in docs/TASKS.md. Read its source section first and write tests from the document's numbers."
- "Compare the Combat screen to docs/design/mockups/Combat.html and the Combat layout table, and fix any differences."
- "Something in the rules doesn't cover [situation]. Propose a ruling and add it to docs/DECISIONS.md."
- "Run the balance simulator and report which bosses fall below a 60% win rate."

## Online versions

The same material also exists as editable versions in Claude:

- Build outline (living doc): https://claude.ai/code/artifact/8ba810c9-d103-4482-aab6-78a6b98a4524
- Screen design canvas: https://claude.ai/artifact/RX7vMmrJ12Tn647ZYZMLkZ

If you change one of those, re-export it into this folder so Claude in VS Code sees the update.
