/**
 * Action memory (task 13.7, Requirements 17.9, 17.10, 21.4). A ring buffer of the user's last 20
 * actions, and `toggleRepeat`, which finds a light that was toggled again and again.
 */
import { BANTER } from '../../config/constants.js';
import type { DeviceCommand } from '../../backends/types.js';

export type ActionKind = 'toggle' | 'brightness' | 'color' | 'ability' | 'timer' | 'task' | 'other';

export interface ActionRecord {
  readonly kind: ActionKind;
  readonly deviceId?: string;
  /** Clock time in ms. */
  readonly t: number;
}

/** What kind of action a light command is. On and off are toggles. */
export function actionKindOf(command: DeviceCommand): ActionKind {
  switch (command.kind) {
    case 'on':
    case 'off':
      return 'toggle';
    case 'brightness':
      return 'brightness';
    case 'color':
      return 'color';
  }
}

export class ActionMemory {
  private readonly slots: ActionRecord[] = [];
  private next = 0;

  constructor(private readonly capacity: number = BANTER.memoryCapacity) {}

  /** Add an action. Once full, the oldest one is dropped. */
  record(action: ActionRecord): void {
    if (this.slots.length < this.capacity) {
      this.slots.push(action);
    } else {
      this.slots[this.next] = action;
      this.next = (this.next + 1) % this.capacity;
    }
  }

  get size(): number {
    return this.slots.length;
  }

  /** The remembered actions, oldest first. */
  entries(): ActionRecord[] {
    if (this.slots.length < this.capacity) return this.slots.slice();
    return [...this.slots.slice(this.next), ...this.slots.slice(0, this.next)];
  }

  clear(): void {
    this.slots.length = 0;
    this.next = 0;
  }
}

/**
 * The device id toggled `BANTER.toggleTeaseCount` (3) or more times in the 60 s up to `now`
 * (a toggle at exactly `now - 60 s` still counts), or undefined. Looks only at the remembered
 * actions. With several candidates it returns the one whose qualifying toggles are the most recent.
 */
export function toggleRepeat(memory: ActionMemory, now: number): string | undefined {
  const counts = new Map<string, number>();
  const entries = memory.entries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind !== 'toggle' || e.deviceId === undefined) continue;
    if (e.t > now || now - e.t > BANTER.toggleWindowMs) continue;
    const n = (counts.get(e.deviceId) ?? 0) + 1;
    if (n >= BANTER.toggleTeaseCount) return e.deviceId;
    counts.set(e.deviceId, n);
  }
  return undefined;
}

/** How many toggles of `deviceId` fall in the 60 s up to `now`. */
export function toggleCount(memory: ActionMemory, deviceId: string, now: number): number {
  let n = 0;
  for (const e of memory.entries()) {
    if (e.kind === 'toggle' && e.deviceId === deviceId && e.t <= now && now - e.t <= BANTER.toggleWindowMs) n++;
  }
  return n;
}
