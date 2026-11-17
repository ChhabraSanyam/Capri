import { Group } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadAvatar } from '../../src/avatar/avatar-loader.js';

const URL = '/models/missing.vrm';

describe('loadAvatar failure paths', () => {
  it('returns a network error when the fetch fails, without throwing', async () => {
    const result = await loadAvatar(URL, {
      loadGltf: () => Promise.reject(new Error(`fetch for "${URL}" responded with 404: Not Found`)),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      expect(result.error.url).toBe(URL);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it('returns an invalid-model error when the file cannot be parsed', async () => {
    const result = await loadAvatar(URL, {
      loadGltf: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid_model');
  });

  it('returns not_vrm for a plain glTF without VRM data', async () => {
    const gltf = { scene: new Group(), userData: {} } as unknown as GLTF;
    const result = await loadAvatar(URL, { loadGltf: () => Promise.resolve(gltf) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not_vrm');
  });
});
