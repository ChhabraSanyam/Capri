/**
 * Call state (task 13.7, Requirements 22.5, 22.7, 22.8, 22.9). The single input to Persona wording
 * for a device call or a Hermes task:
 *
 * | state     | claims the Persona may use     |
 * |-----------|--------------------------------|
 * | `idle`    | `neutral`                      |
 * | `pending` | `ack`, `neutral`               |
 * | `success` | `done`, `neutral`              |
 * | `failure` | `fail`, `neutral`              |
 *
 * So "done" is never said before the call returned success, and a pending call is only ever
 * acknowledged.
 */
import { COMPLETION_WORDS, type VoiceCategory, type VoiceClaims } from '../speech/voice-manifest.js';

export type CallState = 'idle' | 'pending' | 'success' | 'failure';

export type CallEvent = 'start' | 'succeed' | 'fail' | 'reset';

/** Next state after an event. A result only counts while a call is pending. */
export function nextCallState(state: CallState, event: CallEvent): CallState {
  switch (event) {
    case 'start':
      return 'pending';
    case 'succeed':
      return state === 'pending' ? 'success' : state;
    case 'fail':
      return state === 'pending' ? 'failure' : state;
    case 'reset':
      return 'idle';
  }
}

/** The claim that carries the state's own message. */
export const STATE_CLAIMS: Readonly<Record<CallState, VoiceClaims>> = {
  idle: 'neutral',
  pending: 'ack',
  success: 'done',
  failure: 'fail',
};

export function claimAllowed(state: CallState, claims: VoiceClaims): boolean {
  return claims === 'neutral' || claims === STATE_CLAIMS[state];
}

/** Library categories that may be played in a state, in order of preference. */
export const STATE_CATEGORIES: Readonly<Record<CallState, readonly VoiceCategory[]>> = {
  idle: ['greeting', 'tease'],
  pending: ['confirm', 'thinking'],
  success: ['quip', 'celebrate', 'task-complete'],
  failure: ['error'],
};

/** True when `text` reports an action as finished. Not allowed in `ack` lines. */
export function claimsCompletion(text: string): boolean {
  return COMPLETION_WORDS.test(text);
}
