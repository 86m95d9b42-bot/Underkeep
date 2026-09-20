/**
 * @vitest-environment happy-dom
 *
 * The Alchemist (`04` section 12).
 *
 * Nine recipes that turn monster parts into something useful, behind the
 * floor 2 boss. The rules are what each wants and what it costs; the screen
 * is that list with the brewable ones first.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  RECIPES,
  UNLOCK_FLOOR,
  brew,
  carried,
  ingredientsOf,
  recipesFor,
  whyNotBrew,
} from '../src/systems/alchemist.js';
import { alchemist, REGIONS, ingredientLine, reasonFor, resultName } from '../src/ui/screens/alchemist.js';
import { placeRegions, validateScreen } from '../src/shell/layout.js';
import { bossDefeated, createTown, isOpen } from '../src/systems/town.js';
import { chooseOrigin, createDraft, finish, setName } from '../src/systems/creation.js';
import { addItem } from '../src/systems/inventory.js';
import { isIdentified } from '../src/systems/identification.js';
import { ALCHEMY, item } from '../src/data/items.js';
import { t } from '../src/data/strings.js';

const SCORES = { might: 15, agility: 12, vigor: 14, intellect: 12, wits: 12, luck: 10 };

function makeHero({ gold = 1000 } = {}) {
  const who = finish(
    setName(chooseOrigin({ ...createDraft({ seed: 11 }), scores: SCORES }, 'sellsword'), 'Harrow'),
  );
  who.gold = gold;
  return who;
}

/** A town with the floor 2 boss behind it, which is what opens the door. */
function openTown() {
  const town = createTown();
  bossDefeated(town, 2);
  return town;
}

/** The recipe that makes one thing, by what it makes. */
const recipeFor = (id) => RECIPES.find((recipe) => recipe.result.item === id);

function mount({ frame = 'tall', hero = makeHero(), town = openTown() } = {}) {
  const router = { has: () => true, go: vi.fn(), back: vi.fn(), openSheet: vi.fn() };
  const built = alchemist.build({ router, run: { hero }, town, frame, settings: { all: {} } });
  return { built, router, hero, town, placed: placeRegions(alchemist, frame) };
}

describe('the recipes (04 section 12)', () => {
  it('has the nine the document lists, each with a fee and a result', () => {
    expect(RECIPES).toHaveLength(9);
    expect(RECIPES).toBe(ALCHEMY.recipes);
    for (const recipe of RECIPES) {
      expect(item(recipe.result.item)).toBeTruthy();
      expect(recipe.fee).toBeGreaterThan(0);
      expect(recipe.ingredients.length).toBeGreaterThan(0);
    }
    expect(recipeFor('antidote')).toMatchObject({ fee: 5, ingredients: [{ item: 'rat_tail', count: 5 }] });
    expect(recipeFor('fire_pot').result).toEqual({ item: 'fire_pot', count: 2 });
    expect(recipeFor('dragonscale_mail')).toMatchObject({ fee: 500 });
  });

  it('opens after the floor 2 boss, and not before', () => {
    expect(UNLOCK_FLOOR).toBe(2);
    const shut = createTown();
    const hero = makeHero();
    expect(isOpen(shut, 'alchemist')).toBe(false);
    expect(whyNotBrew(shut, hero, recipeFor('antidote'))).toBe('locked');
    expect(whyNotBrew(openTown(), hero, recipeFor('antidote'))).toBe('missingParts');
  });

  it('counts what the hero has against what a recipe wants', () => {
    const hero = makeHero();
    addItem(hero.pack, 'rat_tail', { count: 3 });
    expect(carried(hero, 'rat_tail')).toBe(3);
    expect(carried(hero, 'ectoplasm')).toBe(0);
    const lines = ingredientsOf(hero, recipeFor('antidote'));
    expect(lines).toEqual([
      { baseId: 'rat_tail', name: 'Rat Tail', have: 3, need: 5, enough: false },
    ]);
    addItem(hero.pack, 'rat_tail', { count: 2 });
    expect(ingredientsOf(hero, recipeFor('antidote'))[0]).toMatchObject({ have: 5, enough: true });
  });

  it('says which of the three things is missing', () => {
    const town = openTown();
    const hero = makeHero({ gold: 0 });
    addItem(hero.pack, 'healing_herb', { count: 2 });
    expect(whyNotBrew(town, hero, recipeFor('healing_potion'))).toBe('notEnoughGold');
    hero.gold = 100;
    expect(whyNotBrew(town, hero, recipeFor('healing_potion'))).toBe(null);
    hero.pack.capacity = 1; // the herbs themselves fill it
    expect(whyNotBrew(town, hero, recipeFor('healing_potion'))).toBe('packFull');
  });

  it('puts what can be brewed at the top of the list', () => {
    const hero = makeHero();
    addItem(hero.pack, 'spider_silk', { count: 1 });
    const rows = recipesFor(openTown(), hero);
    expect(rows).toHaveLength(9);
    expect(rows[0].why).toBe(null);
    expect(rows[0].result.item).toBe('web_bomb');
    for (let i = 1; i < rows.length; i += 1) {
      if (!rows[i].why) expect(rows[i - 1].why).toBe(null);
    }
  });
});

describe('brewing', () => {
  it('spends the parts and the fee, and hands over a known item', () => {
    const town = openTown();
    const hero = makeHero({ gold: 100 });
    addItem(hero.pack, 'rat_tail', { count: 6 });
    const done = brew(town, hero, recipeFor('antidote'));

    expect(done).toMatchObject({ ok: true, paid: 5 });
    expect(hero.gold).toBe(95);
    expect(carried(hero, 'rat_tail')).toBe(1);
    const made = hero.pack.items.find((entry) => entry.baseId === 'antidote');
    expect(made.count).toBe(1);
    expect(isIdentified(hero.identification, made)).toBe(true);
  });

  it('takes parts from more than one stack when it has to', () => {
    const town = openTown();
    const hero = makeHero();
    addItem(hero.pack, 'rat_tail', { count: 5 });
    addItem(hero.pack, 'rat_tail', { count: 5, identified: false });
    expect(carried(hero, 'rat_tail')).toBe(10);
    brew(town, hero, recipeFor('antidote'));
    expect(carried(hero, 'rat_tail')).toBe(5);
  });

  it('makes two Fire Pots from one gland, as the table says', () => {
    const town = openTown();
    const hero = makeHero();
    addItem(hero.pack, 'magma_gland');
    brew(town, hero, recipeFor('fire_pot'));
    expect(hero.pack.items.find((entry) => entry.baseId === 'fire_pot').count).toBe(2);
    expect(carried(hero, 'magma_gland')).toBe(0);
  });

  it('refuses, and takes nothing, when it cannot', () => {
    const town = openTown();
    const hero = makeHero();
    const gold = hero.gold;
    expect(brew(town, hero, recipeFor('antidote'))).toMatchObject({ ok: false, why: 'missingParts' });
    expect(hero.gold).toBe(gold);

    const shut = createTown();
    addItem(hero.pack, 'rat_tail', { count: 5 });
    expect(brew(shut, hero, recipeFor('antidote'))).toMatchObject({ ok: false, why: 'locked' });
    expect(carried(hero, 'rat_tail')).toBe(5);
  });
});

describe('where the Alchemist puts things', () => {
  it("follows the outline's Alchemist table", () => {
    // Bar 1-2, recipes 3-14, the result's effect 15-16, fee and BREW 17-18.
    expect(REGIONS.topBar.tall).toEqual([1, 9, 1, 2]);
    expect(REGIONS.list.tall).toEqual([1, 9, 3, 14]);
    expect(REGIONS.detail.tall).toEqual([1, 9, 15, 16]);
    expect(REGIONS.fee.tall).toEqual([1, 4, 17, 18]);
    expect(REGIONS.brew.tall).toEqual([5, 9, 17, 18]);
  });

  it('places cleanly in both frames and lets only the list scroll', () => {
    expect(validateScreen(alchemist, 'tall')).toEqual([]);
    expect(validateScreen(alchemist, 'wide')).toEqual([]);
    const { built } = mount();
    const scrolls = Object.values(built).filter((node) => node.querySelector?.('.scroll'));
    expect(scrolls).toEqual([built.list]);
  });

  it('draws every recipe as the mockup writes it', () => {
    const hero = makeHero();
    addItem(hero.pack, 'spider_silk');
    const { built } = mount({ hero });
    expect(built.list.textContent).toContain(t('alchemist.label'));
    expect(built.list.textContent).toContain('Web Bomb');
    expect(built.list.textContent).toContain(
      t('alchemist.ingredient', { name: 'Spider Silk', have: 1, need: 1 }),
    );
    expect(built.list.textContent).toContain(t('alchemist.fee', { n: 20 }));
    // "Fire Pot x2" carries its count.
    expect(resultName({ item: 'fire_pot', count: 2 })).toBe(
      t('alchemist.resultMany', { name: 'Fire Pot', n: 2 }),
    );
    expect(resultName({ item: 'antidote', count: 1 })).toBe('Antidote');
    expect(ingredientLine({ ingredients: ingredientsOf(hero, recipeFor('web_bomb')) })).toContain('1 / 1');
  });

  it('says the shop is shut until the floor 2 boss has fallen', () => {
    const hero = makeHero();
    addItem(hero.pack, 'rat_tail', { count: 5 });
    const { built } = mount({ hero, town: createTown() });
    expect(reasonFor('locked')).toBe(t('alchemist.why.locked', { n: 2 }));
    expect(reasonFor(null)).toBeUndefined();

    // The recipes are still worth reading, so the rows keep their parts and
    // the button is what refuses.
    expect(built.list.textContent).toContain('Rat Tail 5 / 5');
    const row = [...built.list.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Antidote'),
    );
    expect(row.disabled).toBe(false);
    row.click();
    expect(built.brew.textContent).toContain(t('alchemist.why.locked', { n: 2 }));
    expect(built.brew.querySelector('button').disabled).toBe(true);
  });

  it('keeps the "have / need" on a recipe it is short of', () => {
    const hero = makeHero();
    addItem(hero.pack, 'rat_tail', { count: 2 });
    const { built } = mount({ hero });
    expect(built.list.textContent).toContain('Rat Tail 2 / 5');
    const row = [...built.list.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Antidote'),
    );
    row.click();
    expect(built.brew.textContent).toContain(t('alchemist.why.missingParts'));
  });

  it('brews what is picked, and the gold goes with it', () => {
    const hero = makeHero({ gold: 100 });
    addItem(hero.pack, 'healing_herb', { count: 2 });
    const { built } = mount({ hero });
    const row = [...built.list.querySelectorAll('button')].find((node) =>
      node.textContent.includes('Healing Potion'),
    );
    row.click();
    expect(built.detail.textContent).toContain('Heal 2d6+2');
    expect(built.fee.textContent).toContain(t('alchemist.fee', { n: 5 }));

    built.brew.querySelector('button').click();
    expect(hero.gold).toBe(95);
    expect(hero.pack.items.some((entry) => entry.baseId === 'healing_potion')).toBe(true);
    expect(carried(hero, 'healing_herb')).toBe(0);
  });

  it('has one primary button, and it says why it is off', () => {
    const { built } = mount();
    const primary = Object.values(built).flatMap((node) => [
      ...(node.querySelectorAll?.('.btn--primary') ?? []),
    ]);
    expect(primary).toHaveLength(1);
    expect(primary[0].disabled).toBe(true);
    expect(built.brew.textContent).toContain(t('alchemist.why.pick'));
  });
});
