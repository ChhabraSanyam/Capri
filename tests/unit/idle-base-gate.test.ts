import { describe, expect, it } from 'vitest';
import type { GestureId, PostureId } from '../../src/domain/animation-types.js';
import type { AvatarMode } from '../../src/domain/avatar-state.js';
import { idleBaseAllowedInMode, idleBaseGoal } from '../../src/domain/idle-base-gate.js';

const MODES: AvatarMode[] = ['idle', 'moving', 'perched', 'sitting', 'acting', 'away'];
const GESTURES: GestureId[] = [
  'wave', 'flick', 'point', 'shrug', 'celebrate', 'tease', 'stretch', 'fidget', 'glance', 'ignored', 'notify', 'sit', 'perch', 'none',
];
const POSTURES: Array<PostureId | 'none'> = ['sit', 'perch', 'none'];

describe('idle base gate (task 31.2)', () => {
  it('allows the idle clip only in free idle and away, and never while the follow glide moves her', () => {
    for (const mode of MODES) {
      expect(idleBaseAllowedInMode(mode, false)).toBe(mode === 'idle' || mode === 'away');
      expect(idleBaseAllowedInMode(mode, true)).toBe(false);
    }
  });

  it('targets the clip only with no posture and no gesture but glance', () => {
    for (const allowed of [true, false]) {
      for (const gesture of GESTURES) {
        for (const posture of POSTURES) {
          const expected = allowed && posture === 'none' && (gesture === 'none' || gesture === 'glance') ? 1 : 0;
          expect(idleBaseGoal(allowed, gesture, posture)).toBe(expected);
        }
      }
    }
  });
});
