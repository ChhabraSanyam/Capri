/**
 * Pause and resume (task 27.2, Requirement 28.2): when the experience pauses, how the app's frame
 * stages, the speech queue, the idle schedule, and the hands behave across it, and how the controller
 * follows the XR session's and the page's visibility.
 */
import { describe, expect, it } from 'vitest';
import { CapriApp } from '../../src/app/app.js';
import { createManualClock } from '../../src/app/clock.js';
import { createEventBus, type AppEvents } from '../../src/app/events.js';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createLogger } from '../../src/app/logger.js';
import { createSeededRng } from '../../src/app/rng.js';
import { ResumeHandGuard } from '../../src/app/resume-hand-guard.js';
import { SpeechQueue } from '../../src/audio/speech-queue.js';
import { CORE_JOINT, JOINT_FLOATS, PAUSE } from '../../src/config/constants.js';
import { createIdleInputs, IdleScheduler } from '../../src/domain/idle-scheduler.js';
import { pauseReason, toSessionVisibility } from '../../src/domain/pause-state.js';
import type { Utterance } from '../../src/domain/persona/utterance.js';
import { PauseController, attachPauseSources, type PauseTargets } from '../../src/ui/pause.js';

const quiet = createLogger('test', () => undefined);

describe('pauseReason', () => {
  it('pauses on a blurred or hidden session and on a manual pause, and runs while visible', () => {
    const base = { documentHidden: false, manual: false };
    expect(pauseReason({ ...base, sessionVisibility: 'visible' })).toBeUndefined();
    expect(pauseReason({ ...base, sessionVisibility: 'visible-blurred' })).toBe('session-blurred');
    expect(pauseReason({ ...base, sessionVisibility: 'hidden' })).toBe('session-hidden');
    expect(pauseReason({ ...base, sessionVisibility: 'visible', manual: true })).toBe('manual');
    expect(pauseReason({ ...base, sessionVisibility: 'non-immersive', manual: true })).toBe('manual');
  });

  it('uses the page visibility only outside a session', () => {
    expect(pauseReason({ sessionVisibility: 'non-immersive', documentHidden: true, manual: false })).toBe('page-hidden');
    // Some browsers report the 2D page hidden for the whole immersive session.
    expect(pauseReason({ sessionVisibility: 'visible', documentHidden: true, manual: false })).toBeUndefined();
  });

  it('maps session states, with no session as non-immersive', () => {
    expect(toSessionVisibility(undefined)).toBe('non-immersive');
    expect(toSessionVisibility('visible-blurred')).toBe('visible-blurred');
    expect(toSessionVisibility('hidden')).toBe('hidden');
    expect(toSessionVisibility('something-new')).toBe('visible');
  });
});

describe('CapriApp.setPaused', () => {
  it('runs only the perf stage while paused, and clamps the first dt after the resume', () => {
    const app = new CapriApp({ logger: quiet, isInSession: () => true });
    const seen: string[] = [];
    const dts: number[] = [];
    app.setStage('animator', (frame) => {
      seen.push('animator');
      dts.push(frame.dt);
    });
    app.setStage('orchestrator', () => seen.push('orchestrator'));
    app.setStage('perf', () => seen.push('perf'));

    app.setPaused(true);
    expect(app.paused).toBe(true);
    app.tick(0.016, 1);
    expect(seen).toEqual(['perf']);

    app.setPaused(false);
    seen.length = 0;
    // A hidden session delivered no frames, so the first dt covers the whole pause.
    app.tick(42, 43);
    app.tick(0.016, 43.016);
    expect(seen).toEqual(['orchestrator', 'animator', 'perf', 'orchestrator', 'animator', 'perf']);
    expect(dts).toEqual([PAUSE.resumeMaxDtS, 0.016]);
  });
});

describe('SpeechQueue hold and release', () => {
  it('starts no new line while held, then plays the held lines in order', async () => {
    const spoken: string[] = [];
    const finish: (() => void)[] = [];
    const queue = new SpeechQueue({
      say: (u) => {
        spoken.push(u.text);
        return new Promise((resolve) => finish.push(() => resolve({ tier: 'bubble', status: 'completed' })));
      },
      cancel: () => undefined,
    });
    const line = (text: string): Utterance => ({ text, claims: 'neutral' });
    queue.enqueue(line('in progress'));
    queue.hold();
    queue.enqueue(line('timer done'));
    queue.enqueue(line('task done'));
    // The line in progress ends (the audio engine froze it; here it simply finishes).
    finish.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(spoken).toEqual(['in progress']);
    expect(queue.pending).toBe(2);

    queue.release();
    queue.release();
    expect(spoken).toEqual(['in progress', 'timer done']);
    finish.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(spoken).toEqual(['in progress', 'timer done', 'task done']);
  });
});

describe('IdleScheduler.shift', () => {
  it('moves the schedule later by the paused time, so nothing fires the moment she is visible', () => {
    const clock = createManualClock(0);
    const scheduler = new IdleScheduler(createSeededRng(1), clock);
    const inputs = createIdleInputs();
    inputs.mode = 'idle';
    clock.set(5_000);
    expect(scheduler.update(inputs).kind).toBe('none');
    const due = scheduler.nextBehaviourAtMs;
    // Paused for 5 minutes: without the shift, both the ignored reaction (60 s) and a behaviour are due.
    clock.advance(300_000);
    scheduler.shift(300_000);
    expect(scheduler.nextBehaviourAtMs).toBe(due + 300_000);
    expect(scheduler.update(inputs).kind).toBe('none');
    expect(scheduler.ignoredReacted).toBe(false);
  });

  it('ignores a zero, negative or non-finite shift', () => {
    const clock = createManualClock(0);
    const scheduler = new IdleScheduler(createSeededRng(1), clock);
    const due = scheduler.nextBehaviourAtMs;
    scheduler.shift(0);
    scheduler.shift(-5);
    scheduler.shift(Number.NaN);
    expect(scheduler.nextBehaviourAtMs).toBe(due);
  });
});

describe('ResumeHandGuard', () => {
  function setPinch(joints: Float32Array, distanceM: number): void {
    const t = CORE_JOINT.thumbTip * JOINT_FLOATS;
    const i = CORE_JOINT.indexTip * JOINT_FLOATS;
    joints[t] = 0;
    joints[i] = distanceM;
  }

  it('reads a hand that is still pinching as untracked until it opens', () => {
    const guard = new ResumeHandGuard();
    const frame = createFrameContext();
    frame.inSession = true;
    frame.dt = 1 / 72;
    frame.hands.left.tracked = true;
    frame.hands.right.tracked = true;
    setPinch(frame.hands.left.joints, 0.005);
    setPinch(frame.hands.right.joints, 0.08);
    guard.arm();

    guard.apply(frame);
    expect(frame.hands.left.tracked).toBe(false);
    expect(frame.hands.right.tracked).toBe(true);
    expect(guard.active).toBe(true);

    // The hand source refills `tracked` every frame.
    frame.hands.left.tracked = true;
    setPinch(frame.hands.left.joints, 0.06);
    guard.apply(frame);
    expect(frame.hands.left.tracked).toBe(true);
    expect(guard.active).toBe(false);
  });

  it('gives up after handGuardMaxS even if the fingers stay closed', () => {
    const guard = new ResumeHandGuard();
    const frame = createFrameContext();
    frame.inSession = true;
    frame.dt = 0.5;
    frame.hands.left.tracked = true;
    setPinch(frame.hands.left.joints, 0.005);
    guard.arm();
    for (let t = 0; t < PAUSE.handGuardMaxS; t += frame.dt) {
      frame.hands.left.tracked = true;
      guard.apply(frame);
    }
    frame.hands.left.tracked = true;
    guard.apply(frame);
    expect(guard.active).toBe(false);
    expect(frame.hands.left.tracked).toBe(true);
  });
});

function controllerRig(options: { audioResume?: () => Promise<boolean> } = {}) {
  const clock = createManualClock(1_000);
  const calls: string[] = [];
  const events = createEventBus<AppEvents>(quiet);
  const paused: boolean[] = [];
  events.on('session:paused', ({ paused: p }) => paused.push(p));
  const shifts: number[] = [];
  const targets: PauseTargets = {
    app: { setPaused: (p) => void calls.push(`app:${p}`) },
    audio: {
      pause: () => void calls.push('audio:pause'),
      resume: () => {
        calls.push('audio:resume');
        return options.audioResume?.() ?? Promise.resolve(true);
      },
    },
    speech: { hold: () => void calls.push('speech:hold'), release: () => void calls.push('speech:release') },
    mic: { stop: () => void calls.push('mic:stop') },
    voice: { pause: () => void calls.push('voice:pause'), resume: () => void calls.push('voice:resume') },
    tasks: { pause: () => void calls.push('tasks:pause'), resume: () => void calls.push('tasks:resume') },
    personality: { shiftSchedule: (ms) => void shifts.push(ms) },
    home: { resume: () => void calls.push('home:resume') },
    hands: { arm: () => void calls.push('hands:arm') },
  };
  const controller = new PauseController({ clock, targets, events, logger: quiet });
  return { clock, calls, paused, shifts, controller };
}

describe('PauseController', () => {
  it('pauses once for blurred then hidden, and resumes once when visible again', async () => {
    const r = controllerRig();
    r.controller.setSessionVisibility('visible');
    expect(r.calls).toEqual([]);

    r.controller.setSessionVisibility('visible-blurred');
    expect(r.controller.reason).toBe('session-blurred');
    expect(r.calls).toEqual(['app:true', 'voice:pause', 'mic:stop', 'speech:hold', 'audio:pause', 'tasks:pause']);

    r.calls.length = 0;
    r.controller.setSessionVisibility('hidden');
    expect(r.controller.reason).toBe('session-hidden');
    expect(r.calls).toEqual([]);

    r.clock.advance(12_000);
    r.controller.setSessionVisibility('visible');
    expect(r.controller.paused).toBe(false);
    expect(r.shifts).toEqual([12_000]);
    expect(r.controller.lastPausedMs).toBe(12_000);
    expect(r.calls).toEqual(['hands:arm', 'voice:resume', 'home:resume', 'app:false', 'audio:resume']);
    await r.controller.settled;
    // Held lines play only once the playback context runs again.
    expect(r.calls.slice(-2)).toEqual(['speech:release', 'tasks:resume']);
    expect(r.paused).toEqual([true, false]);
  });

  it('does not release held lines into a pause that came back before the audio resumed', async () => {
    let finishAudio: (running: boolean) => void = () => undefined;
    const r = controllerRig({ audioResume: () => new Promise((resolve) => (finishAudio = resolve)) });
    r.controller.setSessionVisibility('visible');
    r.controller.setSessionVisibility('visible-blurred');
    r.controller.setSessionVisibility('visible');
    r.controller.setSessionVisibility('visible-blurred');
    finishAudio(true);
    await r.controller.settled;
    expect(r.calls).not.toContain('speech:release');
    expect(r.controller.paused).toBe(true);
  });

  it('releases the held lines even when the audio does not come back', async () => {
    const r = controllerRig({ audioResume: () => Promise.resolve(false) });
    r.controller.setManual(true);
    r.controller.setManual(false);
    await r.controller.settled;
    expect(r.calls).toContain('speech:release');
  });
});

describe('attachPauseSources', () => {
  class FakeSession extends EventTarget {
    visibilityState = 'visible';
    set(state: string): void {
      this.visibilityState = state;
      this.dispatchEvent(new Event('visibilitychange'));
    }
  }
  class FakeDocument extends EventTarget {
    visibilityState = 'visible';
    set(state: string): void {
      this.visibilityState = state;
      this.dispatchEvent(new Event('visibilitychange'));
    }
  }
  function signal(initial: string) {
    let value = initial;
    const listeners = new Set<(v: string) => void>();
    return {
      set(next: string) {
        value = next;
        for (const l of listeners) l(value);
      },
      subscribe(cb: (v: string) => void) {
        listeners.add(cb);
        cb(value);
        return () => void listeners.delete(cb);
      },
    };
  }

  it('follows the session event, ignores the page while in a session, and resumes when the session ends', () => {
    const r = controllerRig();
    const session = new FakeSession();
    const world = { session: undefined as FakeSession | undefined, visibilityState: signal('non-immersive') };
    const doc = new FakeDocument();
    const detach = attachPauseSources(r.controller, world, doc);

    doc.set('hidden');
    expect(r.controller.reason).toBe('page-hidden');
    doc.set('visible');
    expect(r.controller.paused).toBe(false);

    world.session = session;
    world.visibilityState.set('visible');
    session.set('visible-blurred');
    expect(r.controller.reason).toBe('session-blurred');
    doc.set('hidden');
    session.set('visible');
    expect(r.controller.paused).toBe(false);

    session.set('hidden');
    expect(r.controller.paused).toBe(true);
    session.dispatchEvent(new Event('end'));
    // Back on the 2D page, which is hidden here.
    expect(r.controller.reason).toBe('page-hidden');
    doc.set('visible');
    expect(r.controller.paused).toBe(false);

    detach();
    doc.set('hidden');
    expect(r.controller.paused).toBe(false);
  });
});
