import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts on purpose: that file loads the IWSDK dev plugin,
// which starts the XR emulator tooling and must not run under tests.
// Pure src/domain/ code runs in Node. DOM tests opt in with `// @vitest-environment jsdom`.
export default defineConfig({
  // The idle clip test reads the shipped VRM Animation file as an inline data URL.
  assetsInclude: ['**/*.vrma'],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
