/**
 * `processText` (task 13.2, Requirements 15.12, 15.13, 17.2, 33.51, 33.53). The one path from text to
 * a resolved action. Recognised speech, System_Keyboard text, and a tapped Commands_Tile row all call
 * it, so the input routes cannot behave differently. Pure.
 *
 * Free-form chat and custom place names cannot be spoken (the restricted grammar has no way to
 * transcribe them), so they arrive typed. Typed text that matches no phrase comes back as
 * `unsupported` with reason `unrecognised` and the text, which the caller may send to Tier 2.
 */
import { parseIntent, type Intent, type ParseContext } from './intent-parser.js';
import { resolve, type ResolvedAction, type ResolveContext } from './resolver.js';

export interface ProcessContext extends ResolveContext {
  /** Remembered place names, for "look at" and "point at". */
  readonly places?: readonly string[];
}

export interface ProcessedText {
  readonly intent: Intent;
  readonly action: ResolvedAction;
}

/** Parse then resolve `text`. Deterministic for equal text and context. */
export function processText(text: string, ctx: ProcessContext): ProcessedText {
  const parseCtx: ParseContext =
    ctx.places === undefined ? { registry: ctx.registry } : { registry: ctx.registry, places: ctx.places };
  const intent = parseIntent(text, parseCtx);
  return { intent, action: resolve(intent, ctx) };
}
