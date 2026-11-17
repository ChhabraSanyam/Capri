import { describe, expect, it } from 'vitest';
import { AvatarStateMachine } from '../../src/domain/avatar-state.js';

describe('AvatarStateMachine', () => {
  it('starts idle and not driving', () => {
    const m = new AvatarStateMachine();
    expect(m.mode).toBe('idle');
    expect(m.driving).toBe(false);
  });

  it('ends each trip in the mode its purpose names', () => {
    const cases = [
      ['perch', 'perched'],
      ['sit', 'sitting'],
      ['away', 'away'],
      ['float', 'idle'],
      ['home', 'idle'],
    ] as const;
    for (const [purpose, mode] of cases) {
      const m = new AvatarStateMachine();
      expect(m.requestMove(purpose)).toBe(true);
      expect(m.mode).toBe('moving');
      expect(m.arrive()).toBe(mode);
    }
  });

  it('stays anchored after a float trip until a home trip ends', () => {
    const m = new AvatarStateMachine();
    m.requestMove('float');
    m.arrive();
    expect(m.mode).toBe('idle');
    expect(m.driving).toBe(true);
    m.requestMove('home');
    m.arrive();
    expect(m.driving).toBe(false);
  });

  it('moves again from perched, sitting, and away', () => {
    for (const purpose of ['perch', 'sit', 'away'] as const) {
      const m = new AvatarStateMachine();
      m.requestMove(purpose);
      m.arrive();
      expect(m.requestMove('home')).toBe(true);
      expect(m.mode).toBe('moving');
    }
  });

  it('acts from a rest mode and returns to it, and refuses while moving or acting', () => {
    const m = new AvatarStateMachine();
    m.requestMove('sit');
    expect(m.beginAction()).toBe(false);
    m.arrive();
    expect(m.beginAction()).toBe(true);
    expect(m.mode).toBe('acting');
    expect(m.beginAction()).toBe(false);
    expect(m.requestMove('home')).toBe(false);
    expect(m.mode).toBe('acting');
    m.endAction();
    expect(m.mode).toBe('sitting');
  });

  it('reset returns to the unanchored idle', () => {
    const m = new AvatarStateMachine();
    m.requestMove('float');
    m.arrive();
    m.reset();
    expect(m.mode).toBe('idle');
    expect(m.driving).toBe(false);
  });
});
