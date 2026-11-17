import { describe, expect, it } from 'vitest';
import { AVATAR_TARGET_HEIGHT_M, AVATAR_VRM_URL } from '../../src/config/avatar-config';

describe('avatar-config', () => {
  it('builds the VRM URL from the base path, with no origin', () => {
    expect(AVATAR_VRM_URL).toBe(`${import.meta.env.BASE_URL}models/capri.vrm`);
    expect(AVATAR_VRM_URL).not.toMatch(/^https?:/u);
  });

  it('uses the 0.6 m desk-companion height', () => {
    expect(AVATAR_TARGET_HEIGHT_M).toBe(0.6);
  });
});
