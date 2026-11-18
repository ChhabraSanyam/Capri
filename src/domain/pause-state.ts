/**
 * When the experience is paused (task 27.2, Requirement 28.2). Pure: the inputs are plain values,
 * read by `ui/pause.ts` from the XR session and the page.
 *
 * - In an immersive session only the session's own `visibilityState` counts: `visible-blurred` (the
 *   Meta system menu, a permission prompt) and `hidden` (the headset off, another app) pause it. The
 *   page's `document.visibilityState` is ignored there, because some browsers report the 2D page as
 *   hidden for the whole time an immersive session is presenting.
 * - Outside a session a hidden page pauses it (another tab, the browser minimised).
 * - A manual pause (the dev seam) pauses it anywhere.
 */

/** The XR session's visibility, or `non-immersive` when no session is presenting. */
export type SessionVisibility = 'visible' | 'visible-blurred' | 'hidden' | 'non-immersive';

export type PauseReason = 'session-blurred' | 'session-hidden' | 'page-hidden' | 'manual';

export interface PauseInputs {
  readonly sessionVisibility: SessionVisibility;
  readonly documentHidden: boolean;
  readonly manual: boolean;
}

/** Why the experience is paused, or `undefined` when it runs. */
export function pauseReason(inputs: PauseInputs): PauseReason | undefined {
  switch (inputs.sessionVisibility) {
    case 'visible-blurred':
      return 'session-blurred';
    case 'hidden':
      return 'session-hidden';
    case 'visible':
      return inputs.manual ? 'manual' : undefined;
    case 'non-immersive':
      if (inputs.documentHidden) return 'page-hidden';
      return inputs.manual ? 'manual' : undefined;
  }
}

/** Map any `XRSession.visibilityState` value (or none) to a `SessionVisibility`. Unknown values count as visible. */
export function toSessionVisibility(state: string | undefined): SessionVisibility {
  if (state === undefined) return 'non-immersive';
  if (state === 'visible-blurred' || state === 'hidden' || state === 'non-immersive') return state;
  return 'visible';
}
