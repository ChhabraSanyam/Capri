/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * Vite copies everything under `public/` into `dist/`, including the `AGENTS.md` guidance files that
 * sit next to the scenes and UI panels. They are not part of the app, so remove them after the copy.
 */
function dropPublicAgentsFiles(): Plugin {
  let outDir = '';
  return {
    name: 'capri:drop-public-agents-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name === 'AGENTS.md') rmSync(path);
        }
      };
      walk(outDir);
    },
  };
}

export default defineConfig({
  // iwsdkDev() also serves the dev server over HTTPS (WebXR needs a secure context). It generates a
  // self-signed certificate in `.iwsdk/https/` and fills `server.https` only when this file leaves
  // it unset, so do not set `server.https` here. Quest Browser shows a certificate warning once.
  plugins: [iwsdkDev(), dropPublicAgentsFiles()],
  // `host: '0.0.0.0'` exposes the dev server on the LAN IP so the Quest can open it.
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    // spike.html is the Milestone 0 harness. It is a second entry so the hosted build serves it too.
    rollupOptions: { input: { main: './index.html', spike: './spike.html' } },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
      // Spike item (d) imports it on demand. Without this, Vite finds it mid-session, re-optimizes,
      // and reloads the page, which would end the AR session.
      'vosk-browser',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: '/',
  // @iwsdk/core reads `import.meta.env?.DEV`, so Vite inlines the whole env object, with every
  // variable matching this prefix. Vercel adds VITE_VERCEL_* system variables (the production
  // domain, the git author and commit message), so the default `VITE_` prefix would put those in
  // dist/. Only the development placeholders from .env.example match this prefix.
  envPrefix: 'VITE_DEV_',
});
