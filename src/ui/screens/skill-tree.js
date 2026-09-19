/**
 * Hero: Skill Tree (`00-build-outline.md`, "Hero and Items").
 *
 * Path chips across the top, the chosen Path's four tiers under them with
 * their point requirement and a grid of skill tiles, then the selected skill
 * and the LEARN button. Tall: all of it down the screen. Wide
 * ("list + detail"): the tiers in cols 1–12, the selected skill and LEARN in
 * cols 13–18.
 *
 * A tile says where it stands without relying on colour: a learned skill
 * shows its rank pips, and a locked one is dimmed and says why when it is
 * picked (`00`, "Color is never the only signal").
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import { heroHeaderRegions, heroTabs, heroTopBar } from '../parts/hero-header.js';
import { abbr } from '../../data/attributes.js';
import {
  CROSSROADS,
  PATHS,
  TIERS,
  gateFor,
  skill,
  skillFor,
  skillsOfPath,
  skillsOfTier,
  totalSkillPoints,
} from '../../data/skills.js';
import { learn, rankOf, spentIn, whyNot } from '../../systems/skill-tree.js';
import { LEVELING } from '../../data/attributes.js';

/** The numerals the tier headers use; the fourth is the capstone by name. */
const NUMERALS = ['I', 'II', 'III', 'IV'];

/** What a hero can spend in a lifetime (`01` section 6, "21 SP by level 20"). */
export const HERO_POINTS = LEVELING.skillPointsAtCap;

/** The tabs sit beside the bar when wide, and the tiers take cols 1-12. */
export const REGIONS = {
  ...heroHeaderRegions([1, 12]),
  paths: { tall: [1, 9, 5, 6], wide: [1, 12, 3, 4], tap: true },
  tiers: { tall: [1, 9, 7, 14], wide: [1, 12, 5, 9] },
  selected: { tall: [1, 9, 15, 16], wide: [13, 18, 3, 7] },
  learn: { tall: [1, 9, 17, 18], wide: [13, 18, 8, 9], tap: true },
};

/** Every tab across the top: the four Paths, then the Crossroads. */
export const PATH_TABS = [...Object.keys(PATHS), 'crossroads'];

/** A Path's name without the "PATH OF" the chips have no room for. */
export function shortPathName(path) {
  return t(`paths.${path}.name`).replace(/^PATH OF (THE )?/, '');
}

/** What a tier's header says under its name (the SkillTree mockup's line). */
export function tierNote(hero, path, tier) {
  const gate = gateFor(tier);
  if (gate === 0) return t('skillTree.tierOpen');

  // Only an attribute requirement belongs in a tier's header: Shield Bash
  // also has a `requires`, but its is a shield to swing.
  const capstone = skillsOfTier(path, tier)
    .map((id) => skill(id).requires)
    .find((needs) => needs?.attribute);
  if (capstone) {
    return t('skillTree.tierCapstone', {
      n: gate,
      attribute: abbr(capstone.attribute),
      score: capstone.score,
    });
  }

  const have = spentIn(hero, path);
  return have >= gate
    ? t('skillTree.tierMet', { n: gate })
    : t('skillTree.tierMore', { n: gate, m: gate - have });
}

/** How far a Crossroads skill's two Paths have come, as the outline writes it. */
export function crossroadsNote(hero, id) {
  const [a, b] = skill(id).paths ?? [];
  const progress = (path) =>
    t('skillTree.pathProgress', {
      name: shortPathName(path),
      have: spentIn(hero, path),
      want: CROSSROADS.pointsInEachPath,
    });
  return t('skillTree.crossroadsNeeds', { a: progress(a), b: progress(b) });
}

/** @type {import('../../shell/router.js').Screen} */
export const skillTree = {
  id: 'skillTree',
  pattern: 'list-detail',
  regions: REGIONS,

  build({ router, run }) {
    const who = run.hero;
    let path = PATH_TABS[0];
    let picked = null;

    const pathStrip = el('div', { class: 'region pathchips scroll-x' });
    const tierBox = el('div', { class: 'region tiers scroll' });
    const detail = el('div', { class: 'region skilldetail' });
    const learnBox = el('div', { class: 'region keyslot' });

    /** One skill tile: its name, its rank pips, and how it stands. */
    const tileFor = (id) => {
      const entry = skill(id);
      const rank = rankOf(who, id);
      const why = whyNot(who, id);
      const classes = ['skilltile'];
      if (rank > 0) classes.push('skilltile--learned');
      else if (!why) classes.push('skilltile--open');
      else classes.push('skilltile--locked');
      if (picked === id) classes.push('skilltile--picked');

      return el(
        'button',
        {
          type: 'button',
          class: classes.join(' '),
          'aria-pressed': picked === id ? 'true' : 'false',
          'aria-label': `${t(`skills.${id}.name`)} ${rank}/${entry.ranks}`,
          onClick: () => {
            picked = id;
            paint();
          },
        },
        [
          el('span', { class: 'skilltile__name', text: t(`skills.${id}.name`) }),
          // Rank pips, so a learned skill reads at a glance and without colour.
          el(
            'span',
            { class: 'skilltile__pips' },
            Array.from({ length: entry.ranks }, (_, i) =>
              el('span', { class: `pip${i < rank ? ' pip--filled' : ''}` }),
            ),
          ),
        ],
      );
    };

    const paintPaths = () => {
      pathStrip.replaceChildren(
        ...PATH_TABS.map((id) =>
          button({
            label:
              id === 'crossroads'
                ? t('skillTree.crossroadsTitle')
                : `${shortPathName(id)} ${spentIn(who, id)}`,
            selected: path === id,
            class: 'pathchip',
            onTap: () => {
              path = id;
              picked = null;
              paint();
            },
          }),
        ),
      );
    };

    const paintTiers = () => {
      if (path === 'crossroads') {
        // The Crossroads have no tier: each one shows its two Paths' progress
        // when it is picked (`00`, "Hero: Skill Tree").
        tierBox.replaceChildren(
          el('div', { class: 'tier' }, [
            el('div', { class: 'tier__head' }, [
              el('span', { class: 'tier__name', text: t('skillTree.crossroadsTitle') }),
            ]),
            el('div', { class: 'tier__tiles' }, skillsOfPath('crossroads').map(tileFor)),
          ]),
        );
        return;
      }

      tierBox.replaceChildren(
        ...TIERS.map((row) =>
          el('div', { class: 'tier' }, [
            el('div', { class: 'tier__head' }, [
              el('span', {
                class: 'tier__name',
                text:
                  row.tier === TIERS.length
                    ? t('skillTree.capstone')
                    : t('skillTree.tier', { n: NUMERALS[row.tier - 1] }),
              }),
              el('span', { class: 'hint', text: tierNote(who, path, row.tier) }),
            ]),
            el('div', { class: 'tier__tiles' }, skillsOfTier(path, row.tier).map(tileFor)),
          ]),
        ),
      );
    };

    const paintDetail = () => {
      if (!picked) {
        detail.replaceChildren(el('span', { class: 'hint', text: t('skillTree.pick') }));
        return;
      }
      const entry = skillFor(picked);
      const chips = [chip(t(`skillTree.types.${entry.type}`))];
      if (entry.fp) chips.push(chip(t('skillTree.fp', { n: entry.fp }), { tone: 'accent' }));
      if (entry.path === 'crossroads') chips.push(chip(crossroadsNote(who, picked)));

      detail.replaceChildren(
        el('span', { class: 'skilldetail__name', text: entry.name }),
        el('div', { class: 'skilldetail__chips' }, chips),
        el('span', { class: 'skilldetail__effect', text: entry.effect }),
      );
    };

    const paintLearn = () => {
      const why = picked ? whyNot(who, picked) : 'pick';
      learnBox.replaceChildren(
        button({
          label: picked
            ? t('skillTree.learnOne', { skill: t(`skills.${picked}.name`) })
            : t('skillTree.learn'),
          hint: why ? undefined : t('skillTree.cost'),
          kind: 'primary',
          reason: why
            ? picked
              ? t(`skillTree.locked.${why}`, whyReason(who, picked, why))
              : t('skillTree.pick')
            : undefined,
          onTap: () => {
            learn(who, picked);
            paint();
          },
        }),
      );
    };

    /** The numbers a locked reason needs to name what is missing. */
    function whyReason(unit, id, why) {
      const entry = skill(id);
      if (why === 'tierLocked') return { n: gateFor(entry.tier) };
      if (why === 'needsAttribute') {
        return { attribute: abbr(entry.requires.attribute), score: entry.requires.score };
      }
      if (why === 'needsPaths') return { n: CROSSROADS.pointsInEachPath };
      return {};
    }

    // The bar carries the points left to spend, so it is repainted with
    // everything else when one is spent.
    const header = el('div', { class: 'region' });
    const paintHeader = () => {
      const bar = heroTopBar({
        hero: who,
        router,
        title: t('skillTree.title'),
        sub: t('skillTree.sub', { n: HERO_POINTS }),
      });
      header.className = bar.className;
      header.replaceChildren(...bar.childNodes);
    };

    function paint() {
      paintHeader();
      paintPaths();
      paintTiers();
      paintDetail();
      paintLearn();
    }
    paint();

    return {
      topBar: header,
      tabs: heroTabs({ router, current: 'skills' }),
      paths: pathStrip,
      tiers: tierBox,
      selected: detail,
      learn: learnBox,
    };
  },
};

/** The tree's whole cost, for anything that wants to show it. */
export const TREE_POINTS = totalSkillPoints();
