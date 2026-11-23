import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildCommandCatalog, COMMAND_GROUPS, type CommandRow } from '../../src/domain/commands/command-catalog.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import type { Intent } from '../../src/domain/speech-lang/intent-parser.js';
import { commandTypesOf, PHRASE_TABLE, type CommandType } from '../../src/domain/speech-lang/phrases.js';
import { processText } from '../../src/domain/speech-lang/process-text.js';

// Feature: capri-spatial-companion, Property 50: Commands catalog matches the grammar
// **Validates: Requirements 33.19, 33.49, 33.50, 33.51**

const RUNS = { numRuns: 100 };

/** The command type an intent belongs to, or `undefined` for repeat and unknown. */
function typeOfIntent(intent: Intent): CommandType | undefined {
  switch (intent.type) {
    case 'device':
      return `device:${intent.verb}`;
    case 'avatar':
      return `avatar:${intent.ability}`;
    case 'confirm_pointed':
      return 'confirm_pointed';
    case 'chat':
      return 'chat';
    case 'task':
      return intent.kind === 'custom' ? undefined : `task:${intent.kind}`;
    case 'hermes_prompt':
      return `hermes_prompt:${intent.mode}`;
    default:
      return undefined;
  }
}

const NAME_WORDS = ['desk', 'floor', 'lamp', 'strip', 'shelf', 'bedside', 'reading', 'corner', 'ceiling', 'light'];

/** Registries of 0 to 6 lights with names from common words, some shared. */
const arbRegistry = fc
  .array(fc.array(fc.constantFrom(...NAME_WORDS), { minLength: 1, maxLength: 3 }).map((w) => w.join(' ')), {
    maxLength: 6,
  })
  .map((names) => {
    let n = 0;
    const registry = new DeviceRegistry({ idFactory: () => `id-${(n += 1)}` });
    names.forEach((name, i) => registry.add({ entityId: `light.${i}`, name, position: { x: i, y: 1, z: -1 } }));
    return registry;
  });

describe('Property 50: Commands catalog matches the grammar', () => {
  it('covers every command type, groups each row once, and runs tappable rows like the spoken phrase', () => {
    fc.assert(
      fc.property(arbRegistry, fc.option(fc.nat({ max: 7 }), { nil: undefined }), (registry, pointedIndex) => {
        const records = registry.all();
        const pointed = pointedIndex === undefined ? undefined : records[pointedIndex % Math.max(1, records.length)]?.id;
        const ctx = { registry, ...(pointed === undefined ? {} : { pointed }) };
        const catalog = buildCommandCatalog(PHRASE_TABLE, records);

        // At least one row for every command type in the phrase table (Requirement 33.50).
        const covered = new Set(catalog.map((r) => r.type));
        for (const type of commandTypesOf(PHRASE_TABLE)) expect(covered.has(type), type).toBe(true);

        // Each row belongs to exactly one group, ids are unique, and every row says a phrase.
        expect(new Set(catalog.map((r) => r.id)).size).toBe(catalog.length);
        for (const row of catalog) {
          expect(COMMAND_GROUPS.filter((g) => g === row.group)).toHaveLength(1);
          expect(row.say.trim().length).toBeGreaterThan(0);
        }

        for (const row of catalog) checkRow(row, ctx);
      }),
      RUNS,
    );
  });
});

function checkRow(row: CommandRow, ctx: Parameters<typeof processText>[1]): void {
  // No task row runs on a tap, so no one-tap entry starts the evening routine (Requirement 33.19).
  if (row.type.startsWith('task:')) expect(row.runText, row.id).toBeUndefined();
  if (row.runText === undefined) {
    // A say-only row names a placeholder, a task, or the pointing confirmation.
    expect(/<[^>]+>/u.test(row.say) || row.type.startsWith('task:') || row.type === 'confirm_pointed', row.id).toBe(true);
    return;
  }
  // A tappable row has no placeholder, and its text resolves to the same action as the spoken
  // phrase, with an intent of the row's command type (Requirement 33.51).
  expect(row.runText).not.toMatch(/[<>]/u);
  const tapped = processText(row.runText, ctx);
  expect(tapped).toEqual(processText(row.say, ctx));
  expect(typeOfIntent(tapped.intent), row.id).toBe(row.type);
}
