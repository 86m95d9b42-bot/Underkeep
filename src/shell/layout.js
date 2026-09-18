/**
 * Layout engine: turns a screen's region declarations into grid placements for
 * whichever frame is active.
 *
 * A screen declares each region once, with a `tall` placement and, only where
 * the default fold doesn't work, a `wide` one:
 *
 *   region('log', { tall: [1, 9, 11, 12], wide: [4, 15, 8, 9] })
 *
 * Placements are `[colStart, colEnd, rowStart, rowEnd]`, inclusive, 1-based,
 * exactly as the screen tables in 00-build-outline.md are written.
 *
 * No DOM here — this file is pure so the placements can be tested in Node.
 * 00-build-outline.md, "Tablet and landscape layout".
 */

/** @typedef {[number, number, number, number]} Placement cols a–b, rows c–d (inclusive) */
/** @typedef {'tall' | 'wide'} Frame */
/** @typedef {'fold' | 'stage' | 'list-detail' | 'panel'} Pattern */
/**
 * @typedef {object} RegionDef
 * @property {Placement} tall
 * @property {Placement} [wide]   explicit wide placement; wins over the pattern
 * @property {'left' | 'right'} [side]  which half a pattern puts this region in
 * @property {boolean} [tap]      true if the region itself is a tap target
 */

export const FRAMES = {
  tall: { cols: 9, rows: 18 },
  wide: { cols: 18, rows: 9 },
};

/** The row a tall screen folds at. Rows 1–9 go left, rows 10–18 go right. */
export const FOLD_ROW = 9;

/** Half the wide frame is 9 columns; the right half starts here. */
const RIGHT_COL_OFFSET = 9;

export const PATTERNS = /** @type {Pattern[]} */ ([
  'fold',
  'stage',
  'list-detail',
  'panel',
]);

/** A sheet shown as a wide panel occupies cols 11–18 (00, "Four wide patterns"). */
export const PANEL_COLS = /** @type {[number, number]} */ ([11, 18]);

/**
 * Which half of the wide frame a region belongs to.
 * An explicit `side` wins; otherwise the fold rule decides by row.
 * @param {RegionDef} def
 * @returns {'left' | 'right' | 'crosses'}
 */
export function sideOf(def) {
  if (def.side) return def.side;
  const [, , r1, r2] = def.tall;
  if (r2 <= FOLD_ROW) return 'left';
  if (r1 > FOLD_ROW) return 'right';
  return 'crosses';
}

/**
 * Packs one half's regions into that half's 9 rows, keeping their order and
 * their relative sizes. Used by every pattern except `fold`, which shifts
 * instead of packing so the outline's "rows 10–18 become rows 1–9" holds.
 * @param {[string, RegionDef][]} entries
 * @returns {Map<string, [number, number]>} name -> [rowStart, rowEnd]
 */
function packRows(entries) {
  /** @type {Map<string, [number, number]>} */
  const out = new Map();
  if (entries.length === 0) return out;

  const min = Math.min(...entries.map(([, d]) => d.tall[2]));
  const max = Math.max(...entries.map(([, d]) => d.tall[3]));
  const span = max - min + 1;
  // Map tall row boundaries onto the half's 9 rows. Boundary mapping (rather
  // than mapping starts and ends separately) keeps regions touching with no
  // gaps or overlaps.
  const boundary = (row) => Math.round(((row - min) * FOLD_ROW) / span);

  for (const [name, def] of entries) {
    const start = boundary(def.tall[2]) + 1;
    const end = Math.max(start, boundary(def.tall[3] + 1));
    out.set(name, [start, Math.min(end, FOLD_ROW)]);
  }
  return out;
}

/**
 * Derives a wide placement for one region under a pattern.
 * @param {string} name
 * @param {RegionDef} def
 * @param {Pattern} pattern
 * @param {Map<string, [number, number]>} packed rows from packRows for this side
 * @returns {Placement}
 */
function widePlacement(name, def, pattern, packed) {
  const [c1, c2] = def.tall;
  const side = sideOf(def);

  if (pattern === 'fold') {
    // The fold rule: rows above the fold keep their rows in the left half;
    // rows below it move to the right half and lose 9.
    if (side === 'left') return [c1, c2, def.tall[2], def.tall[3]];
    return [
      c1 + RIGHT_COL_OFFSET,
      c2 + RIGHT_COL_OFFSET,
      def.tall[2] - FOLD_ROW,
      def.tall[3] - FOLD_ROW,
    ];
  }

  const rows = packed.get(name);
  /* c8 ignore next */
  if (!rows) throw new Error(`layout: no packed rows for "${name}"`);

  if (pattern === 'panel' && side === 'right') {
    return [PANEL_COLS[0], PANEL_COLS[1], rows[0], rows[1]];
  }
  const offset = side === 'right' ? RIGHT_COL_OFFSET : 0;
  return [c1 + offset, c2 + offset, rows[0], rows[1]];
}

/**
 * @param {Placement} p
 * @param {Frame} frame
 * @param {string} where for the error message
 */
function assertInBounds(p, frame, where) {
  const { cols, rows } = FRAMES[frame];
  const [c1, c2, r1, r2] = p;
  const bad =
    c1 < 1 || r1 < 1 || c2 > cols || r2 > rows || c2 < c1 || r2 < r1;
  if (bad) {
    throw new Error(
      `layout: ${where} placement [${p}] is outside the ${frame} ${cols}x${rows} frame`,
    );
  }
}

/**
 * Places every region of a screen for one frame.
 * @param {{ id?: string, pattern?: Pattern, regions: Record<string, RegionDef> }} screen
 * @param {Frame} frame
 * @returns {Map<string, Placement>}
 */
export function placeRegions(screen, frame) {
  const entries = Object.entries(screen.regions);
  /** @type {Map<string, Placement>} */
  const out = new Map();

  if (frame === 'tall') {
    for (const [name, def] of entries) {
      assertInBounds(def.tall, 'tall', `${screen.id ?? '?'}.${name}`);
      out.set(name, def.tall);
    }
    return out;
  }

  const pattern = screen.pattern ?? 'fold';
  /* c8 ignore next 3 */
  if (!PATTERNS.includes(pattern)) {
    throw new Error(`layout: unknown pattern "${pattern}" on ${screen.id ?? '?'}`);
  }

  // Regions with an explicit wide placement are out of the pattern's hands,
  // and must not take up room in the packing either.
  const derived = entries.filter(([, def]) => !def.wide);
  const left = derived.filter(([, def]) => sideOf(def) === 'left');
  const right = derived.filter(([, def]) => sideOf(def) === 'right');
  const crossing = derived.filter(([, def]) => sideOf(def) === 'crosses');
  if (crossing.length > 0) {
    throw new Error(
      `layout: ${screen.id ?? '?'} region(s) ${crossing
        .map(([n]) => n)
        .join(', ')} cross the fold; give a wide placement or a side`,
    );
  }

  const packedLeft = pattern === 'fold' ? new Map() : packRows(left);
  const packedRight = pattern === 'fold' ? new Map() : packRows(right);

  for (const [name, def] of entries) {
    const placement = def.wide
      ? def.wide
      : widePlacement(
          name,
          def,
          pattern,
          sideOf(def) === 'right' ? packedRight : packedLeft,
        );
    assertInBounds(placement, 'wide', `${screen.id ?? '?'}.${name}`);
    out.set(name, placement);
  }
  return out;
}

/**
 * Checks a screen's declarations against the UI rules: placements in bounds in
 * both frames, and tap targets at least 2 rows tall. Used by the tests and by
 * the dev build, never in a release path.
 * @param {{ id?: string, pattern?: Pattern, regions: Record<string, RegionDef> }} screen
 * @returns {string[]} problems, empty when the screen is sound
 */
export function validateScreen(screen) {
  /** @type {string[]} */
  const problems = [];
  const id = screen.id ?? '?';

  for (const frame of /** @type {Frame[]} */ (['tall', 'wide'])) {
    let placed;
    try {
      placed = placeRegions(screen, frame);
    } catch (err) {
      problems.push(String(err.message));
      continue;
    }
    for (const [name, p] of placed) {
      const def = screen.regions[name];
      if (def.tap && p[3] - p[2] + 1 < 2) {
        problems.push(
          `${id}.${name} is a tap target but spans ${p[3] - p[2] + 1} row in the ${frame} frame (minimum 2)`,
        );
      }
    }
  }
  return problems;
}

/**
 * The CSS grid values for a placement.
 * @param {Placement} p
 */
export function gridStyle(p) {
  return {
    gridColumn: `${p[0]} / ${p[1] + 1}`,
    gridRow: `${p[2]} / ${p[3] + 1}`,
  };
}
