import { describe, expect, it } from 'vitest';
import manifestText from '../../voice/voice-manifest.txt?raw';
import {
  VOICE_CATEGORIES,
  allVoiceLines,
  countSentences,
  emptyManifest,
  formatVoiceManifest,
  parseVoiceManifest,
  validateClaims,
  validateManifest,
  type VoiceManifest,
} from '../../src/domain/speech/voice-manifest.js';

function parseOrThrow(text: string): VoiceManifest {
  const result = parseVoiceManifest(text);
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.line}: ${e.message}`).join('\n'));
  return result.manifest;
}

describe('voice/voice-manifest.txt', () => {
  const manifest = parseOrThrow(manifestText);

  it('parses and passes structural validation (8 categories, 5 to 10 lines, 2 sentences at most)', () => {
    expect(validateManifest(manifest)).toEqual([]);
    for (const category of VOICE_CATEGORIES) {
      expect(manifest.categories[category].length).toBeGreaterThanOrEqual(5);
      expect(manifest.categories[category].length).toBeLessThanOrEqual(10);
    }
  });

  it('carries a truthful claims tag on every line', () => {
    expect(validateClaims(manifest)).toEqual([]);
  });

  it('round-trips through the formatter', () => {
    expect(parseOrThrow(formatVoiceManifest(manifest))).toEqual(manifest);
  });

  it('uses unique ids that name mp3 files safely', () => {
    const ids = allVoiceLines(manifest).map((e) => e.line.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('countSentences', () => {
  it('counts sentence ends and ignores dots inside numbers', () => {
    expect(countSentences('')).toBe(0);
    expect(countSentences('Nope, that bounced.')).toBe(1);
    expect(countSentences('On it. Jacking in!')).toBe(2);
    expect(countSentences('Wait... what? Really. Fine.')).toBe(4);
    expect(countSentences('It is 3.5 metres away')).toBe(1);
  });
});

describe('parseVoiceManifest', () => {
  it('keeps "|" inside the text and ignores comments and blank lines', () => {
    const m = parseOrThrow('# c\n\n[quip]\nquip_01 | done | a | b\n');
    expect(m.categories.quip).toEqual([{ id: 'quip_01', claims: 'done', text: 'a | b' }]);
  });

  it('reports unknown categories, unknown claims, malformed lines, and orphan lines', () => {
    const result = parseVoiceManifest('x_01 | ack | hi\n[nope]\n[quip]\nq | maybe | hi\nq2 only\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.line)).toEqual([1, 2, 4, 5]);
  });
});

describe('validateManifest', () => {
  it('flags an empty manifest in every category', () => {
    const codes = validateManifest(emptyManifest()).map((i) => i.code);
    expect(codes).toEqual(VOICE_CATEGORIES.map(() => 'variant_count'));
  });

  it('flags a line with three sentences and a duplicate id', () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `a_${i}`, claims: 'neutral' as const, text: 'Hi.' }));
    const m: VoiceManifest = {
      categories: {
        ...emptyManifest().categories,
        greeting: [...lines(5), { id: 'a_0', claims: 'neutral', text: 'One. Two. Three.' }],
      },
    };
    const codes = validateManifest(m)
      .filter((i) => i.category === 'greeting')
      .map((i) => i.code);
    expect(codes).toEqual(['duplicate_id', 'sentence_limit']);
  });
});

describe('validateClaims', () => {
  it('flags a mismatched claim and completion wording on a pending line', () => {
    const m: VoiceManifest = {
      categories: {
        ...emptyManifest().categories,
        confirm: [
          { id: 'confirm_01', claims: 'done', text: 'On it.' },
          { id: 'confirm_02', claims: 'ack', text: 'All done.' },
        ],
      },
    };
    expect(validateClaims(m).map((i) => i.code)).toEqual(['claims_mismatch', 'completion_wording']);
  });
});
