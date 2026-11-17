import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createSeededRng } from '../../src/app/rng.js';
import { NOTIFY } from '../../src/avatar/gestures/notify.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

const DT = 1 / 72;

describe('notify gesture', () => {
  it('is registered, raises the right hand, and resolves when it ends', async () => {
    const { vrm, root } = createTestVrm();
    const animator = new ProceduralAnimator({ vrm, root }, { rng: createSeededRng(3), waveOnFirstAppear: false });
    const f = createFrameContext();
    const run = (s: number) => {
      for (let i = 0, n = Math.round(s / DT); i < n; i++) animator.update(DT, f);
    };
    let done = false;
    void animator.play('notify').then(() => (done = true));
    run(DT);
    expect(animator.activeGesture).toBe('notify');
    run(0.8);
    const upper = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')!;
    // Rest +1.2 plus the -1.5 gesture offset, so the arm is up beside the shoulder.
    expect(2 * Math.atan2(upper.quaternion.z, upper.quaternion.w)).toBeCloseTo(-0.3, 1);
    run(NOTIFY.duration);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(animator.activeGesture).toBe('none');
    expect(2 * Math.atan2(upper.quaternion.z, upper.quaternion.w)).toBeCloseTo(1.2, 2);
  });
});
