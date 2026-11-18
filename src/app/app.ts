/**
 * `CapriApp` owns the per-frame stage order and the shared services (clock, rng, events, logger,
 * frame context). It holds no domain logic and no IWSDK or three types, so the stage order can be
 * tested in Node.
 *
 * Later steps register their stage with `setStage`. A stage with no handler is skipped.
 * Every stage runs inside its own `StageGuard` (error isolation, design: Error Handling).
 */
import { systemClock, type Clock } from './clock.js';
import { createEventBus, type AppEvents, type EventBus } from './events.js';
import { createFrameContext, type FrameContext } from './frame-context.js';
import { createLogger, type Logger } from './logger.js';
import { createSeededRng, type Rng } from './rng.js';
import { StageGuard } from './safe-run.js';
import { DEFAULT_RNG_SEED, PAUSE } from '../config/constants.js';

/** The fixed tick order from the design (Frame loop and IWSDK integration). */
export const STAGE_ORDER = [
  /** 1. `xr.readFrame(frameCtx)`: head pose, hand joints, pinch states. */
  'readFrame',
  /** 2. `pointing.update`: Pointed_Device and selected. */
  'pointing',
  /** 3. `voice.update`: push-to-talk edge detection. */
  'voice',
  /** 4. `orchestrator.update`: hack sequence, timers, Tier 2 task events. */
  'orchestrator',
  /** 5. `idle.update`: idle behaviour scheduling and follow rules. */
  'idle',
  /** 6. `animator.update`: bones and expressions, then `vrm.update(dt)`. */
  'animator',
  /** 7. `vfx.update` and `ui.update`. */
  'vfxUi',
  /** 8. `perfOverlay.sample(dt)` (dev only). */
  'perf',
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

/** Stages that keep running while paused (task 27.2): only the dev frame-time overlay. */
const RUNS_WHILE_PAUSED: readonly boolean[] = STAGE_ORDER.map((name) => name === 'perf');
export type StageHandler = (frame: FrameContext) => void;

export interface CapriAppDeps {
  readonly clock?: Clock;
  readonly rng?: Rng;
  readonly logger?: Logger;
  readonly events?: EventBus<AppEvents>;
  /** Reports whether an XR session is presenting. Defaults to always false. */
  readonly isInSession?: () => boolean;
}

export class CapriApp {
  readonly clock: Clock;
  readonly rng: Rng;
  readonly logger: Logger;
  readonly events: EventBus<AppEvents>;
  readonly frame: FrameContext = createFrameContext();

  private readonly isInSession: () => boolean;
  private readonly handlers: (StageHandler | undefined)[] = STAGE_ORDER.map(() => undefined);
  private readonly guards: StageGuard[];
  private pausedNow = false;
  /** The next frame is the first after a resume. */
  private clampNextDt = false;

  constructor(deps: CapriAppDeps = {}) {
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? createSeededRng(DEFAULT_RNG_SEED);
    this.logger = deps.logger ?? createLogger('app');
    this.events = deps.events ?? createEventBus<AppEvents>(this.logger);
    this.isInSession = deps.isInSession ?? (() => false);
    this.guards = STAGE_ORDER.map((name) => new StageGuard(name, this.clock, this.logger));
  }

  /** Register (or clear, with `undefined`) the handler for one stage. Returns an unregister function. */
  setStage(name: StageName, handler: StageHandler | undefined): () => void {
    const index = STAGE_ORDER.indexOf(name);
    this.handlers[index] = handler;
    return () => {
      if (this.handlers[index] === handler) this.handlers[index] = undefined;
    };
  }

  /** True while the named stage is switched off after repeated errors. */
  isStageDisabled(name: StageName): boolean {
    return this.guards[STAGE_ORDER.indexOf(name)]?.disabled ?? false;
  }

  /** True while the experience is paused (`ui/pause.ts`). */
  get paused(): boolean {
    return this.pausedNow;
  }

  /**
   * Pause or resume the frame stages (task 27.2). While paused only the `perf` stage runs, so the
   * animator clock, the idle stage, the orchestrator (hack runner, timers, task panel, Home Assistant
   * refresh), the VFX and every dt countdown stand still. The first frame after a resume is clamped
   * to `PAUSE.resumeMaxDtS`.
   */
  setPaused(paused: boolean): void {
    if (paused === this.pausedNow) return;
    this.pausedNow = paused;
    if (!paused) this.clampNextDt = true;
  }

  /** Run every stage once, in `STAGE_ORDER`. Called once per frame by `CapriSystem`. */
  tick(dt: number, time: number): void {
    const frame = this.frame;
    const paused = this.pausedNow;
    let stepS = dt;
    if (!paused && this.clampNextDt) {
      this.clampNextDt = false;
      stepS = Math.min(dt, PAUSE.resumeMaxDtS);
    }
    frame.dt = stepS;
    frame.time = time;
    frame.inSession = this.isInSession();
    for (let i = 0; i < STAGE_ORDER.length; i += 1) {
      if (paused && !RUNS_WHILE_PAUSED[i]) continue;
      const handler = this.handlers[i];
      if (handler === undefined) continue;
      this.guards[i]?.run(handler, frame);
    }
  }
}
