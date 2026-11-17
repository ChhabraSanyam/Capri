/**
 * Variant picker (task 13.14, Requirement 16.12). Picks uniformly from a category's variants,
 * excluding the variant picked last time in that category, with the injected `Rng`. A category with
 * one variant always returns it.
 */
import type { Rng } from '../../app/rng.js';

export interface Variant {
  readonly id: string;
}

/**
 * Pure pick: a uniform variant that is not `previousId`. With one variant, or when `previousId`
 * matches none of them, every variant is a candidate. Returns undefined for an empty list.
 */
export function pickVariant<T extends Variant>(
  variants: readonly T[],
  previousId: string | undefined,
  rng: Rng,
): T | undefined {
  if (variants.length === 0) return undefined;
  if (variants.length === 1) return variants[0];
  const candidates = previousId === undefined ? variants : variants.filter((v) => v.id !== previousId);
  const pool = candidates.length > 0 ? candidates : variants;
  // Clamp so a misbehaving Rng that returns 1 or more still lands on a valid index.
  const index = Math.min(Math.max(Math.floor(rng.next() * pool.length), 0), pool.length - 1);
  return pool[index];
}

/** Remembers the last pick per category, so no category repeats a variant back to back. */
export class VariantPicker {
  private readonly lastIdByCategory = new Map<string, string>();

  constructor(private readonly rng: Rng) {}

  pick<T extends Variant>(category: string, variants: readonly T[]): T | undefined {
    const picked = pickVariant(variants, this.lastIdByCategory.get(category), this.rng);
    if (picked !== undefined) this.lastIdByCategory.set(category, picked.id);
    return picked;
  }

  /** Forget every previous pick. */
  reset(): void {
    this.lastIdByCategory.clear();
  }
}
