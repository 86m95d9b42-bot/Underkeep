/**
 * The dungeon view: everything Underkeep wraps around the vendored raycaster
 * (`07` section 4).
 *
 * This is a renderer, so it is the one file under `src/dungeon/` besides the
 * raycaster itself that touches the DOM (docs/DECISIONS.md). Everything in it
 * that is a rule rather than a canvas call — the field of view, the light
 * sources, the door offsets, the movement tween — is a pure function exported
 * on its own, so it can be tested in Node without a browser.
 */
import Raycaster from './raycaster.js';
import { TILE } from './floor-builder.js';

/**
 * The tall frame's horizontal field of view (`07` section 4).
 * The view region is 9 units wide by 8 tall there, and 12 by 6 in the wide
 * frame, which is where the two aspect ratios come from.
 */
export const TALL_FOV = Math.PI / 3;

/** The view region's own shape, not the frame's. */
export const ASPECT = { tall: 9 / 8, wide: 2 };

/**
 * The wide frame's field of view is derived from the tall one so wall height
 * stays identical between frames: the renderer's vertical field of view comes
 * from canvas height, so widening the canvas must widen the horizontal field
 * of view by the same factor (`07` section 4).
 */
export const WIDE_FOV = 2 * Math.atan(Math.tan(TALL_FOV / 2) * (ASPECT.wide / ASPECT.tall));

/** @param {'tall' | 'wide'} frame */
export function fovFor(frame) {
  return frame === 'wide' ? WIDE_FOV : TALL_FOV;
}

/** @param {'tall' | 'wide'} frame */
export function aspectFor(frame) {
  return frame === 'wide' ? ASPECT.wide : ASPECT.tall;
}

/**
 * How far the hero can see, by what is lighting the way (`07` section 4;
 * `03` section 8 for Dark Zones).
 */
export const LIGHT = {
  torch: { fogDistance: 14, flicker: true },
  lantern: { fogDistance: 16, flicker: false },
  darkness: { fogDistance: 1.5, flicker: false },
  lightScroll: { fogDistance: 2.5, flicker: false },
};

/**
 * The light to render by. A Dark Zone overrides whatever the hero is carrying:
 * torches give no light there, and only a Light scroll helps (`03` section 8).
 *
 * @param {keyof typeof LIGHT} source what the hero is carrying
 * @param {{ inDarkZone?: boolean, lightScroll?: boolean }} [where]
 */
export function lightFor(source, { inDarkZone = false, lightScroll = false } = {}) {
  if (inDarkZone) return lightScroll ? LIGHT.lightScroll : LIGHT.darkness;
  return LIGHT[source] ?? LIGHT.torch;
}

/**
 * Rendering is per-pixel in JavaScript, so the canvas is capped on its long
 * side and CSS scales it up; the chunky look suits the art direction
 * (`07` section 4).
 */
export const MAX_CANVAS_LONG_SIDE = 480;

/**
 * The pixel box to render at, for a view region of this size on screen.
 * @param {number} availW CSS pixels
 * @param {number} availH CSS pixels
 * @param {number} aspect
 * @param {number} [cap]
 */
export function canvasSize(availW, availH, aspect, cap = MAX_CANVAS_LONG_SIDE) {
  let w = Math.max(2, availW);
  let h = w / aspect;
  if (h > availH) {
    h = Math.max(2, availH);
    w = h * aspect;
  }
  const longSide = Math.max(w, h);
  if (longSide > cap) {
    const scale = cap / longSide;
    w *= scale;
    h *= scale;
  }
  // Even numbers keep the pixel layout clean, which is what resize() wants.
  return { width: Math.max(2, Math.round(w) & ~1), height: Math.max(2, Math.round(h) & ~1) };
}

/** Facings, as the vendored `deadEndFacing` numbers them: 0 N, 1 E, 2 S, 3 W. */
export const FACING_ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

/**
 * The renderer's angle for a facing. Angle 0 looks along +X, and y grows
 * downwards on the map, so south is +PI/2.
 * @param {number} facing
 */
export function angleForFacing(facing) {
  return FACING_ANGLE[((facing % 4) + 4) % 4];
}

/**
 * How far a door has swung open, as the raycaster wants it: "x,y" to an
 * offset from 0 (shut) to 0.5 (fully open).
 *
 * A door the hero has opened stays open; everything else is drawn shut. Secret
 * doors are not here at all — until found they are wall, and the raycaster
 * draws an ILLUSION tile as wall of its own accord.
 *
 * @param {Record<string, any>} doors the floor's door table
 * @param {Set<string> | Record<string, boolean>} [opened] which have been opened
 */
export function doorOffsets(doors, opened = new Set()) {
  const isOpen = (at) => (opened instanceof Set ? opened.has(at) : Boolean(opened[at]));
  /** @type {Record<string, { offset: number }>} */
  const offsets = {};
  for (const [at, door] of Object.entries(doors ?? {})) {
    // An archway is a hole in the wall, so it is always drawn open.
    if (door.kind === 'open' || isOpen(at)) offsets[at] = { offset: 0.5 };
  }
  return offsets;
}

/* -------------------------------------------------------------------------- */
/* Movement: display only                                                     */
/* -------------------------------------------------------------------------- */

/** How long a step or a turn takes to draw (`07` section 4). */
export const STEP_MS = 140;

/** @param {number} t 0 to 1 */
export function easeInOut(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - (-2 * clamped + 2) ** 2 / 2;
}

/**
 * The shorter way round between two angles, so turning from west to north
 * sweeps a quarter turn rather than three quarters.
 * @param {number} from @param {number} to @param {number} t
 */
export function lerpAngle(from, to, t) {
  const turn = Math.PI * 2;
  let delta = (((to - from) % turn) + turn) % turn;
  if (delta > Math.PI) delta -= turn;
  return from + delta * t;
}

/**
 * Where to draw the hero partway through a step.
 *
 * The tween is display only: the game state changed in one step and the save
 * was written before this started (`07` section 4, CLAUDE.md "Resolve first,
 * render second").
 *
 * @param {{ x: number, y: number, angle: number }} from
 * @param {{ x: number, y: number, angle: number }} to
 * @param {number} t 0 to 1, before easing
 */
export function tweenPose(from, to, t) {
  const eased = easeInOut(t);
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    angle: lerpAngle(from.angle, to.angle, eased),
  };
}

/**
 * The world position of a tile's centre. Integers fall on tile corners in the
 * renderer's coordinates, so a tile's middle is half a unit in.
 * @param {[number, number]} pos
 * @param {number} facing
 */
export function poseFor([x, y], facing) {
  return { x: x + 0.5, y: y + 0.5, angle: angleForFacing(facing) };
}

/* -------------------------------------------------------------------------- */
/* The canvas                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Wires the vendored raycaster to a canvas.
 *
 * The renderer is recreated on a frame change rather than reconfigured: it
 * only allocates buffers and lookup tables, and its field of view is fixed at
 * creation (`07` section 4).
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {'tall' | 'wide'} options.frame
 * @param {keyof typeof LIGHT} [options.light]
 */
export function createView({ canvas, frame, light = 'torch' }) {
  let current = frame;
  let lit = light;
  let rc = null;
  let box = { width: 0, height: 0 };

  const build = () => {
    const settings = LIGHT[lit] ?? LIGHT.torch;
    rc = Raycaster.create(canvas, {
      fov: fovFor(current),
      aspect: aspectFor(current),
      fogDistance: settings.fogDistance,
      flicker: settings.flicker,
      tiles: TILE,
    });
    if (box.width) rc.resize(box.width, box.height);
  };
  build();

  return {
    get frame() {
      return current;
    },

    /**
     * Sets the pixel box from the view region's size on screen, capped so the
     * per-pixel work stays affordable on a phone.
     * @param {number} availW @param {number} availH
     */
    resize(availW, availH) {
      box = canvasSize(availW, availH, aspectFor(current), MAX_CANVAS_LONG_SIDE);
      rc.resize(box.width, box.height);
      return box;
    },

    /**
     * Rotation changes the view's shape, so the renderer is rebuilt and the
     * screen is redrawn from the same state — nothing about the game moves.
     * @param {'tall' | 'wide'} next
     */
    setFrame(next) {
      if (next === current) return;
      current = next;
      build();
    },

    /** @param {keyof typeof LIGHT} next */
    setLight(next) {
      if (next === lit) return;
      lit = next;
      build();
    },

    /**
     * Draws one frame.
     * @param {object} state
     * @param {import('./floor-builder.js').Floor} state.floor
     * @param {{ x: number, y: number, angle: number }} state.pose
     * @param {Record<string, { offset: number }>} [state.doors]
     * @param {[number, number, number]} [state.fog]
     * @param {boolean} [state.floorCeiling]
     */
    render({ floor, pose, doors = {}, fog = [10, 8, 6], floorCeiling = false }) {
      rc.render({
        map: floor.map,
        mapW: floor.width,
        mapH: floor.height,
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        doorStates: doors,
        fillColor: fog,
        // No textures exist yet, so the flat shaded fallback is the look
        // (`07` section 4, "Art").
        texturesEnabled: false,
        floorCeilingEnabled: floorCeiling,
      });
    },
  };
}
