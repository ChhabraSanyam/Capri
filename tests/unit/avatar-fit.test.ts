import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyLoadFailure,
  computeAvatarMetrics,
  computeFitScale,
  scaleMetrics,
  type RigReading,
} from '../../src/avatar/avatar-fit.js';

/** A 1.6 m model standing on y = 0, T-pose arms along X, eyes at 1.5 m. */
const READING: RigReading = {
  minY: 0,
  maxY: 1.6,
  hips: [0, 0.9, 0],
  head: [0, 1.45, 0],
  leftEye: [0.03, 1.5, 0.08],
  rightEye: [-0.03, 1.5, 0.08],
  upperArm: [0.2, 1.3, 0],
  lowerArm: [0.5, 1.3, 0],
  hand: [0.8, 1.3, 0],
};

describe('computeAvatarMetrics', () => {
  it('measures height, hips, eyes, and arm length from the rest pose', () => {
    const m = computeAvatarMetrics(READING);
    expect(m).not.toBeNull();
    expect(m!.height).toBeCloseTo(1.6);
    expect(m!.hipHeight).toBeCloseTo(0.9);
    expect(m!.eyeHeight).toBeCloseTo(1.5);
    expect(m!.armLength).toBeCloseTo(0.6);
  });

  it('measures relative to the feet when the box does not start at zero', () => {
    const m = computeAvatarMetrics({ ...READING, minY: -0.1, maxY: 1.5 });
    expect(m!.height).toBeCloseTo(1.6);
    expect(m!.hipHeight).toBeCloseTo(1.0);
  });

  it('estimates the eyes from the head bone when the eye bones are missing', () => {
    const m = computeAvatarMetrics({ ...READING, leftEye: null, rightEye: null });
    expect(m!.eyeHeight).toBeCloseTo(1.45 + 0.05 * 1.6);
  });

  it('returns null for a zero height, a non-finite height, or missing hips', () => {
    expect(computeAvatarMetrics({ ...READING, maxY: 0 })).toBeNull();
    expect(computeAvatarMetrics({ ...READING, maxY: Number.NaN })).toBeNull();
    expect(computeAvatarMetrics({ ...READING, hips: null })).toBeNull();
  });
});

describe('computeFitScale', () => {
  it('scales a 1.6 m model to 0.6 m', () => {
    expect(computeFitScale(1.6, 0.6)).toBeCloseTo(0.375);
  });

  it('rejects unusable heights', () => {
    expect(computeFitScale(0, 0.6)).toBeNull();
    expect(computeFitScale(-1, 0.6)).toBeNull();
    expect(computeFitScale(Number.POSITIVE_INFINITY, 0.6)).toBeNull();
    expect(computeFitScale(1.6, 0)).toBeNull();
  });

  it('makes the scaled height equal the target for any positive model height', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0.05, max: 3, noNaN: true }),
        (modelHeight, target) => {
          const scale = computeFitScale(modelHeight, target);
          expect(scale).not.toBeNull();
          const metrics = computeAvatarMetrics({ ...READING, minY: 0, maxY: modelHeight, hips: [0, modelHeight / 2, 0] });
          expect(scaleMetrics(metrics!, scale!).height).toBeCloseTo(target, 9);
        },
      ),
    );
  });
});

describe('classifyLoadFailure', () => {
  it('treats fetch and HTTP failures as network errors', () => {
    expect(classifyLoadFailure(new Error('fetch for "/models/capri.vrm" responded with 404: Not Found'))).toBe('network');
    expect(classifyLoadFailure(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('treats other failures as an invalid model', () => {
    expect(classifyLoadFailure(new SyntaxError('Unexpected token < in JSON'))).toBe('invalid_model');
    expect(classifyLoadFailure(42)).toBe('invalid_model');
  });
});
