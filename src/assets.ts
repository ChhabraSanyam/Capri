/**
 * Asset manifest shared by the app runtime and the editor. It is evaluated in two JS realms, so it
 * must stay deterministic and side-effect free (no World, DOM, timers, or shared object identity).
 *
 * The product registers no scene content here yet. The avatar VRM is loaded by `avatar-loader.ts`
 * from `config/avatar-config.ts` (task 5.8), and any later URL goes through `assetUrl()` so no
 * origin is hard-coded (Requirement 30.8).
 */
import { defineAssets } from '@iwsdk/core';

export default defineAssets({});
