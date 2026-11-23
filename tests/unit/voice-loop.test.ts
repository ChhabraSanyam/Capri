import { describe, expect, it } from 'vitest';
import manifestText from '../../voice/voice-manifest.txt?raw';
import { CapriApp } from '../../src/app/app.js';
import { createEventBus } from '../../src/app/events.js';
import { createManualClock } from '../../src/app/clock.js';
import { createFrameContext, type FrameContext } from '../../src/app/frame-context.js';
import { createLogger } from '../../src/app/logger.js';
import { createSeededRng } from '../../src/app/rng.js';
import { SpeechQueue } from '../../src/audio/speech-queue.js';
import { TalkGesture } from '../../src/app/talk-gesture.js';
import { VoiceLoop, type SttPort, type VoiceUiPort } from '../../src/app/voice-loop.js';
import type { VoiceAbilities } from '../../src/avatar/ability-dispatcher.js';
import { createMockHome } from '../../src/backends/mock/mock-home.js';
import type { LightState } from '../../src/backends/types.js';
import { HackRunner } from '../../src/domain/actions/hack-runner.js';
import { PlaceBook } from '../../src/domain/actions/places.js';
import { TimerService } from '../../src/domain/actions/timers.js';
import { MARKER_TINT_OFF, MARKER_TINT_UNKNOWN, markerTint } from '../../src/domain/devices/marker-tint.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { Persona } from '../../src/domain/persona/persona.js';
import type { Utterance } from '../../src/domain/persona/utterance.js';
import { PinchTracker } from '../../src/domain/pointing/pinch.js';
import type { PanelRect } from '../../src/domain/devices/teach-input.js';
import type { SpeechFailureReason } from '../../src/domain/speech-lang/speech-recognizer-port.js';
import { manifestFromVoiceIndex, parseVoiceIndex } from '../../src/domain/speech/voice-index.js';
import { parseVoiceManifest } from '../../src/domain/speech/voice-manifest.js';
import { PushToTalk } from '../../src/domain/voice/push-to-talk.js';
import { FakeHandSource } from '../../src/xr/fake-hands.js';

describe('PushToTalk', () => {
  it('keeps the microphone open 400 ms after the pinch is released', () => {
    const ptt = new PushToTalk();
    expect(ptt.pinchStart(1)).toBe('start');
    expect(ptt.pinchEnd(2)).toBeUndefined();
    expect(ptt.tick(2.39)).toBeUndefined();
    expect(ptt.tick(2.4)).toBe('stop');
    expect(ptt.active).toBe(false);
  });

  it('carries on when the pinch returns inside the trailing gap', () => {
    const ptt = new PushToTalk();
    ptt.pinchStart(0);
    ptt.pinchEnd(1);
    expect(ptt.pinchStart(1.2)).toBeUndefined();
    expect(ptt.tick(5)).toBeUndefined();
    ptt.pinchEnd(5);
    expect(ptt.tick(5.4)).toBe('stop');
  });

  it('keeps listening for as long as the pinch is held, with no time cap (33.23)', () => {
    const ptt = new PushToTalk();
    ptt.pinchStart(0);
    expect(ptt.tick(60)).toBeUndefined();
    expect(ptt.phase).toBe('listening');
    expect(ptt.pinchStart(61)).toBeUndefined();
    ptt.reset();
    expect(ptt.active).toBe(false);
    expect(ptt.tick(100)).toBeUndefined();
  });
});

describe('manifestFromVoiceIndex', () => {
  it('turns index lines into manifest lines with their claims', () => {
    const index = parseVoiceIndex({
      lines: [
        { id: 'confirm_01', category: 'confirm', claims: 'ack', text: 'On it.' },
        { id: 'quip_01', category: 'quip', text: 'Too easy.' },
        { id: 'quip_02', category: 'quip', text: '' },
      ],
    });
    const manifest = manifestFromVoiceIndex(index);
    expect(manifest.categories.confirm).toEqual([{ id: 'confirm_01', claims: 'ack', text: 'On it.' }]);
    expect(manifest.categories.quip).toEqual([{ id: 'quip_01', claims: 'done', text: 'Too easy.' }]);
    expect(manifest.categories.error).toEqual([]);
  });
});

describe('markerTint', () => {
  it('shows off dim, on in the light colour, and unknown as the plain marker', () => {
    expect(markerTint(undefined)).toEqual(MARKER_TINT_UNKNOWN);
    expect(markerTint({ on: false, brightnessPct: 100, rgb: [255, 0, 0] })).toEqual(MARKER_TINT_OFF);
    const lit = markerTint({ on: true, brightnessPct: 100, rgb: [255, 128, 0] });
    expect(lit.hex).toBe(0xff8000);
    expect(lit.opacity).toBe(1);
    const dim = markerTint({ on: true, brightnessPct: 30, rgb: [255, 128, 0] });
    expect(dim.opacity).toBeLessThan(lit.opacity);
    expect(dim.opacity).toBeGreaterThan(MARKER_TINT_OFF.opacity);
  });
});

describe('SpeechQueue', () => {
  function rig() {
    const spoken: string[] = [];
    const pending: ((value: { tier: 'bubble'; status: 'completed' | 'cancelled' }) => void)[] = [];
    const queue = new SpeechQueue({
      say: (u) => {
        spoken.push(u.text);
        return new Promise((resolve) => pending.push(resolve));
      },
      cancel: () => {
        spoken.push('<cancel>');
        pending.shift()?.({ tier: 'bubble', status: 'cancelled' });
      },
    });
    const line = (text: string, claims: Utterance['claims']): Utterance => ({ text, claims });
    return { spoken, pending, queue, line };
  }

  it('plays lines one after another', async () => {
    const { spoken, pending, queue, line } = rig();
    queue.enqueue(line('one', 'done'));
    queue.enqueue(line('two', 'done'));
    expect(spoken).toEqual(['one']);
    pending.shift()?.({ tier: 'bubble', status: 'completed' });
    await Promise.resolve();
    await Promise.resolve();
    expect(spoken).toEqual(['one', 'two']);
  });

  it('drops a waiting ack when the result arrives, and lets a playing one finish', async () => {
    const { spoken, pending, queue, line } = rig();
    queue.enqueue(line('on it', 'ack'));
    queue.enqueue(line('thinking', 'ack'));
    queue.enqueue(line('too easy', 'done'));
    expect(queue.pending).toBe(1);
    expect(spoken).toEqual(['on it']);
    pending.shift()?.({ tier: 'bubble', status: 'completed' });
    await Promise.resolve();
    await Promise.resolve();
    expect(spoken).toEqual(['on it', 'too easy']);
  });

  it('forgets the queue on a barge-in', () => {
    const { spoken, queue, line } = rig();
    queue.enqueue(line('a', 'neutral'));
    queue.enqueue(line('b', 'neutral'));
    queue.interrupt();
    expect(queue.pending).toBe(0);
    expect(spoken).toEqual(['a', '<cancel>']);
  });
});

// ---------------------------------------------------------------------------------------------
// The loop with real domain parts and fake edges (microphone, panels, avatar)
// ---------------------------------------------------------------------------------------------

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

function parsedManifest() {
  const parsed = parseVoiceManifest(manifestText);
  if (!parsed.ok) throw new Error('manifest');
  return parsed.manifest;
}

function loopRig(options: { startFailure?: SpeechFailureReason } = {}) {
  const clock = createManualClock(0);
  const events = createEventBus<import('../../src/app/events.js').AppEvents>(createLogger('test'));
  const home = createMockHome({ latencyMs: 0 });
  const registry = new DeviceRegistry({ events });
  const places = new PlaceBook();
  const timers = new TimerService(clock);
  const said: Utterance[] = [];
  const persona = new Persona({
    rng: createSeededRng(3),
    clock,
    manifest: parsedManifest(),
    deliver: (line) => void said.push(line),
  });
  const grammars: string[][] = [];
  let partialListener: (text: string) => void = () => undefined;
  let failureListener: (reason: SpeechFailureReason, message: string) => void = () => undefined;
  let starts = 0;
  let stops = 0;
  const stt: SttPort = {
    state: 'ready',
    start: () => {
      starts += 1;
      if (options.startFailure !== undefined) {
        return Promise.reject(Object.assign(new Error('start failed'), { reason: options.startFailure }));
      }
      return Promise.resolve();
    },
    stop: () => {
      stops += 1;
      return Promise.resolve('turn off that');
    },
    onPartial: (cb) => {
      partialListener = cb;
      return () => undefined;
    },
    onFailure: (cb) => {
      failureListener = cb;
      return () => undefined;
    },
    setGrammar: (phrases) => void grammars.push(phrases),
  };
  const ui = {
    listening: [] as boolean[],
    finals: [] as string[],
    partials: [] as string[],
    failures: [] as (SpeechFailureReason | undefined)[],
    /** Listening and failure calls in the order they came. */
    order: [] as string[],
  };
  const uiPort: VoiceUiPort = {
    setListening: (l) => {
      ui.listening.push(l);
      ui.order.push(`listening:${String(l)}`);
    },
    showPartial: (t) => void ui.partials.push(t),
    showFinal: (t) => void ui.finals.push(t),
    setFailure: (r) => {
      ui.failures.push(r);
      ui.order.push(`failure:${String(r)}`);
    },
  };
  const moves: string[] = [];
  const abilities: VoiceAbilities = {
    navigate: (r) => (moves.push(r.type), { status: 'started' }),
    lookAt: () => ({ status: 'done' }),
    pointAt: () => ({ status: 'done' }),
    lookAtUser: () => (moves.push('look_user'), { status: 'done' }),
  };
  const pointing = { pointed: undefined as string | undefined, selected: undefined as string | undefined, deictic: undefined as string | undefined, confirmPointed: () => undefined as string | undefined };
  const runner = new HackRunner({
    getAnimator: () => undefined,
    vfx: { flick: () => undefined, beam: () => undefined, pulse: () => undefined, hold: () => undefined, end: () => undefined },
    backend: home,
    persona: { say: (request) => persona.say(request, { gestures: false }) },
    resolveTarget: () => ({ x: 0, y: 1, z: -1 }),
    events,
  });
  const loop = new VoiceLoop({
    events,
    clock,
    logger: createLogger('test'),
    stt,
    ui: uiPort,
    registry,
    places,
    pointing,
    persona,
    abilities,
    runner,
    timers,
    getAnimator: () => undefined,
    getSurfaces: () => [],
    getHead: () => undefined,
    getGazeRay: () => ({ origin: { x: 0, y: 1.2, z: 0 }, direction: { x: 0, y: 0, z: -1 } }),
    getUiAim: () => ({ panels: [], buttonCenter: undefined }),
    canTalk: () => true,
    getDominant: () => 'right',
  });
  const lights = async (): Promise<readonly LightState[]> => {
    const result = await home.listLights();
    return result.ok ? result.value.map((l) => l.state) : [];
  };
  return {
    clock, events, home, registry, places, timers, said, grammars, loop, ui, moves, pointing, lights,
    counts: () => ({ starts, stops }),
    /** Run frames until the promise settles: light commands now play the hacking sequence first. */
    async settle<T>(promise: Promise<T>, maxFrames = 600): Promise<T> {
      let done = false;
      void promise.then(() => (done = true));
      for (let i = 0; i < maxFrames && !done; i += 1) {
        runner.update(1 / 30);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return promise;
    },
    partial: (text: string) => partialListener(text),
    failure: (reason: SpeechFailureReason) => failureListener(reason, 'test'),
    frame(time: number, inSession = true, leftPinching = false): FrameContext {
      const f = createFrameContext();
      f.time = time;
      f.dt = 1 / 60;
      f.inSession = inSession;
      f.hands.left.pinching = leftPinching;
      return f;
    },
    /** Hold the non-dominant (left) pinch at `time`: the hold-to-talk start edge. */
    pinch(time: number): void {
      loop.update(this.frame(time, true, false));
      loop.update(this.frame(time + 0.01, true, true));
    },
  };
}

describe('VoiceLoop', () => {
  it('runs "turn off that" end to end: the pointed bulb changes and Capri answers truthfully', async () => {
    const rig = loopRig();
    const device = rig.registry.add({ entityId: 'mock.bulb_1', name: 'desk lamp', position: { x: 0, y: 1, z: -1 } })!;
    await rig.home.applyCommand('mock.bulb_1', { kind: 'on' });
    rig.pointing.pointed = device.id;
    rig.pointing.deictic = device.id;

    await rig.settle(rig.loop.submitText('turn off that', 'speech'));

    expect((await rig.lights())[0]?.on).toBe(false);
    expect(rig.said.map((l) => l.claims)).toEqual(expect.arrayContaining(['ack', 'done']));
    const firstDone = rig.said.findIndex((l) => l.claims === 'done');
    expect(rig.said.findIndex((l) => l.claims === 'ack')).toBeLessThan(firstDone);
    expect(rig.said.some((l) => /desk lamp/i.test(l.text) && /off/i.test(l.text))).toBe(true);
  });

  it('says why a light call failed, using the backend message', async () => {
    const rig = loopRig();
    const device = rig.registry.add({ entityId: 'mock.ghost', name: 'ghost lamp', position: { x: 0, y: 1, z: -1 } })!;
    rig.pointing.pointed = device.id;
    await rig.settle(rig.loop.submitText('turn on that', 'speech'));
    const fail = rig.said.filter((l) => l.claims === 'fail');
    expect(fail.length).toBeGreaterThan(0);
    expect(fail.some((l) => l.text.includes('I cannot find that light.'))).toBe(true);
    expect(rig.said.some((l) => l.claims === 'done')).toBe(false);
  });

  it('rebuilds the grammar when a device or a place is added', async () => {
    const rig = loopRig();
    const initial = rig.grammars.length;
    expect(last(rig.grammars)).not.toContain('desk lamp');
    rig.registry.add({ entityId: 'mock.bulb_1', name: 'desk lamp', position: { x: 0, y: 1, z: -1 } });
    expect(rig.grammars.length).toBe(initial + 1);
    expect(last(rig.grammars)).toContain('desk lamp');
    expect(last(rig.grammars)).toContain('[unk]');
    await rig.loop.submitText('remember this as reading nook', 'keyboard');
    expect(rig.grammars.length).toBe(initial + 2);
    expect(last(rig.grammars)).toContain('reading nook');
    expect(rig.loop.grammar).toEqual(last(rig.grammars));
  });

  it('answers typed free-form chat with no agent with the in-character not-connected line', async () => {
    const rig = loopRig();
    await rig.loop.submitText('what is the capital of france', 'keyboard');
    expect(rig.said).toHaveLength(1);
    expect(rig.said[0]?.claims).toBe('neutral');
    expect(rig.said[0]?.text).toMatch(/hermes/i);
    expect(rig.said[0]?.text).toMatch(/setup page/i);
  });

  it('dispatches navigation, timers and places', async () => {
    const rig = loopRig();
    await rig.loop.submitText('come here', 'keyboard');
    await rig.loop.submitText('sit on the desk', 'keyboard');
    expect(rig.moves).toEqual(['come_here', 'sit_on']);
    await rig.loop.submitText('set a timer for five minutes', 'keyboard');
    expect(rig.timers.pending().map((t) => t.minutes)).toEqual([5]);
    await rig.loop.submitText('remember this as the shelf spot', 'keyboard');
    expect(rig.places.names()).toEqual(['shelf spot']);
    rig.clock.advance(5 * 60_000);
    rig.loop.updateOrchestrator();
    expect(last(rig.said)?.text).toMatch(/5 minutes/);
  });

  it('runs a tapped Commands row through the same path, with its words as the transcript (task 33.9)', async () => {
    const rig = loopRig();
    await rig.loop.runCommand('perch on the table');
    await rig.loop.runCommand('look at me');
    expect(rig.moves).toEqual(['perch', 'look_user']);
    expect(rig.ui.finals).toEqual(['perch on the table', 'look at me']);
    expect(rig.loop.lastProcessed?.intent).toEqual({ type: 'avatar', ability: 'look_at_me' });
  });

  it('says the not-connected line for "ask hermes", Ask Hermes, and a typed task without Hermes (task 33.9)', async () => {
    const rig = loopRig();
    await rig.loop.submitText('ask hermes', 'speech');
    await rig.loop.askHermes('what is the weather');
    await rig.loop.startHermesTask('clean up my notes');
    expect(rig.said).toHaveLength(3);
    for (const line of rig.said) expect(line.text).toMatch(/hermes/i);
  });

  it('runs push-to-talk from the hold-pinch: partial words, release, final text through the same path', async () => {
    const rig = loopRig();
    rig.pinch(1);
    expect(rig.counts().starts).toBe(1);
    expect(rig.ui.listening).toEqual([true]);
    rig.loop.update(rig.frame(1.5, true, true));
    rig.partial('turn off');
    expect(rig.ui.partials).toEqual(['turn off']);
    rig.loop.update(rig.frame(2, true, false));
    rig.loop.update(rig.frame(2.3, true, false));
    expect(rig.counts().stops).toBe(0);
    rig.loop.update(rig.frame(2.45, true, false));
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.counts().stops).toBe(1);
    expect(rig.ui.finals).toEqual(['turn off that']);
  });

  it('reports a start failure while Push_To_Talk is still on, so the bubble can show it (33.28)', async () => {
    const rig = loopRig({ startFailure: 'permission-not-granted' });
    rig.pinch(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rig.ui.order).toEqual(['listening:true', 'failure:permission-not-granted', 'listening:false']);
  });

  it('shows the fallback when starting fails for a microphone reason', async () => {
    const rig = loopRig();
    rig.failure('mic-unavailable');
    expect(last(rig.ui.failures)).toBe('mic-unavailable');
  });
});

describe('TalkGesture', () => {
  const DT = 1 / 60;
  function gestureRig() {
    const frame = createFrameContext();
    frame.inSession = true;
    frame.dt = DT;
    const hands = new FakeHandSource();
    const tracker = new PinchTracker();
    const gesture = new TalkGesture();
    const ui = { panels: [] as PanelRect[], buttonCenter: undefined as { x: number; y: number; z: number } | undefined };
    const edges: string[] = [];
    return {
      ui,
      edges,
      run(n: number, pose: 'point' | 'point-pinch' | null, canTalk = true): void {
        hands.setHand('left', pose === null ? null : { pose, target: { x: -0.2, y: 1.15, z: -2 } });
        for (let i = 0; i < n; i += 1) {
          frame.time += DT;
          hands.read(frame);
          tracker.update(frame.hands);
          const edge = gesture.update(frame, 'left', canTalk, () => ui);
          if (edge !== undefined) edges.push(edge);
        }
      },
    };
  }

  it('starts on a non-dominant pinch and ends on its release', () => {
    const rig = gestureRig();
    rig.run(20, 'point');
    rig.run(10, 'point-pinch');
    rig.run(10, 'point');
    expect(rig.edges).toEqual(['start', 'end']);
  });

  it('ignores a pinch aimed at a panel, and its release', () => {
    const rig = gestureRig();
    rig.ui.panels.push({ center: { x: -0.2, y: 1.15, z: -1.2 }, yawRad: 0, halfWidthM: 0.5, halfHeightM: 0.5 });
    rig.run(20, 'point');
    rig.run(10, 'point-pinch');
    rig.run(10, 'point');
    expect(rig.edges).toEqual([]);
  });

  it('ignores a pinch while another flow owns it', () => {
    const rig = gestureRig();
    rig.run(20, 'point');
    rig.run(10, 'point-pinch', false);
    rig.run(10, 'point', false);
    expect(rig.edges).toEqual([]);
  });
});

describe('VoiceLoop pause and resume (task 27.2)', () => {
  it('drops a push-to-talk in progress without acting on it, and starts none while paused', async () => {
    const rig = loopRig();
    rig.pinch(1);
    expect(rig.counts().starts).toBe(1);
    rig.loop.pause();
    expect(rig.loop.isPaused).toBe(true);
    expect(rig.loop.listening).toBe(false);
    expect(rig.ui.listening).toEqual([true, false]);
    expect(rig.counts().stops).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The words heard before the menu opened are not a command.
    expect(rig.loop.lastProcessed).toBeUndefined();
    expect(rig.said).toEqual([]);

    rig.pinch(2);
    expect(rig.counts().starts).toBe(1);

    rig.loop.resume();
    rig.pinch(3);
    expect(rig.counts().starts).toBe(2);
  });

  it('keeps a timer counting while paused and announces it on the first stage after the resume', async () => {
    const rig = loopRig();
    const app = new CapriApp({ logger: createLogger('test'), clock: rig.clock, isInSession: () => true });
    app.setStage('orchestrator', () => rig.loop.updateOrchestrator());
    await rig.loop.submitText('set a timer for two minutes', 'keyboard');
    expect(rig.timers.pending()).toHaveLength(1);
    const before = rig.said.length;

    app.setPaused(true);
    rig.loop.pause();
    rig.clock.advance(150_000);
    app.tick(1 / 72, 90);
    expect(rig.said.length).toBe(before);
    expect(rig.timers.pending()).toHaveLength(1);

    app.setPaused(false);
    rig.loop.resume();
    app.tick(1 / 72, 90.01);
    expect(rig.timers.pending()).toHaveLength(0);
    expect(rig.said.length).toBeGreaterThan(before);
  });
});
