/**
 * SpikeRunner: owns the item list, the row statuses, and the pinch-operated Next button.
 *
 * Flow per item: Start -> running / needs-user -> works or fails -> Next.
 * While an item runs, the button reads Stop and marks the item as failed ("stopped by the user").
 * After the last item the button reads Finish and asks the host to leave the AR session.
 *
 * Failures are shown in the scene together with the pre-written workaround (Requirement 1.5, 1.6).
 * The developer then relays both to the user and waits for confirmation (Requirement 1.7). The
 * harness itself never retries a failed item (Requirement 1.8).
 */
import type { World } from '@iwsdk/core';
import { CAPABILITY_LABELS } from './report.js';
import { SpikePanelView } from './spike-panel.js';
import {
  CAPABILITY_KEYS,
  ProbeNotBuiltError,
  type AbortReason,
  type CapabilityKey,
  type RowStatus,
  type SpikeContext,
  type SpikeItem,
  type SpikeItemId,
  type SpikeResult,
} from './types.js';
import { workaroundFor } from './workarounds.js';

type Phase = 'waiting-session' | 'ready' | 'running' | 'done' | 'finished';

export interface SpikeRunnerHost {
  world: World;
  /** Called when the AR session ends after having been active. Receives every result so far. */
  onSessionEnded(results: readonly SpikeResult[]): void;
  /** Called after each recorded result so it can be saved. */
  onResultsChanged(results: readonly SpikeResult[]): void;
}

export class SpikeRunner {
  private view: SpikePanelView | undefined;
  private phase: Phase = 'waiting-session';
  private sessionWasActive = false;
  private currentIndex = 0;
  private runToken = 0;
  private abort: AbortController | undefined;
  private frameUnsubscribers: Array<() => void> = [];
  private liveText = '';
  private failureText = '';
  private workaroundText = '';
  private needsUser = false;
  private holdOnSessionEnd = false;
  private readonly results = new Map<SpikeItemId, SpikeResult>();
  private readonly statuses = new Map<SpikeItemId, RowStatus>();
  private removeNextListener: (() => void) | undefined;

  constructor(
    private readonly items: readonly SpikeItem[],
    private readonly host: SpikeRunnerHost,
    restored: readonly SpikeResult[] = [],
  ) {
    for (const item of items) this.statuses.set(item.id, 'pending');
    for (const result of restored) this.applyResult(result);
    const firstOpen = items.findIndex((item) => !this.results.has(item.id));
    this.currentIndex = firstOpen === -1 ? items.length : firstOpen;
  }

  /** Connect the loaded panel. Call once the PanelDocument exists. */
  attachView(view: SpikePanelView): void {
    view.verify();
    this.view = view;
    this.removeNextListener?.();
    this.removeNextListener = view.onNext(() => this.handleNext());
    this.render();
  }

  dispose(): void {
    this.removeNextListener?.();
    this.removeNextListener = undefined;
    this.endItem();
  }

  allResults(): SpikeResult[] {
    const list: SpikeResult[] = [];
    for (const item of this.items) {
      const result = this.results.get(item.id);
      if (result !== undefined) list.push(result);
    }
    return list;
  }

  /** Called when the XR session starts (`true`) or ends (`false`). */
  setSessionActive(active: boolean): void {
    if (active) {
      this.sessionWasActive = true;
      if (this.phase === 'waiting-session') {
        this.phase = this.currentIndex >= this.items.length ? 'done' : 'ready';
      }
      this.render();
      return;
    }

    if (!this.sessionWasActive) return;
    this.sessionWasActive = false;
    if (this.phase === 'running') {
      if (this.holdOnSessionEnd) {
        this.holdItemOpen();
      } else {
        this.recordFailure('The AR session ended before the item finished.');
      }
    }
    this.phase = 'waiting-session';
    this.render();
    this.host.onSessionEnded(this.allResults());
  }

  /** Pinch on the Next button. */
  handleNext(): void {
    switch (this.phase) {
      case 'ready':
        void this.startCurrent();
        break;
      case 'running':
        this.recordFailure('Stopped by the user before the probe finished.');
        break;
      case 'done':
        this.advance();
        break;
      default:
        break;
    }
  }

  private currentItem(): SpikeItem | undefined {
    return this.items[this.currentIndex];
  }

  private advance(): void {
    this.liveText = '';
    this.failureText = '';
    this.workaroundText = '';
    if (this.currentIndex >= this.items.length - 1) {
      this.currentIndex = this.items.length;
      this.phase = 'finished';
      this.render();
      this.host.world.exitXR();
      return;
    }
    this.currentIndex += 1;
    const next = this.currentItem();
    this.phase = next !== undefined && this.results.has(next.id) ? 'done' : 'ready';
    this.render();
  }

  private buildContext(item: SpikeItem, signal: AbortSignal): SpikeContext {
    return {
      world: this.host.world,
      signal,
      onFrame: (callback) => {
        const stop = this.host.world.onXRFrame(callback);
        this.frameUnsubscribers.push(stop);
        return stop;
      },
      setDetail: (text) => {
        if (this.currentItem() !== item) return;
        this.liveText = text;
        this.view?.setLive(text);
      },
      setNeedsUser: (needsUser) => {
        if (this.currentItem() !== item) return;
        this.needsUser = needsUser;
        this.statuses.set(item.id, needsUser ? 'needs-user' : 'running');
        this.render();
      },
      setHoldOnSessionEnd: (hold) => {
        if (this.currentItem() !== item) return;
        this.holdOnSessionEnd = hold;
      },
    };
  }

  private async startCurrent(): Promise<void> {
    const item = this.currentItem();
    if (item === undefined) return;

    this.runToken += 1;
    const token = this.runToken;
    const abort = new AbortController();
    this.abort = abort;
    this.phase = 'running';
    this.needsUser = false;
    this.holdOnSessionEnd = false;
    this.liveText = '';
    this.failureText = '';
    this.workaroundText = '';
    this.statuses.set(item.id, 'running');
    this.render();

    try {
      const result = await item.run(this.buildContext(item, abort.signal));
      if (token !== this.runToken) return;
      this.recordResult({ ...result, item: item.id });
    } catch (error) {
      if (token !== this.runToken) return;
      if (error instanceof ProbeNotBuiltError) {
        this.endItem();
        this.statuses.set(item.id, 'pending');
        this.phase = 'ready';
        this.liveText = error.message;
        this.render();
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      this.recordResult({ item: item.id, verdict: 'does_not_work', failureReason: reason });
    }
  }

  /** The user or the session ended the running item. Ignore whatever the probe returns later. */
  private recordFailure(reason: string): void {
    const item = this.currentItem();
    if (item === undefined) return;
    this.runToken += 1;
    this.recordResult({ item: item.id, verdict: 'does_not_work', failureReason: reason }, 'stopped');
  }

  /**
   * The AR session ended while the probe asked to stay open (item (b) reload check). Close the
   * probe, record nothing, and leave the item as the current one so Start runs it again.
   */
  private holdItemOpen(): void {
    const item = this.currentItem();
    this.runToken += 1;
    this.endItem('session-ended');
    if (item !== undefined) this.statuses.set(item.id, 'pending');
    this.liveText =
      'The AR session ended and this item is waiting. Reload the page if asked, enter AR, and press Start again to continue.';
    this.failureText = '';
    this.workaroundText = '';
  }

  private recordResult(result: SpikeResult, reason: AbortReason = 'finished'): void {
    this.endItem(reason);
    this.applyResult(result);
    this.failureText = '';
    this.workaroundText = '';
    if (result.verdict === 'does_not_work' || this.failedCapabilities(result).length > 0) {
      this.failureText = `Fails: ${result.failureReason ?? 'no reason recorded'}`;
      this.workaroundText = `Cheapest workaround: ${this.describeWorkaround(result)}`;
    }
    this.phase = 'done';
    this.host.onResultsChanged(this.allResults());
    this.render();
  }

  private applyResult(result: SpikeResult): void {
    this.results.set(result.item, result);
    this.statuses.set(result.item, result.verdict === 'works' ? 'works' : 'fails');
  }

  private failedCapabilities(result: SpikeResult): CapabilityKey[] {
    if (result.item !== 'b') return [];
    return CAPABILITY_KEYS.filter((key) => result.capabilities?.[key] === 'does_not_work');
  }

  private describeWorkaround(result: SpikeResult): string {
    const failed = this.failedCapabilities(result);
    if (failed.length === 0) return workaroundFor(result.item).text;
    return failed
      .map((key) => `${CAPABILITY_LABELS[key]}: ${workaroundFor(result.item, key).text}`)
      .join(' ');
  }

  /** Abort the running probe and stop its frame callbacks. */
  private endItem(reason: AbortReason = 'stopped'): void {
    this.abort?.abort(reason);
    this.abort = undefined;
    this.holdOnSessionEnd = false;
    for (const stop of this.frameUnsubscribers) stop();
    this.frameUnsubscribers = [];
    this.needsUser = false;
  }

  private buttonLabel(): string {
    switch (this.phase) {
      case 'ready':
        return 'Start';
      case 'running':
        return 'Stop';
      case 'done':
        return this.currentIndex >= this.items.length - 1 ? 'Finish' : 'Next';
      case 'finished':
        return 'Finished';
      default:
        return 'Enter AR first';
    }
  }

  private sessionLine(): string {
    switch (this.phase) {
      case 'waiting-session':
        return 'Press Enter AR on the page first.';
      case 'running':
        return this.needsUser ? 'Your turn: follow the steps below.' : 'Running. Wait for the result.';
      case 'ready':
        return 'Pinch Start to run the highlighted item.';
      case 'done':
        return 'Item finished. Pinch Next to continue.';
      default:
        return 'All items done. The report is on the page.';
    }
  }

  private render(): void {
    const view = this.view;
    if (view === undefined) return;

    const current = this.currentItem();
    for (const item of this.items) {
      view.setRow(
        item.id,
        item.title,
        this.statuses.get(item.id) ?? 'pending',
        current?.id === item.id,
      );
    }
    view.setSessionLine(this.sessionLine());
    view.setNow(
      current === undefined ? 'All items done' : `Now: (${current.id}) ${current.title}`,
      current?.instructions ?? [],
    );
    view.setLive(this.liveText);
    view.setFailure(this.failureText);
    view.setWorkaround(this.workaroundText);
    view.setButtonLabel(this.buttonLabel());
  }
}
