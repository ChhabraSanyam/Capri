/**
 * Banter engine (task 13.7, Requirements 17.8, 17.9, 17.10, 21.4, 22.2, 22.3). Picks a context-aware
 * line with variation and keeps the memory of the user's recent actions.
 *
 * For a context kind it prefers a Voice_Library line (tier 1 audio, the manifest text is shown as
 * the bubble), and falls back to a dynamic template. The pick uses the shared `VariantPicker`, so a
 * kind never repeats the variant it used last time. Every line goes through `limitSentences(…, 2)`.
 *
 * The caller says which claims are acceptable (`allow`), so a pending call never gets a `done` line.
 */
import type { Rng } from '../../app/rng.js';
import { BANTER } from '../../config/constants.js';
import { VariantPicker } from '../speech/variant-picker.js';
import type { VoiceCategory, VoiceClaims, VoiceManifest } from '../speech/voice-manifest.js';
import { ActionMemory, toggleCount, toggleRepeat, type ActionRecord } from './action-memory.js';
import { BANTER_CONTEXTS, renderTemplate, type BanterKind, type Slots } from './templates.js';
import { limitSentences } from './truncate.js';
import type { Utterance } from './utterance.js';

export interface BanterOptions {
  readonly rng: Rng;
  /** The Voice_Manifest. Without it every line is dynamic text. */
  readonly manifest?: VoiceManifest;
}

interface Candidate {
  readonly id: string;
  readonly text: string;
  readonly claims: VoiceClaims;
  readonly library?: { readonly id: string; readonly category: VoiceCategory };
}

export class BanterEngine {
  readonly memory: ActionMemory;
  private readonly picker: VariantPicker;
  private manifest: VoiceManifest | undefined;
  private readonly lastTeaseAt = new Map<string, number>();

  constructor(options: BanterOptions) {
    this.picker = new VariantPicker(options.rng);
    this.manifest = options.manifest;
    this.memory = new ActionMemory(BANTER.memoryCapacity);
  }

  setManifest(manifest: VoiceManifest | undefined): void {
    this.manifest = manifest;
  }

  /**
   * A line for `kind`, or undefined when no line with an allowed claim exists (for example a
   * success lead line when the manifest has no `quip`, `celebrate`, or `task-complete` lines).
   */
  line(kind: BanterKind, slots: Slots = {}, allow: (claims: VoiceClaims) => boolean = () => true): Utterance | undefined {
    const context = BANTER_CONTEXTS[kind];
    const library = this.libraryCandidates(kind).filter((c) => allow(c.claims));
    const pool: readonly Candidate[] = library.length > 0 ? library : context.templates.filter((t) => allow(t.claims));
    const picked = this.picker.pick(kind, pool);
    if (picked === undefined) return undefined;
    const text = limitSentences(picked.library === undefined ? renderTemplate(picked.text, slots) : picked.text);
    return {
      text,
      claims: picked.claims,
      ...(picked.library === undefined ? {} : { libraryId: picked.library.id, libraryCategory: picked.library.category }),
      ...(context.gesture === undefined ? {} : { gesture: context.gesture }),
      ...(context.emotion === undefined ? {} : { emotion: context.emotion }),
    };
  }

  /** Remember a user action. */
  noteAction(action: ActionRecord): void {
    this.memory.record(action);
  }

  /**
   * A tease line naming a light the user toggled 3 or more times in the last 60 s (Requirement
   * 17.10), or undefined. A light is teased at most once per 60 s, so a fourth toggle right after
   * the tease stays quiet. `nameOf` gives the spoken name for a device id.
   */
  toggleTease(now: number, nameOf: (deviceId: string) => string | undefined): Utterance | undefined {
    const deviceId = toggleRepeat(this.memory, now);
    if (deviceId === undefined) return undefined;
    const last = this.lastTeaseAt.get(deviceId);
    if (last !== undefined && now >= last && now - last <= BANTER.toggleWindowMs) return undefined;
    const name = nameOf(deviceId);
    const line = this.line('toggle_repeat', {
      ...(name === undefined ? {} : { device: name }),
      count: String(toggleCount(this.memory, deviceId, now)),
    });
    if (line !== undefined) this.lastTeaseAt.set(deviceId, now);
    return line;
  }

  private libraryCandidates(kind: BanterKind): Candidate[] {
    const manifest = this.manifest;
    const pools = BANTER_CONTEXTS[kind].library;
    if (manifest === undefined || pools === undefined) return [];
    const out: Candidate[] = [];
    for (const pool of pools) {
      for (const line of manifest.categories[pool.category]) {
        if (pool.ids !== undefined && !pool.ids.includes(line.id)) continue;
        out.push({ id: line.id, text: line.text, claims: line.claims, library: { id: line.id, category: pool.category } });
      }
    }
    return out;
  }
}
