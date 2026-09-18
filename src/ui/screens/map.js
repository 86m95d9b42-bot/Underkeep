/**
 * Automap (`00-build-outline.md`, Exploration; `05` section 10).
 *
 * Tall: top bar, the map, a legend that scrolls sideways, then CENTER and the
 * two zoom keys. Wide ("stage + controls"): the map takes cols 1–14 and the
 * legend and keys stack in cols 15–18.
 *
 * The map is an SVG whose viewBox is the window onto the floor, so panning and
 * zooming are arithmetic rather than redrawing: `dungeon/automap.js` decides
 * what is on the map and where to look, and this file draws it.
 */
import { el } from '../parts/el.js';
import { button } from '../parts/button.js';
import { topBar, chip } from '../parts/parts.js';
import { t } from '../../data/strings.js';
import {
  mapTiles,
  mapMarks,
  viewBoxFor,
  viewBoxAttr,
  zoomBy,
  panBy,
  ZOOM,
} from '../../dungeon/automap.js';

const SVG = 'http://www.w3.org/2000/svg';

/** @param {string} tag @param {Record<string, string | number>} attrs */
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null) continue;
    node.setAttribute(name, String(value));
  }
  return node;
}

/** The hero's arrow, pointing the way they face: 0 N, 1 E, 2 S, 3 W. */
function heroArrow(x, y, facing) {
  const arrow = svg('polygon', {
    points: '0,-0.42 0.34,0.36 -0.34,0.36',
    fill: 'var(--accent)',
    transform: `translate(${x + 0.5} ${y + 0.5}) rotate(${facing * 90})`,
  });
  return arrow;
}

/** One map symbol. Shapes differ as well as colours, so colour is never alone. */
function markShape(mark) {
  const [x, y] = mark.at;
  const cx = x + 0.5;
  const cy = y + 0.5;

  switch (mark.kind) {
    case 'you':
      return heroArrow(x, y, mark.facing ?? 0);
    case 'trap':
      // A cross, in the danger colour.
      return svg('path', {
        d: `M${cx - 0.3} ${cy - 0.3}L${cx + 0.3} ${cy + 0.3}M${cx + 0.3} ${cy - 0.3}L${cx - 0.3} ${cy + 0.3}`,
        stroke: 'var(--danger)',
        'stroke-width': 0.16,
        'stroke-linecap': 'round',
      });
    case 'hazard':
      return svg('path', {
        d: `M${cx} ${cy - 0.36}L${cx + 0.36} ${cy + 0.28}L${cx - 0.36} ${cy + 0.28}Z`,
        fill: 'none',
        stroke: 'var(--danger)',
        'stroke-width': 0.14,
      });
    case 'chest':
      return svg('rect', {
        x: cx - 0.3,
        y: cy - 0.24,
        width: 0.6,
        height: 0.48,
        rx: 0.1,
        fill: 'var(--accent)',
      });
    case 'waystone':
      return svg('polygon', {
        points: `${cx},${cy - 0.38} ${cx + 0.34},${cy} ${cx},${cy + 0.38} ${cx - 0.34},${cy}`,
        fill: 'var(--focus)',
      });
    case 'lockedDoor':
      return svg('rect', {
        x: cx - 0.34,
        y: cy - 0.34,
        width: 0.68,
        height: 0.68,
        fill: 'none',
        stroke: 'var(--danger)',
        'stroke-width': 0.16,
      });
    case 'safeRoom':
      return svg('circle', { cx, cy, r: 0.36, fill: 'none', stroke: 'var(--success)', 'stroke-width': 0.14 });
    case 'stairsDown':
    case 'stairsUp': {
      const up = mark.kind === 'stairsUp';
      return svg('path', {
        d: up
          ? `M${cx} ${cy + 0.34}L${cx} ${cy - 0.34}M${cx - 0.26} ${cy - 0.08}L${cx} ${cy - 0.34}L${cx + 0.26} ${cy - 0.08}`
          : `M${cx} ${cy - 0.34}L${cx} ${cy + 0.34}M${cx - 0.26} ${cy + 0.08}L${cx} ${cy + 0.34}L${cx + 0.26} ${cy + 0.08}`,
        stroke: 'var(--bone)',
        'stroke-width': 0.14,
        'stroke-linecap': 'round',
        fill: 'none',
      });
    }
    case 'grave':
      return svg('path', {
        d: `M${cx - 0.26} ${cy + 0.34}L${cx - 0.26} ${cy - 0.1}A0.26 0.26 0 0 1 ${cx + 0.26} ${cy - 0.1}L${cx + 0.26} ${cy + 0.34}Z`,
        fill: 'var(--muted)',
      });
    case 'returnMark':
      return svg('circle', { cx, cy, r: 0.3, fill: 'var(--focus)' });
    default:
      return null;
  }
}

/** The legend, in the order `05` section 10 and the mockup list it. */
export const LEGEND = [
  'you',
  'trap',
  'hazard',
  'chest',
  'waystone',
  'safeRoom',
  'lockedDoor',
  'grave',
];

/** @type {import('../../shell/router.js').Screen} */
export const map = {
  id: 'map',
  pattern: 'stage',
  regions: {
    top: { tall: [1, 9, 1, 2], wide: [1, 14, 1, 2] },
    map: { tall: [1, 9, 3, 14], wide: [1, 14, 3, 9] },
    legend: { tall: [1, 9, 15, 16], wide: [15, 18, 1, 3] },
    controls: { tall: [1, 9, 17, 18], wide: [15, 18, 4, 9], tap: true },
  },

  build({ router, run }) {
    const floor = run.floor;
    const ex = run.ex;

    /** Where the view is centred, and how many tiles fit across it. */
    let center = /** @type {[number, number]} */ ([...ex.pos]);
    let tiles = ZOOM.default;

    const canvas = svg('svg', {
      role: 'img',
      'aria-label': `${t('map.title')} ${floor.floor}`,
      preserveAspectRatio: 'xMidYMid meet',
    });
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const frame = el('div', { class: 'region mapframe' }, [canvas]);

    const paint = () => {
      const box = frame.getBoundingClientRect?.() ?? { width: 3, height: 4 };
      const aspect = box.height > 0 ? box.width / box.height : 3 / 4;
      canvas.setAttribute(
        'viewBox',
        viewBoxAttr(
          viewBoxFor({ center, tiles, aspect, width: floor.width, height: floor.height }),
        ),
      );

      const parts = [];
      for (const tile of mapTiles(floor, ex)) {
        const [x, y] = tile.at;
        parts.push(
          svg('rect', {
            x: x + 0.08,
            y: y + 0.08,
            width: 0.84,
            height: 0.84,
            rx: 0.12,
            // Walked tiles are filled; glimpsed ones are dashed outlines
            // (`00`, Automap).
            fill: tile.state === 'explored' ? (tile.door ? 'var(--muted)' : 'var(--rule)') : 'none',
            stroke: tile.state === 'explored' ? 'none' : 'var(--rule)',
            'stroke-width': 0.1,
            'stroke-dasharray': tile.state === 'explored' ? null : '0.2 0.2',
          }),
        );
      }
      for (const mark of mapMarks(floor, ex)) {
        const shape = markShape(mark);
        if (shape) parts.push(shape);
      }
      canvas.replaceChildren(...parts);
    };
    paint();
    if (globalThis.ResizeObserver) new ResizeObserver(paint).observe(frame);

    /* -- pan and pinch ------------------------------------------------- */

    /** @type {Map<number, { x: number, y: number }>} */
    const pointers = new Map();
    let pinchFrom = 0;

    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    frame.addEventListener('pointerdown', (event) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) pinchFrom = spread();
    });

    frame.addEventListener('pointermove', (event) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const box = frame.getBoundingClientRect();
      const aspect = box.height > 0 ? box.width / box.height : 1;
      const view = viewBoxFor({ center, tiles, aspect, width: floor.width, height: floor.height });

      if (pointers.size === 1) {
        center = panBy(
          center,
          { dx: event.clientX - last.x, dy: event.clientY - last.y },
          view,
          { width: box.width, height: box.height },
        );
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2 && pinchFrom > 0) {
        // Fingers apart zooms in, which means fewer tiles across.
        const now = spread();
        const change = Math.round(((pinchFrom - now) / pinchFrom) * tiles);
        if (change !== 0) {
          tiles = zoomBy(tiles, change);
          pinchFrom = now;
        }
      }
      paint();
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchFrom = 0;
    };
    frame.addEventListener('pointerup', release);
    frame.addEventListener('pointercancel', release);
    frame.addEventListener('pointerleave', release);

    /* -- the keys ------------------------------------------------------ */

    const zoom = (by) => {
      tiles = zoomBy(tiles, by);
      paint();
    };

    const controls = el('div', { class: 'region maskeys' }, [
      button({
        label: t('map.center'),
        onTap: () => {
          center = [...ex.pos];
          paint();
        },
      }),
      button({
        label: t('map.zoomOut'),
        ariaLabel: t('map.zoomOutLabel'),
        onTap: () => zoom(ZOOM.step),
      }),
      button({
        label: t('map.zoomIn'),
        ariaLabel: t('map.zoomInLabel'),
        onTap: () => zoom(-ZOOM.step),
      }),
    ]);

    const legend = el(
      'div',
      { class: 'region legend scroll-x', 'aria-label': t('map.legend') },
      LEGEND.map((kind) => {
        const swatch = svg('svg', { viewBox: '0 0 1 1', 'aria-hidden': 'true' });
        const shape = markShape({ kind, at: [0, 0], facing: 0 });
        if (shape) swatch.append(shape);
        const tag = chip(t(`map.legendNames.${kind}`));
        tag.prepend(swatch);
        return tag;
      }),
    );

    return {
      top: topBar({
        title: `${t('map.title')} ${floor.floor}`,
        sub: floor.spec.theme,
        onBack: () => router.back(),
        chips: [chip(`${t('explore.chips.steps')} ${ex.steps}`)],
      }),
      map: frame,
      legend,
      controls,
    };
  },
};
