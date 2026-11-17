/**
 * Developer handle for the Hacking VFX (task 15.5). Dev builds only: `capri-system.ts` installs it as
 * `window.__capriVfx` behind `import.meta.env.DEV`, so the production bundle drops this file.
 *
 * It exists so the effect can be checked in the IWSDK emulator and on the headset without the voice
 * loop (task 15.8 wires the real sequence). `run` plays a real `HackSequence` at a registered device
 * marker, or at a point in front of the viewer, with the real animator (gaze and flick) and the real
 * `HackingVfx`. The backend is a stub that answers after a delay, so no device changes, and the
 * Persona is silent. `stage` plays one VFX stage directly. `stress` calls `pulse` every frame, which
 * floods the pool far past its capacity, to show that the active count stays under the cap.
 *
 * Console: `__capriVfx.run()`, `__capriVfx.run({ ok: false })`, `__capriVfx.stats()`.
 */
import { err, ok, type LightState, type Result } from '../backends/types.js';
import { HackSequence, type AnimatorPort, type HackTimings, type LightAction } from '../domain/actions/hack-sequence.js';
import type { Vec3 } from '../domain/geometry.js';
import type { HackingVfx, HackingVfxStats } from '../vfx/hacking-vfx.js';
import type { CapriApp } from './app.js';
import { createLogger } from './logger.js';

const logger = createLogger('vfx-dev');
/** Slow-motion factor for the `m` shortcut, so a screenshot can land inside each phase. */
const SLOW_MOTION = 6;
/** While the effect is playing, stats are logged this often, in seconds. */
const LOG_PERIOD_S = 0.25;

export interface VfxDevDevice {
  readonly id: string;
  readonly entityId: string;
  readonly name: string;
  readonly position: Vec3;
}

export interface VfxDevDeps {
  readonly vfx: HackingVfx;
  readonly app: CapriApp;
  readonly getAnimator: () => AnimatorPort | undefined;
  readonly getDevices: () => readonly VfxDevDevice[];
}

export interface VfxRunOptions {
  /** A registered device id. Default: the first registered device, else a point in front of the viewer. */
  readonly deviceId?: string;
  /** A world position. Wins over `deviceId`. */
  readonly target?: Vec3;
  /** Whether the stub backend succeeds. Default true. */
  readonly ok?: boolean;
  /** How long the stub backend takes to answer, in milliseconds. Default 600. */
  readonly backendDelayMs?: number;
  readonly timings?: Partial<HackTimings>;
}

export type VfxStageName = 'flick' | 'beam' | 'pulse' | 'hold' | 'end';

const NO_ANIMATOR: AnimatorPort = {
  setLookTarget: () => undefined,
  play: () => undefined,
};

const STUB_STATE: LightState = { entityId: 'light.dev_vfx', on: true, brightnessPct: 100, rgb: [255, 255, 255] };

const SLOW_TIMINGS: Partial<HackTimings> = {
  aimS: 0.25 * SLOW_MOTION,
  flickS: 0.35 * SLOW_MOTION,
  beamS: 0.45 * SLOW_MOTION,
  pulseS: 0.35 * SLOW_MOTION,
  resultHoldS: 1,
};

export class VfxDevHandle {
  private sequence: HackSequence | undefined;
  private stressTarget: Vec3 | undefined;
  private logClockS = 0;
  /** Phases the last sequence went through, for the console. */
  readonly log: string[] = [];

  constructor(private readonly deps: VfxDevDeps) {}

  get vfx(): HackingVfx {
    return this.deps.vfx;
  }

  /** Where `run` aims when no target is given. */
  defaultTarget(deviceId?: string): Vec3 {
    const devices = this.deps.getDevices();
    const device = (deviceId === undefined ? undefined : devices.find((d) => d.id === deviceId)) ?? devices[0];
    if (device !== undefined) return { ...device.position };
    // 1.5 m along the view direction from the head, a little below eye level.
    const { position, orientation } = this.deps.app.frame.head;
    const [qx, qy, qz, qw] = [orientation[0]!, orientation[1]!, orientation[2]!, orientation[3]!];
    // Rotate (0, 0, -1) by the head quaternion.
    const fx = -2 * (qx * qz + qw * qy);
    const fy = -2 * (qy * qz - qw * qx);
    const fz = -(1 - 2 * (qx * qx + qy * qy));
    return { x: position[0]! + fx * 1.5, y: position[1]! + fy * 1.5 - 0.2, z: position[2]! + fz * 1.5 };
  }

  /** Play the whole hacking sequence once, with a stub backend. Returns the sequence. */
  run(options: VfxRunOptions = {}): HackSequence {
    const target = options.target ?? this.defaultTarget(options.deviceId);
    const succeed = options.ok ?? true;
    const delay = options.backendDelayMs ?? 600;
    const device = this.deps.getDevices().find((d) => d.id === options.deviceId) ?? this.deps.getDevices()[0];
    const action: LightAction = {
      device: { id: device?.id ?? 'dev-vfx', entityId: device?.entityId ?? 'light.dev_vfx', name: device?.name ?? 'dev light' },
      command: { kind: 'off' },
    };
    this.log.length = 0;
    this.stressTarget = undefined;
    const sequence = new HackSequence(
      {
        animator: this.deps.getAnimator() ?? NO_ANIMATOR,
        vfx: this.deps.vfx,
        backend: {
          applyCommand: (): Promise<Result<LightState>> =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve(succeed ? ok(STUB_STATE) : err({ kind: 'server', message: 'Dev VFX rehearsal failure.' })),
                delay,
              );
            }),
        },
        persona: { say: () => undefined },
        onEvent: (event) => this.log.push(event.type === 'phase' ? event.phase : event.type),
      },
      action,
      target,
      options.timings,
    );
    this.sequence = sequence;
    return sequence;
  }

  /** Play one VFX stage directly. Durations are the real phase lengths. */
  stage(name: VfxStageName, target: Vec3 = this.defaultTarget()): void {
    const vfx = this.deps.vfx;
    switch (name) {
      case 'flick':
        vfx.flick(target, 0.35);
        break;
      case 'beam':
        vfx.beam(target, 0.45);
        break;
      case 'pulse':
        vfx.pulse(target, 0.35);
        break;
      case 'hold':
        vfx.hold(target);
        break;
      case 'end':
        vfx.end('success');
        break;
    }
  }

  /** Call `pulse` every frame (22 sparks each) until `stopStress`. The pool must stay under its cap. */
  stress(target: Vec3 = this.defaultTarget()): void {
    this.sequence = undefined;
    this.stressTarget = target;
  }

  stopStress(): void {
    this.stressTarget = undefined;
  }

  stats(): HackingVfxStats {
    return this.deps.vfx.stats();
  }

  /**
   * Keyboard shortcuts, all on Alt+Shift so typing is never hijacked: V runs the sequence, X runs it
   * with a failing backend, M runs it in slow motion (6x), S toggles the stress flood. Returns a
   * function that removes them.
   */
  installKeys(): () => void {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      switch (event.code) {
        case 'KeyV':
          this.run();
          break;
        case 'KeyX':
          this.run({ ok: false });
          break;
        case 'KeyM':
          this.run({ timings: SLOW_TIMINGS });
          break;
        case 'KeyS':
          if (this.stressTarget === undefined) this.stress();
          else this.stopStress();
          break;
        default:
          return;
      }
      logger.info(`vfx demo key ${event.code}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }

  /** Once per frame, before `vfx.update`. */
  update(dt: number): void {
    // Log the numbers a headset test needs: element counts, draw calls, governor state.
    if (this.deps.vfx.isActive) {
      this.logClockS += dt;
      if (this.logClockS >= LOG_PERIOD_S) {
        this.logClockS = 0;
        const s = this.deps.vfx.stats();
        const pos = this.deps.vfx.debugPositions();
        const head = this.deps.app.frame.head.position;
        const f = (v: ArrayLike<number>): string => Array.from(v, (n) => n.toFixed(2)).join(',');
        logger.info(`vfx pos emitter=${f(pos.emitter)} target=${f(pos.target)} head=${f(head)}`);
        logger.info(
          `vfx ${s.stage} active=${s.active}/${s.cap} peak=${s.peak} sparks=${s.sparks} glyphs=${s.glyphs} lines=${s.lines} beams=${s.beams} pulse=${s.pulse} draws=${s.drawCalls} reduced=${s.quality.reduced} avg=${s.quality.averageMs.toFixed(1)}ms`,
        );
      }
    }
    const sequence = this.sequence;
    if (sequence !== undefined) {
      sequence.update(dt);
      if (sequence.done) this.sequence = undefined;
    }
    if (this.stressTarget !== undefined) this.deps.vfx.pulse(this.stressTarget, 0.35);
  }
}
