/**
 * The dungeon view's rules (`07` section 4).
 *
 * Everything here is the part of `view.js` that is a decision rather than a
 * canvas call, so it runs in plain Node. The drawing itself is checked in a
 * real browser by `npm run view-check`, because a canvas is the only thing
 * that can answer whether it drew anything.
 */
import { describe, it, expect } from 'vitest';
import {
  TALL_FOV,
  WIDE_FOV,
  ASPECT,
  fovFor,
  aspectFor,
  LIGHT,
  lightFor,
  canvasSize,
  MAX_CANVAS_LONG_SIDE,
  angleForFacing,
  doorOffsets,
  easeInOut,
  lerpAngle,
  tweenPose,
  poseFor,
  STEP_MS,
  createAnimator,
} from '../src/dungeon/view.js';

describe('field of view', () => {
  it('uses a third of a turn across the tall frame', () => {
    expect(TALL_FOV).toBeCloseTo(Math.PI / 3, 10);
    expect(fovFor('tall')).toBe(TALL_FOV);
    expect(fovFor('wide')).toBe(WIDE_FOV);
  });

  it('derives the wide field of view exactly as 07 section 4 writes it', () => {
    // WIDE_FOV = 2 * atan( tan(TALL_FOV / 2) * (2 / 1.125) )
    const expected = 2 * Math.atan(Math.tan(TALL_FOV / 2) * (2 / 1.125));
    expect(WIDE_FOV).toBeCloseTo(expected, 12);
  });

  it('sees more of the world across the wide frame, not the same stretched', () => {
    expect(WIDE_FOV).toBeGreaterThan(TALL_FOV);
    // Widened in step with the view region's shape, which is what keeps wall
    // height the same between frames.
    expect(Math.tan(WIDE_FOV / 2) / Math.tan(TALL_FOV / 2)).toBeCloseTo(ASPECT.wide / ASPECT.tall, 10);
  });

  it('takes its aspect from the view region, not the frame', () => {
    // 07 section 4: 12 x 6 units wide, 9 x 8 tall.
    expect(aspectFor('wide')).toBe(2);
    expect(aspectFor('tall')).toBeCloseTo(9 / 8, 10);
  });
});

describe('light', () => {
  it('matches the distances 07 section 4 gives', () => {
    expect(LIGHT.torch.fogDistance).toBe(14);
    expect(LIGHT.lantern.fogDistance).toBe(16);
    expect(LIGHT.darkness.fogDistance).toBe(1.5);
  });

  it('flickers for a torch and nothing else', () => {
    expect(LIGHT.torch.flicker).toBe(true);
    expect(LIGHT.lantern.flicker).toBe(false);
    expect(LIGHT.darkness.flicker).toBe(false);
  });

  it('lets a Dark Zone beat whatever the hero is carrying', () => {
    // 03 section 8: torches give no light in magical darkness.
    expect(lightFor('torch', { inDarkZone: true })).toBe(LIGHT.darkness);
    expect(lightFor('lantern', { inDarkZone: true })).toBe(LIGHT.darkness);
  });

  it('lets a Light scroll see one tile further in the dark', () => {
    const scroll = lightFor('torch', { inDarkZone: true, lightScroll: true });
    expect(scroll).toBe(LIGHT.lightScroll);
    expect(scroll.fogDistance).toBeGreaterThan(LIGHT.darkness.fogDistance);
  });

  it('falls back to a torch for a light it does not know', () => {
    expect(lightFor('moonbeam')).toBe(LIGHT.torch);
  });
});

describe('canvas size', () => {
  it('keeps the view region\'s aspect ratio', () => {
    const box = canvasSize(400, 400, 2);
    expect(box.width / box.height).toBeCloseTo(2, 1);
  });

  it('fits inside the room it is given', () => {
    const box = canvasSize(400, 100, 2);
    expect(box.width).toBeLessThanOrEqual(400);
    expect(box.height).toBeLessThanOrEqual(100);
  });

  it('caps the long side, because every pixel is drawn in JavaScript', () => {
    // 07 section 4: about 480 px on the long side, and CSS scales it up.
    const big = canvasSize(2000, 1000, 2);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(MAX_CANVAS_LONG_SIDE);
    expect(big.width / big.height).toBeCloseTo(2, 1);
  });

  it('always comes out even, which is what resize() wants', () => {
    for (const [w, h, aspect] of [[391, 333, 9 / 8], [1007, 503, 2], [37, 21, 2]]) {
      const box = canvasSize(w, h, aspect);
      expect(box.width % 2, `${w}x${h}`).toBe(0);
      expect(box.height % 2, `${w}x${h}`).toBe(0);
      expect(box.width).toBeGreaterThanOrEqual(2);
      expect(box.height).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('facing', () => {
  it('points east at angle zero, and turns the way the map is drawn', () => {
    // Angle 0 looks along +X, and y grows downwards, so south is +PI/2.
    expect(angleForFacing(1)).toBe(0);
    expect(angleForFacing(2)).toBeCloseTo(Math.PI / 2, 10);
    expect(angleForFacing(3)).toBeCloseTo(Math.PI, 10);
    expect(angleForFacing(0)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('wraps round rather than falling off the end', () => {
    expect(angleForFacing(4)).toBe(angleForFacing(0));
    expect(angleForFacing(-1)).toBe(angleForFacing(3));
  });

  it('stands the hero in the middle of their tile', () => {
    // Integers fall on tile corners in the renderer's coordinates.
    expect(poseFor([3, 7], 1)).toEqual({ x: 3.5, y: 7.5, angle: 0 });
  });
});

describe('door offsets', () => {
  const doors = {
    '1,1': { kind: 'open' },
    '2,2': { kind: 'locked' },
    '3,3': { kind: 'stuck' },
    '4,4': { kind: 'sealed' },
  };

  it('draws an archway open and everything else shut', () => {
    const offsets = doorOffsets(doors);
    expect(offsets['1,1']).toEqual({ offset: 0.5 });
    expect(offsets['2,2']).toBeUndefined();
    expect(offsets['4,4']).toBeUndefined();
  });

  it('draws a door the hero has opened open', () => {
    const offsets = doorOffsets(doors, new Set(['2,2']));
    expect(offsets['2,2']).toEqual({ offset: 0.5 });
    expect(offsets['3,3']).toBeUndefined();
  });

  it('takes the opened set as a plain object too, which is what a save holds', () => {
    expect(doorOffsets(doors, { '3,3': true })['3,3']).toEqual({ offset: 0.5 });
  });

  it('copes with a floor that has no doors at all', () => {
    expect(doorOffsets(undefined)).toEqual({});
  });
});

describe('the movement tween', () => {
  it('takes the 140 ms 07 section 4 asks for', () => {
    expect(STEP_MS).toBe(140);
  });

  it('eases in and out, starting and ending still', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
    // Slower at the ends than in the middle.
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });

  it('clamps anything outside the step', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });

  it('turns the short way round', () => {
    // West to north is a quarter turn, not three quarters.
    const west = Math.PI;
    const north = -Math.PI / 2;
    const half = lerpAngle(west, north, 0.5);
    expect(Math.abs(half - west)).toBeLessThan(Math.PI / 2 + 0.001);
  });

  it('arrives exactly where it was going', () => {
    expect(lerpAngle(0, Math.PI / 2, 1)).toBeCloseTo(Math.PI / 2, 10);
    expect(lerpAngle(0, Math.PI / 2, 0)).toBe(0);
  });

  it('walks from one tile centre to the next', () => {
    const from = poseFor([1, 1], 1);
    const to = poseFor([2, 1], 1);
    expect(tweenPose(from, to, 0)).toEqual(from);
    expect(tweenPose(from, to, 1).x).toBeCloseTo(to.x, 10);
    const half = tweenPose(from, to, 0.5);
    expect(half.x).toBeGreaterThan(from.x);
    expect(half.x).toBeLessThan(to.x);
  });

  it('never moves the hero anywhere the step did not go', () => {
    const from = poseFor([5, 5], 0);
    const to = poseFor([5, 4], 0);
    for (let t = 0; t <= 1; t += 0.05) {
      const at = tweenPose(from, to, t);
      expect(at.x).toBe(from.x);
      expect(at.y).toBeLessThanOrEqual(from.y);
      expect(at.y).toBeGreaterThanOrEqual(to.y);
    }
  });
});

describe('the step animator', () => {
  /** A clock the test drives by hand, so the tween can be checked frame by frame. */
  function fakeClock() {
    let t = 0;
    let next = 1;
    /** @type {Map<number, (t: number) => void>} */
    const pending = new Map();
    return {
      now: () => t,
      schedule(cb) {
        const handle = next++;
        pending.set(handle, cb);
        return handle;
      },
      cancel(handle) {
        pending.delete(handle);
      },
      /** Runs every frame that is waiting, at the new time. */
      advance(ms) {
        t += ms;
        const due = [...pending.entries()];
        pending.clear();
        for (const [, cb] of due) cb(t);
      },
      get waiting() {
        return pending.size;
      },
    };
  }

  const setup = (options = {}) => {
    const clock = fakeClock();
    const drawn = [];
    const animator = createAnimator({
      draw: (pose) => drawn.push({ ...pose }),
      pose: poseFor([2, 2], 0),
      clock,
      ...options,
    });
    return { clock, drawn, animator };
  };

  it('starts where it was told to, without drawing', () => {
    const { animator, drawn } = setup();
    expect(animator.pose).toEqual(poseFor([2, 2], 0));
    expect(drawn).toHaveLength(0);
    expect(animator.running).toBe(false);
  });

  it('tweens a step over 140 ms and lands exactly on the target', async () => {
    const { animator, clock, drawn } = setup();
    const target = poseFor([2, 1], 0);

    const done = animator.moveTo(target);
    expect(animator.running).toBe(true);

    clock.advance(STEP_MS / 2);
    const middle = animator.pose;
    expect(middle.y).toBeLessThan(2.5);
    expect(middle.y).toBeGreaterThan(1.5);
    expect(middle).toEqual(tweenPose(poseFor([2, 2], 0), target, 0.5));

    clock.advance(STEP_MS / 2);
    await done;
    expect(animator.pose).toEqual(target);
    expect(animator.running).toBe(false);
    // Every frame drew, and the last one is the target.
    expect(drawn.length).toBeGreaterThan(2);
    expect(drawn.at(-1)).toEqual(target);
  });

  it('turns the short way round, west to north', async () => {
    const { animator, clock } = setup({ pose: poseFor([2, 2], 3) });
    const done = animator.moveTo(poseFor([2, 2], 0));
    clock.advance(STEP_MS / 2);
    // West is PI and north is -PI/2: the quarter turn goes on round, not back.
    expect(animator.pose.angle).toBeGreaterThan(Math.PI);
    clock.advance(STEP_MS);
    await done;
    expect(animator.pose.angle).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('starts a new step from what is on screen, and never loses the target', async () => {
    const { animator, clock } = setup();
    animator.moveTo(poseFor([2, 1], 0));
    clock.advance(STEP_MS / 2);
    const interrupted = animator.pose;

    const done = animator.moveTo(poseFor([2, 0], 0));
    expect(animator.pose).toEqual(interrupted);
    clock.advance(STEP_MS);
    await done;
    expect(animator.pose).toEqual(poseFor([2, 0], 0));
  });

  it('jumps with no tween when the game sets a pose, or when the tween is off', async () => {
    const { animator, clock, drawn } = setup();
    animator.set(poseFor([9, 9], 2));
    expect(animator.pose).toEqual(poseFor([9, 9], 2));
    expect(animator.running).toBe(false);
    expect(drawn.at(-1)).toEqual(poseFor([9, 9], 2));
    expect(clock.waiting).toBe(0);

    const instant = setup({ duration: 0 });
    await instant.animator.moveTo(poseFor([3, 3], 1));
    expect(instant.animator.pose).toEqual(poseFor([3, 3], 1));
    expect(instant.clock.waiting).toBe(0);
  });

  it('settles on the target when the screen changes mid-step', async () => {
    const { animator, clock } = setup();
    const done = animator.moveTo(poseFor([5, 2], 1));
    clock.advance(STEP_MS / 4);
    animator.settle();
    await done;
    expect(animator.pose).toEqual(poseFor([5, 2], 1));
    expect(animator.running).toBe(false);
    expect(clock.waiting).toBe(0);
  });

  it('redraws the same pose, which is what a rotation does', () => {
    const { animator, drawn } = setup();
    animator.redraw();
    animator.redraw();
    expect(drawn).toEqual([poseFor([2, 2], 0), poseFor([2, 2], 0)]);
  });
});
