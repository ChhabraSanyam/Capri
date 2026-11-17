import { describe, expect, it } from 'vitest';
import {
  TASK_LABEL_MAX_CHARS,
  TASK_NO_REASON,
  TaskModel,
  initialTask,
  progressPercent,
  reduceTask,
  taskOutcome,
} from '../../src/domain/contract/task-model.js';

describe('TaskModel', () => {
  it('starts running at 0 progress', () => {
    expect(new TaskModel('Evening routine').snapshot).toEqual({ state: 'running', progress: 0, label: 'Evening routine' });
  });

  it('follows progress events and keeps the last label when one has none', () => {
    const m = new TaskModel();
    m.apply({ type: 'progress', fraction: 0.25, label: 'Dimming lights' });
    m.apply({ type: 'progress', fraction: 0.6 });
    expect(m.snapshot).toEqual({ state: 'running', progress: 0.6, label: 'Dimming lights' });
    expect(progressPercent(m.snapshot)).toBe(60);
  });

  it('never lowers progress and clamps out-of-range or invalid fractions', () => {
    let s = initialTask();
    s = reduceTask(s, { type: 'progress', fraction: 0.5 });
    s = reduceTask(s, { type: 'progress', fraction: 0.2 });
    expect(s.progress).toBe(0.5);
    s = reduceTask(s, { type: 'progress', fraction: Number.NaN });
    expect(s.progress).toBe(0.5);
    s = reduceTask(s, { type: 'progress', fraction: 7 });
    expect(s.progress).toBe(1);
    expect(reduceTask(initialTask(), { type: 'progress', fraction: -3 }).progress).toBe(0);
  });

  it('returns the same object when an event changes nothing', () => {
    const s = initialTask('x');
    expect(reduceTask(s, { type: 'progress' })).toBe(s);
  });

  it('completes at progress 1 with the summary and exposes the Persona outcome', () => {
    const m = new TaskModel('Routine');
    m.apply({ type: 'progress', fraction: 0.6 });
    m.apply({ type: 'completed', summary: 'All three lights are set.' });
    expect(m.snapshot).toEqual({ state: 'completed', progress: 1, label: 'Routine', summary: 'All three lights are set.' });
    expect(m.finished).toBe(true);
    expect(m.outcome()).toEqual({ kind: 'completed', summary: 'All three lights are set.' });
  });

  it('fails keeping the progress reached and carries the reason', () => {
    const m = new TaskModel('Routine');
    m.apply({ type: 'progress', fraction: 0.25 });
    m.apply({ type: 'failed', reason: 'Lamp did not answer' });
    expect(m.snapshot).toMatchObject({ state: 'failed', progress: 0.25, reason: 'Lamp did not answer' });
    expect(m.outcome()).toEqual({ kind: 'failed', reason: 'Lamp did not answer' });
  });

  it('uses a default reason when the failure has none', () => {
    const s = reduceTask(initialTask(), { type: 'failed', reason: '  \n ' });
    expect(s.reason).toBe(TASK_NO_REASON);
  });

  it('ignores every event after a terminal state', () => {
    const done = reduceTask(initialTask(), { type: 'completed', summary: 'ok' });
    expect(reduceTask(done, { type: 'failed', reason: 'late' })).toBe(done);
    expect(reduceTask(done, { type: 'progress', fraction: 0.1, label: 'late' })).toBe(done);
    const failed = reduceTask(initialTask(), { type: 'failed', reason: 'bad' });
    expect(reduceTask(failed, { type: 'completed', summary: 'late' })).toBe(failed);
  });

  it('has no outcome while running', () => {
    expect(taskOutcome(initialTask())).toBeUndefined();
  });

  it('makes labels single-line and length-capped', () => {
    const s = reduceTask(initialTask(), { type: 'progress', label: `a\nb\t${'x'.repeat(500)}` });
    expect(s.label).not.toMatch(/[\n\t]/);
    expect(s.label.length).toBeLessThanOrEqual(TASK_LABEL_MAX_CHARS);
  });
});
