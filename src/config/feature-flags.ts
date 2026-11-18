/**
 * Capability flags decided by the Milestone 0 spike. See `docs/spike-report.md` for the evidence
 * behind each value (real Meta Quest 3, Quest Browser OculusBrowser/156).
 *
 * Pure data. No DOM, no three, no IWSDK. Code reads these flags and never re-detects a capability
 * that the spike already settled.
 */

/** How the Grammar_Builder turns phrase groups into a Vosk grammar (assumption A10). */
export type GrammarStrategy = 'fragments' | 'utterances';

export interface FeatureFlags {
  /** Spike (b) anchors: an anchor held 1998 and 1540 frames with 0 lost, and a persistent handle was restored after reload. */
  readonly anchorsWork: boolean;
  /** Spike (b) semantic labels: populated on planes and meshes. */
  readonly semanticLabelsWork: boolean;
  /** Spike (b) mesh detection: 8 meshes at peak. */
  readonly meshWork: boolean;
  /** Spike (b) hit-test: pinch hit-tests returned hits. */
  readonly hitTestWork: boolean;
  /**
   * Spike (c): `getUserMedia` capture works while the AR session is running, but only after the
   * permission was already granted. The first permission prompt shown inside the AR session lost
   * the session, so the Setup_Page must request microphone permission before Enter AR.
   */
  readonly micInSession: boolean;
  /** Spike (d): vosk-browser loads and recognises on the headset (28/30 correct, 3/3 out-of-grammar rejected). */
  readonly voskWorks: boolean;
  /** Spike (d) composition probe: "turn off that" chained 3/3 with the fragment grammar. */
  readonly grammarStrategy: GrammarStrategy;
  /**
   * Point-pose gate (`requirePointPose`) for the pointing ray. The spike produced no data on it, so
   * this keeps the design default (on). Step 5 tunes it on the headset: in a dev build,
   * `?pointgate=0|1` overrides it for one page load (`resolvePointPoseGate`), and the final value
   * is set here.
   */
  readonly pointPoseGate: boolean;
  /** Spike (e): `window.speechSynthesis` does not exist in Quest Browser, so tier 2 is off. */
  readonly ttsUsable: boolean;
  /** Voice chosen for tier 2. None, because speechSynthesis is missing. */
  readonly ttsVoiceURI: string | undefined;
  /**
   * Bonus (Requirement 29.11): real-world depth occlusion of the Avatar. Depth occlusion works on
   * Quest (spike (b): 2411 of 2412 frames had depth data, a stand-in hid behind the user's hand),
   * but it never gates any other feature. When true, the session requests `depthSensing` (optional,
   * so the session still starts without it), `DepthSensingSystem` is registered, and the Avatar
   * carries `DepthOccludable`. It stays off until the frame time is measured with it on (task 27.6).
   */
  readonly depthOcclusion: boolean;
  /**
   * OPTIONAL clips (task 31.2, Requirement 32): after the Avatar has spawned, load the retargeted idle
   * clip (`public/animations/idle.vrma`) and play it as her base pose while she is idle. A missing
   * clip module or a failed load keeps the procedural idle. In a dev build `?clipidle=0|1` overrides
   * it for one page load (`resolveClipIdle`).
   */
  readonly clipIdle: boolean;
}

export const featureFlags: FeatureFlags = {
  anchorsWork: true,
  semanticLabelsWork: true,
  meshWork: true,
  hitTestWork: true,
  micInSession: true,
  voskWorks: true,
  grammarStrategy: 'fragments',
  pointPoseGate: true,
  ttsUsable: false,
  ttsVoiceURI: undefined,
  depthOcclusion: false,
  clipIdle: true,
};

/**
 * Whether to load the idle clip on this page load. In a dev build `?clipidle=0` turns it off and
 * `?clipidle=1` turns it on. Any other value, no parameter, or a production build gives
 * `featureFlags.clipIdle`. Pure: pass `window.location.search` and `import.meta.env.DEV`.
 */
export function resolveClipIdle(search: string, isDev: boolean): boolean {
  if (!isDev) return featureFlags.clipIdle;
  const value = new URLSearchParams(search).get('clipidle');
  if (value === '0') return false;
  if (value === '1') return true;
  return featureFlags.clipIdle;
}

/**
 * The point-pose gate for this page load. In a dev build, `?pointgate=0` turns the gate off and
 * `?pointgate=1` turns it on, so the gate can be compared on the headset without an edit. Any other
 * value, no parameter, or a production build (`isDev` false) gives `featureFlags.pointPoseGate`.
 * Pure: pass `window.location.search` and `import.meta.env.DEV` from the adapter.
 */
export function resolvePointPoseGate(search: string, isDev: boolean): boolean {
  if (!isDev) return featureFlags.pointPoseGate;
  const value = new URLSearchParams(search).get('pointgate');
  if (value === '0') return false;
  if (value === '1') return true;
  return featureFlags.pointPoseGate;
}
