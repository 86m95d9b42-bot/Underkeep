/**
 * Where a restored game opens (`05` section 11: "The game can be closed at any
 * moment, including mid-combat, and reopens at exactly the same spot").
 *
 * No DOM: `main.js` asks, and the router goes.
 */

/**
 * The screens Continue may reopen as the save left them: each is drawn from
 * the game alone, with nothing in its parameters that the save does not
 * carry. Anything else opens on the Exploration or Town screen it sits on.
 */
const RESUMABLE = {
  dungeon: ['explore', 'map', 'hero', 'skillTree', 'pack', 'levelUp', 'chest'],
  town: ['town', 'shop', 'inn', 'temple', 'sage', 'stash', 'gate', 'alchemist', 'hero', 'skillTree', 'pack', 'levelUp'],
};

/** The screen a restored game opens on, from where its save was taken. */
export function resumeScreen(game, saved) {
  if (game.fight) return game.fight.over && saved === 'loot' ? 'loot' : 'combat';
  const where = game.run ? 'dungeon' : 'town';
  if (!RESUMABLE[where].includes(saved)) return where === 'dungeon' ? 'explore' : 'town';
  // A chest is only a screen while the hero still faces one.
  if (saved === 'chest' && !game.run.chestAhead) return 'explore';
  return saved;
}
