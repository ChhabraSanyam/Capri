import { describe, expect, it } from 'vitest';
import manifestText from '../../voice/voice-manifest.txt?raw';
import { CapriApp } from '../../src/app/app.js';
import { createManualClock } from '../../src/app/clock.js';
import { createEventBus, type AppEvents } from '../../src/app/events.js';
import { createFrameContext } from '../../src/app/frame-context.js';
import { GreetingWiring } from '../../src/app/greeting.js';
import { createLogger } from '../../src/app/logger.js';
import { PersonalityWiring } from '../../src/app/personality.js';
import { createSeededRng } from '../../src/app/rng.js';
import { AudioEngine, type SpeechOutcome } from '../../src/audio/audio-engine.js';
import type { GestureId } from '../../src/domain/animation-types.js';
import {
  createGreetingInputs,
  GreetingGate,
  type GreetingDecision,
  type GreetingInputs,
} from '../../src/domain/greeting-gate.js';
import { Persona, type PersonaRequest } from '../../src/domain/persona/persona.js';
import { sentenceCount } from '../../src/domain/persona/truncate.js';
import type { Utterance } from '../../src/domain/persona/utterance.js';
import { parseVoiceManifest, type VoiceManifest } from '../../src/domain/speech/voice-manifest.js';
import { PauseController } from '../../src/ui/pause.js';

const DT = 0.1;
const quiet = createLogger('test');

function manifest(): VoiceManifest {
  const parsed = parseVoiceManifest(manifestText);
  if (!parsed.ok) throw new Error('voice manifest did not parse');
  return parsed.manifest;
}

/** Everything that lets the greeting through: in session, spawned, panels down, a hand, the index. */
function readyInputs(): GreetingInputs {
  const inputs = createGreetingInputs();
  inputs.inSession = true;
  inputs.avatarSpawned = true;
  inputs.handsTracked = true;
  inputs.libraryReady = true;
  return inputs;
}

function run(gate: GreetingGate, inputs: GreetingInputs, frames: number): GreetingDecision[] {
  const out: GreetingDecision[] = [];
  for (let i = 0; i < frames; i += 1) out.push(gate.update(DT, inputs));
  return out;
}

interface Rig {
  readonly wiring: GreetingWiring;
  readonly delivered: Utterance[];
  readonly state: { audioRunning: boolean; gesture: GestureId; speaking: boolean; activity: number };
}

function rig(seed = 3): Rig {
  const delivered: Utterance[] = [];
  const state = { audioRunning: true, gesture: 'wave' as GestureId, speaking: false, activity: 0 };
  const persona = new Persona({ rng: createSeededRng(seed), clock: createManualClock(0), manifest: manifest() });
  const wiring = new GreetingWiring({
    persona,
    deliver: (line) => {
      delivered.push(line);
      state.speaking = true;
    },
    isAudioRunning: () => state.audioRunning,
    getActiveGesture: () => state.gesture,
    isSpeaking: () => state.speaking,
    noteActivity: () => {
      state.activity += 1;
    },
    logger: quiet,
  });
  return { wiring, delivered, state };
}

describe('GreetingGate', () => {
  it('speaks once on the first free frame after she spawned, then never again in the session', () => {
    const gate = new GreetingGate();
    const inputs = readyInputs();
    inputs.avatarSpawned = false;
    expect(run(gate, inputs, 5)).toEqual(['none', 'none', 'none', 'none', 'none']);
    inputs.avatarSpawned = true;
    const decisions = run(gate, inputs, 200);
    expect(decisions.filter((d) => d === 'speak')).toHaveLength(1);
    expect(decisions[0]).toBe('speak');
    expect(gate.greeted).toBe(true);
  });

  it('waits while the loading card is on screen, the hand-lost panel is up, no hand is tracked, or the index is pending', () => {
    const gate = new GreetingGate({ maxDeferS: 60 });
    const inputs = readyInputs();
    inputs.loadingOnScreen = true;
    expect(run(gate, inputs, 3)).not.toContain('speak');
    inputs.loadingOnScreen = false;
    inputs.handLostShown = true;
    inputs.handsTracked = false;
    expect(run(gate, inputs, 3)).not.toContain('speak');
    inputs.handLostShown = false;
    expect(run(gate, inputs, 3)).not.toContain('speak');
    inputs.handsTracked = true;
    inputs.libraryReady = false;
    expect(run(gate, inputs, 3)).not.toContain('speak');
    expect(gate.greeted).toBe(false);
    inputs.libraryReady = true;
    expect(gate.update(DT, inputs)).toBe('speak');
  });

  it('goes without a greeting after maxDeferS of held running frames', () => {
    const gate = new GreetingGate({ maxDeferS: 1 });
    const inputs = readyInputs();
    inputs.handLostShown = true;
    const decisions = run(gate, inputs, 15);
    expect(decisions.filter((d) => d === 'skip')).toHaveLength(1);
    inputs.handLostShown = false;
    expect(run(gate, inputs, 5)).not.toContain('speak');
    expect(gate.greeted).toBe(false);
  });

  it('is re-armed only when the XR session ends', () => {
    const gate = new GreetingGate();
    const inputs = readyInputs();
    expect(gate.update(DT, inputs)).toBe('speak');
    inputs.avatarSpawned = false;
    run(gate, inputs, 3);
    inputs.avatarSpawned = true;
    expect(run(gate, inputs, 3)).not.toContain('speak');
    inputs.inSession = false;
    inputs.avatarSpawned = false;
    run(gate, inputs, 1);
    expect(gate.greeted).toBe(false);
    inputs.inSession = true;
    inputs.avatarSpawned = true;
    expect(gate.update(DT, inputs)).toBe('speak');
  });
});

describe('GreetingWiring', () => {
  it('plays one Voice_Library greeting line over the arrival wave when audio runs', () => {
    const r = rig();
    const inputs = readyInputs();
    for (let i = 0; i < 50; i += 1) r.wiring.update(DT, inputs);
    expect(r.delivered).toHaveLength(1);
    const line = r.delivered[0]!;
    expect(line.libraryId).toMatch(/^greeting_\d\d$/u);
    expect(line.libraryCategory).toBe('greeting');
    expect(line.claims).toBe('neutral');
    expect(sentenceCount(line.text)).toBeLessThanOrEqual(2);
    // The first wave is still playing: the line plays no gesture, so the wave carries on under it.
    expect(line.gesture).toBe('none');
  });

  it('brings its own wave when the arrival wave already ended', () => {
    const r = rig();
    r.state.gesture = 'none';
    r.wiring.update(DT, readyInputs());
    expect(r.delivered[0]?.gesture).toBe('wave');
  });

  it('falls back to tier 3 (bubble and chirp, no mouth) when the playback context is not running', async () => {
    const r = rig();
    r.state.audioRunning = false;
    r.wiring.update(DT, readyInputs());
    const line = r.delivered[0]!;
    expect(line.libraryId).toBeUndefined();
    expect(line.text.length).toBeGreaterThan(0);

    // A real engine that was never unlocked: its context is not running.
    const engine = new AudioEngine({ rng: createSeededRng(1), logger: quiet });
    const bubbles: string[] = [];
    engine.setPresenter({ showBubble: (text) => void bubbles.push(text), hideBubble: () => undefined, playGesture: () => undefined });
    expect(engine.audioRunning).toBe(false);
    let outcome: SpeechOutcome | undefined;
    void engine.say(line).then((o) => {
      outcome = o;
    });
    expect(bubbles).toEqual([line.text]);
    expect(engine.libraryPlaying).toBe(false);
    for (let i = 0; i < 200 && outcome === undefined; i += 1) {
      engine.update(DT);
      expect(engine.amplitude).toBe(0);
      await Promise.resolve();
    }
    expect(outcome).toEqual({ tier: 'bubble', status: 'completed' });
    engine.dispose();
  });

  it('holds the line while the loading card or the hand-lost panel is up', () => {
    const r = rig();
    const inputs = readyInputs();
    inputs.loadingOnScreen = true;
    for (let i = 0; i < 5; i += 1) r.wiring.update(DT, inputs);
    inputs.loadingOnScreen = false;
    inputs.handLostShown = true;
    inputs.handsTracked = false;
    for (let i = 0; i < 5; i += 1) r.wiring.update(DT, inputs);
    expect(r.delivered).toHaveLength(0);
    inputs.handLostShown = false;
    inputs.handsTracked = true;
    r.wiring.update(DT, inputs);
    expect(r.delivered).toHaveLength(1);
  });

  it('notes activity once, when the line has finished', () => {
    const r = rig();
    const inputs = readyInputs();
    r.wiring.update(DT, inputs);
    for (let i = 0; i < 10; i += 1) r.wiring.update(DT, inputs);
    expect(r.state.activity).toBe(0);
    r.state.speaking = false;
    r.wiring.update(DT, inputs);
    r.wiring.update(DT, inputs);
    expect(r.state.activity).toBe(1);
  });

  it('picks a different greeting variant in the next session', () => {
    const r = rig(5);
    const inputs = readyInputs();
    const ids: (string | undefined)[] = [];
    for (let session = 0; session < 6; session += 1) {
      inputs.inSession = true;
      r.wiring.update(DT, inputs);
      r.state.speaking = false;
      inputs.inSession = false;
      r.wiring.update(DT, inputs);
    }
    for (const line of r.delivered) ids.push(line.libraryId);
    expect(ids).toHaveLength(6);
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]).not.toBe(ids[i - 1]);
  });

  it('does not greet again after a pause and resume', async () => {
    const clock = createManualClock(0);
    const app = new CapriApp({ clock, logger: quiet, isInSession: () => true });
    const r = rig();
    const inputs = readyInputs();
    app.setStage('vfxUi', (frame) => r.wiring.update(frame.dt, inputs));
    const noop = (): void => undefined;
    const pause = new PauseController({
      clock,
      logger: quiet,
      targets: {
        app,
        speech: { hold: noop, release: noop },
        mic: { stop: noop },
        voice: { pause: noop, resume: noop },
        tasks: { pause: noop, resume: noop },
        personality: { shiftSchedule: noop },
        home: { resume: noop },
        hands: { arm: noop },
      },
    });
    const tick = (frames: number): void => {
      for (let i = 0; i < frames; i += 1) {
        clock.advance(DT * 1000);
        app.tick(DT, clock.now() / 1000);
      }
    };
    tick(5);
    expect(r.delivered).toHaveLength(1);
    for (let round = 0; round < 3; round += 1) {
      pause.setSessionVisibility('visible-blurred');
      tick(20);
      pause.setSessionVisibility('visible');
      await pause.settled;
      tick(20);
    }
    expect(app.paused).toBe(false);
    expect(r.wiring.greeted).toBe(true);
    expect(r.delivered).toHaveLength(1);
  });
});

describe('greeting and the ignored reaction', () => {
  it('counts the 60 s silence from the end of the greeting', async () => {
    const clock = createManualClock(1_000);
    const said: PersonaRequest[] = [];
    const speech = { speaking: false };
    const personality = new PersonalityWiring({
      clock,
      rng: createSeededRng(2),
      logger: quiet,
      events: createEventBus<AppEvents>(quiet),
      persona: { say: (request) => (said.push(request), []) },
      getAnimator: () => ({ activeGesture: 'none', play: () => Promise.resolve() }),
      isPresent: () => true,
      getMode: () => 'idle',
      isSpeaking: () => speech.speaking,
      isHackActive: () => false,
      isTaskRunning: () => false,
      getSurfaces: () => [],
      getMarkers: () => [],
    });
    const greeting = new GreetingWiring({
      persona: new Persona({ rng: createSeededRng(4), clock, manifest: manifest() }),
      deliver: () => {
        speech.speaking = true;
      },
      isAudioRunning: () => true,
      getActiveGesture: () => 'wave',
      isSpeaking: () => speech.speaking,
      noteActivity: () => personality.noteInput(),
      logger: quiet,
    });
    const frame = createFrameContext();
    frame.inSession = true;
    const inputs = readyInputs();
    const ignoredAt: number[] = [];
    const start = clock.now();
    const greetingMs = 3_000;
    while (clock.now() - start < 70_000) {
      clock.advance(DT * 1000);
      if (clock.now() - start >= greetingMs) speech.speaking = false;
      const before = said.length;
      personality.update(frame);
      greeting.update(DT, inputs);
      await Promise.resolve();
      if (said.length > before && said[said.length - 1]?.kind === 'idle_ignored') ignoredAt.push(clock.now() - start);
    }
    expect(ignoredAt).toHaveLength(1);
    // Not at 60 s after she appeared: 60 s after the greeting ended.
    expect(ignoredAt[0]).toBeGreaterThanOrEqual(60_000 + greetingMs);
    personality.dispose();
  });
});
