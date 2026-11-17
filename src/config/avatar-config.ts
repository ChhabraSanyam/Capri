/**
 * Avatar_Config: the single place that names the VRM the app loads (Requirements 10.2, 10.3).
 *
 * To swap the Avatar, replace `public/models/capri.vrm` or change the path string below. Nothing
 * else in the code names a model file. Update `docs/THIRD_PARTY.md` and the README asset list
 * whenever the model changes (Requirements 10.5, 10.6).
 *
 * Pure data. No DOM, no three, no IWSDK.
 */
import { assetUrl } from './asset-url';

/** Base-relative URL of the Avatar VRM (VRM 0.x and 1.0 are both accepted by the loader). */
export const AVATAR_VRM_URL: string = assetUrl('models/capri.vrm');

/**
 * Desk-companion height in metres. The loader measures the VRM and scales it uniformly to this
 * height, so any model fits the room the same way. Tunable on the headset.
 */
export const AVATAR_TARGET_HEIGHT_M = 0.6;
