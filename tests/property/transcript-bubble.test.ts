import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bubblesOverlap, stackTranscriptBubble, type BubbleRect } from '../../src/domain/bubble-stack.js';
import type { SpeechFailureReason } from '../../src/domain/speech-lang/speech-recognizer-port.js';
import { describeVoice, TranscriptBubbleModel, type VoiceStatus } from '../../src/domain/voice-ui-model.js';

// Feature: capri-spatial-companion, Property 53: Transcript_Bubble states and stacking
// **Validates: Requirements 33.24, 33.25, 33.26, 33.27, 33.28**

const FINAL_HOLD_S = 2.5;
const NOTICE_S = 2.5;
const EPS = 1e-6;

type StatusName = 'ready' | 'loading' | SpeechFailureReason;
const STATUS_NAMES: readonly StatusName[] = ['ready', 'loading', 'permission-not-granted', 'mic-unavailable', 'model-failed'];
const statusOf = (name: StatusName): VoiceStatus =>
  name === 'ready' ? describeVoice('ready', undefined) : name === 'loading' ? describeVoice('loading', undefined) : describeVoice('ready', name);

type Event =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'level'; level: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'status'; name: StatusName }
  | { type: 'tick'; dt: number };

const textArb = fc.oneof(
  fc.constantFrom('', '  ', 'turn off', 'turn on that', 'come here', 'dim the desk lamp'),
  fc.array(fc.constantFrom('turn', 'on', 'off', 'that', 'lamp', 'sit'), { minLength: 1, maxLength: 4 }).map((w) => w.join(' ')),
);
const eventArb: fc.Arbitrary<Event> = fc.oneof(
  { weight: 2, arbitrary: fc.constant<Event>({ type: 'start' }) },
  { weight: 2, arbitrary: fc.constant<Event>({ type: 'end' }) },
  { weight: 1, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }).map<Event>((level) => ({ type: 'level', level })) },
  { weight: 3, arbitrary: textArb.map<Event>((text) => ({ type: 'partial', text })) },
  { weight: 2, arbitrary: textArb.map<Event>((text) => ({ type: 'final', text })) },
  { weight: 2, arbitrary: fc.constantFrom(...STATUS_NAMES).map<Event>((name) => ({ type: 'status', name })) },
  { weight: 5, arbitrary: fc.double({ min: 0.001, max: 1.2, noNaN: true }).map<Event>((dt) => ({ type: 'tick', dt })) },
);

/** What the timeline implies, tracked beside the model. */
interface Oracle {
  status: VoiceStatus;
  ptt: boolean;
  /** Push_To_Talk began with voice ready and it stayed ready; no words since. */
  cleanListen: boolean;
  /** The latest non-empty partial of a clean listen, or undefined. */
  partial: string | undefined;
  /** Seconds since the last non-empty final, or undefined (reset by a start). */
  finalAgeS: number | undefined;
  finalText: string;
  /** Seconds since a start with voice unavailable, while only ticks, levels, and the release followed. */
  noticeAgeS: number | undefined;
  noticeText: string;
}

describe('Property 53: Transcript_Bubble states and stacking', () => {
  it('shows listening, the latest words, hides within 3 s of a final, and shows a failure reason for 2.5 s', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATUS_NAMES), fc.array(eventArb, { maxLength: 60 }), (initial, events) => {
        const model = new TranscriptBubbleModel({ finalHoldS: FINAL_HOLD_S, noticeS: NOTICE_S });
        const o: Oracle = {
          status: statusOf(initial),
          ptt: false,
          cleanListen: false,
          partial: undefined,
          finalAgeS: undefined,
          finalText: '',
          noticeAgeS: undefined,
          noticeText: '',
        };
        model.setStatus(o.status);
        for (const event of events) {
          switch (event.type) {
            case 'start':
              model.setListening(true);
              if (!o.ptt) {
                o.ptt = true;
                o.cleanListen = o.status.chip === undefined;
                o.partial = undefined;
                o.finalAgeS = undefined;
                o.noticeAgeS = o.status.chip === undefined ? undefined : 0;
                o.noticeText = o.status.chip ?? '';
              }
              break;
            case 'end':
              model.setListening(false);
              o.ptt = false;
              o.cleanListen = false;
              break;
            case 'level':
              model.setLevel(event.level);
              break;
            case 'partial':
              model.setPartial(event.text);
              if (o.ptt && event.text.trim() !== '') {
                o.noticeAgeS = undefined;
                if (o.cleanListen) o.partial = event.text;
              } else if (o.ptt && o.cleanListen) {
                // An empty latest result has no words to show, so the bubble is back to listening.
                o.partial = undefined;
              }
              break;
            case 'final':
              model.setFinal(event.text);
              o.ptt = false;
              o.cleanListen = false;
              o.partial = undefined;
              if (event.text.trim() !== '') {
                o.finalAgeS = 0;
                o.finalText = event.text.trim();
                o.noticeAgeS = undefined;
              }
              break;
            case 'status':
              o.status = statusOf(event.name);
              model.setStatus(o.status);
              if (o.status.chip !== undefined) o.cleanListen = false;
              o.noticeAgeS = undefined;
              break;
            case 'tick':
              model.tick(event.dt);
              if (o.finalAgeS !== undefined) o.finalAgeS += event.dt;
              if (o.noticeAgeS !== undefined) o.noticeAgeS += event.dt;
              break;
          }

          const view = model.view;
          // Requirement 33.24: listening while push-to-talk is on and no words have arrived.
          if (o.ptt && o.cleanListen && o.partial === undefined) {
            expect(view.kind).toBe('listening');
          }
          // Requirement 33.25: the latest result text.
          if (o.ptt && o.cleanListen && o.partial !== undefined) {
            expect(view).toEqual({ kind: 'partial', text: o.partial });
          }
          if (event.type === 'final' && event.text.trim() !== '') {
            expect(view).toEqual({ kind: 'final', text: o.finalText });
          }
          // Requirement 33.26: hidden no later than 3 s after the final.
          if (!o.ptt && o.finalAgeS !== undefined && o.finalAgeS >= 3 && o.noticeAgeS === undefined) {
            expect(view.kind).toBe('hidden');
          }
          // Requirement 33.28: the reason shows for 2.5 s, then the bubble hides.
          if (o.noticeAgeS !== undefined) {
            if (o.noticeAgeS < NOTICE_S - EPS) expect(view).toEqual({ kind: 'notice', text: o.noticeText });
            else if (o.noticeAgeS > NOTICE_S + EPS && o.finalAgeS === undefined) expect(view.kind).toBe('hidden');
          }
          // The level is only reported while listening, and always in [0, 1].
          expect(model.level).toBeGreaterThanOrEqual(0);
          expect(model.level).toBeLessThanOrEqual(1);
          if (view.kind !== 'listening') expect(model.level).toBe(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  const coord = fc.double({ min: -5, max: 5, noNaN: true });
  const half = (min: number, max: number) => fc.double({ min, max, noNaN: true });
  const rectArb: fc.Arbitrary<BubbleRect> = fc.record({
    center: fc.record({ x: coord, y: fc.double({ min: 0, max: 3, noNaN: true }), z: coord }),
    halfWidthM: half(0.05, 0.4),
    halfHeightM: half(0.02, 0.2),
  });

  it('never overlaps the Speech_Bubble: alone when clear, stacked above it, or replaced', () => {
    fc.assert(
      fc.property(
        fc.option(rectArb, { nil: undefined }),
        rectArb,
        half(0.005, 0.05),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (speech, own, gapM, maxCenterY) => {
          const size = { halfWidthM: own.halfWidthM, halfHeightM: own.halfHeightM };
          const place = stackTranscriptBubble(own.center, size, speech, { gapM, maxCenterY });
          if (speech === undefined) {
            expect(place).toMatchObject({ kind: 'alone', x: own.center.x, y: own.center.y, z: own.center.z });
            return;
          }
          if (place.kind === 'replaced') {
            expect(place.y).toBeGreaterThan(maxCenterY);
            return;
          }
          const placed: BubbleRect = { center: { x: place.x, y: place.y, z: place.z }, ...size };
          expect(bubblesOverlap(placed, speech)).toBe(false);
          if (place.kind === 'stacked') {
            expect(place.y).toBeLessThanOrEqual(maxCenterY);
            expect(place.y).toBeGreaterThan(speech.center.y);
          } else {
            expect(place).toMatchObject({ x: own.center.x, y: own.center.y, z: own.center.z });
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
