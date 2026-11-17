import { createStore } from '../observable.js';
import {
  err,
  ok,
  type AgentBackend,
  type AgentChatRequest,
  type AgentTaskRequest,
  type ConnectionState,
  type ResponseContract,
  type Result,
  type TaskEvent,
  type TaskHandle,
} from '../types.js';
import type { TaskKind } from '../../domain/speech-lang/phrases.js';

/**
 * Scripted Hermes stand-in for Mock Mode (Requirements 19.3, 23.5, 23.8, 23.10). It needs no
 * configuration and makes no network call. It knows nothing about Hermes: no endpoint, header, or
 * field name exists here. The live adapter arrives after Gate H (task 21).
 */

/** One scripted step: fire `event` once `atMs` have passed since the task started. */
export interface ScriptStep {
  readonly atMs: number;
  readonly event: TaskEvent;
}

export interface TaskScript {
  readonly steps: readonly ScriptStep[];
}

/** Progress offsets for the demo task, in ms after start. */
export const EVENING_ROUTINE_SCRIPT: TaskScript = {
  steps: [
    { atMs: 0, event: { type: 'progress', fraction: 0, label: 'Getting started' } },
    { atMs: 2500, event: { type: 'progress', fraction: 0.25, label: 'Checking the lights' } },
    { atMs: 6000, event: { type: 'progress', fraction: 0.6, label: 'Winding down the room' } },
    { atMs: 10000, event: { type: 'progress', fraction: 1, label: 'All set' } },
    { atMs: 10000, event: { type: 'completed', summary: 'Your evening routine is done.' } },
  ],
};

/** The scripted failure: stops partway with a plain reason. */
export const WATCH_FAILURE_SCRIPT: TaskScript = {
  steps: [
    { atMs: 0, event: { type: 'progress', fraction: 0, label: 'Looking for the door' } },
    { atMs: 2500, event: { type: 'progress', fraction: 0.25, label: 'Connecting to the camera' } },
    { atMs: 5000, event: { type: 'failed', reason: "I can't see the door from here." } },
  ],
};

const RESEARCH_SCRIPT: TaskScript = {
  steps: [
    { atMs: 0, event: { type: 'progress', fraction: 0, label: 'Starting the search' } },
    { atMs: 3000, event: { type: 'progress', fraction: 0.25, label: 'Reading around' } },
    { atMs: 7000, event: { type: 'progress', fraction: 0.6, label: 'Putting it together' } },
    { atMs: 10000, event: { type: 'progress', fraction: 1, label: 'Done' } },
    { atMs: 10000, event: { type: 'completed', summary: 'The research is done.' } },
  ],
};

/**
 * Script for each task kind. `routine` and `research` complete. `watch` ("watch the door") is the
 * scripted failure, so the failure path can be shown on demand (Requirement 19.10).
 */
export const MOCK_TASK_SCRIPTS: Readonly<Record<TaskKind, TaskScript>> = {
  routine: EVENING_ROUTINE_SCRIPT,
  watch: WATCH_FAILURE_SCRIPT,
  research: RESEARCH_SCRIPT,
};

/** The canned Tier 2 reply. Two sentences at most, like a validated contract. */
export const MOCK_CHAT_REPLY: ResponseContract = {
  speech: "Mock Mode here, so my smart friend is a script today. I'll keep it light.",
  emotion: 'smug',
  animation: 'tease',
};

export interface MockAgentOptions {
  /** Multiplies every scripted offset. Defaults to 1. Pass 0 in tests to run without waiting. */
  timeScale?: number;
  /** Replaces the scripts. Defaults to `MOCK_TASK_SCRIPTS`. */
  scripts?: Readonly<Record<TaskKind, TaskScript>>;
}

export interface MockAgent extends AgentBackend {
  readonly kind: 'mock';
}

/**
 * A single-reader async queue. The producer pushes from timers, so events keep their scheduled
 * times even when the consumer reads late.
 */
interface EventQueue {
  push(event: TaskEvent): void;
  close(): void;
  readonly iterable: AsyncIterable<TaskEvent>;
}

function createEventQueue(): EventQueue {
  const buffer: TaskEvent[] = [];
  let closed = false;
  let waiter: (() => void) | undefined;

  const wake = (): void => {
    const w = waiter;
    waiter = undefined;
    w?.();
  };

  return {
    push(event) {
      if (closed) return;
      buffer.push(event);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = buffer.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (closed) return;
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
        }
      },
    },
  };
}

export function createMockAgent(options: MockAgentOptions = {}): MockAgent {
  const timeScale = options.timeScale ?? 1;
  const scripts = options.scripts ?? MOCK_TASK_SCRIPTS;
  const connection = createStore<ConnectionState>('connected');
  let taskCounter = 0;

  return {
    kind: 'mock',
    connection,

    async testConnection() {
      return ok({ detail: 'Mock Mode: scripted agent, no network' });
    },

    async chat(_req: AgentChatRequest, signal?: AbortSignal): Promise<Result<ResponseContract>> {
      if (signal?.aborted) {
        return err({ kind: 'timeout', message: 'The request was cancelled before it finished.' });
      }
      return ok({ ...MOCK_CHAT_REPLY });
    },

    async startTask(req: AgentTaskRequest): Promise<Result<TaskHandle>> {
      const script = scripts[req.kind];
      if (script === undefined) {
        return err({ kind: 'invalid_response', message: 'I do not know how to run that task.' });
      }
      taskCounter += 1;
      const queue = createEventQueue();
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let finished = false;

      const finish = (): void => {
        finished = true;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        queue.close();
      };

      for (const step of script.steps) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (finished) return;
          queue.push(step.event);
          if (step.event.type !== 'progress') finish();
        }, Math.max(0, step.atMs * timeScale));
        timers.add(timer);
      }

      return ok({
        id: `mock-task-${taskCounter}`,
        events: queue.iterable,
        cancel() {
          if (finished) return;
          queue.push({ type: 'failed', reason: 'The task was cancelled.' });
          finish();
        },
      });
    },
  };
}
