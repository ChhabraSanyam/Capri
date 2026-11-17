import { describe, expect, it } from 'vitest';
import { lexiconWordsFromSymbols, readFstSymbolTable } from '../../tools/fst-symbols.js';

class Writer {
  readonly parts: number[] = [];
  int32(v: number): this {
    const b = new DataView(new ArrayBuffer(4));
    b.setInt32(0, v, true);
    this.parts.push(...new Uint8Array(b.buffer));
    return this;
  }
  int64(v: number): this {
    const b = new DataView(new ArrayBuffer(8));
    b.setBigInt64(0, BigInt(v), true);
    this.parts.push(...new Uint8Array(b.buffer));
    return this;
  }
  string(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.int32(bytes.length);
    this.parts.push(...bytes);
    return this;
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

function buildFst(flags: number, symbols: string[]): Uint8Array {
  const w = new Writer();
  w.int32(0x7eb2fdd6).string('ngram').string('standard').int32(4).int32(flags);
  w.int64(0).int64(0).int64(0).int64(0);
  if (flags & 3) {
    w.int32(0x7eb2fb74).string('words.txt').int64(symbols.length).int64(symbols.length);
    symbols.forEach((s, i) => w.string(s).int64(i));
  }
  return w.bytes();
}

describe('readFstSymbolTable', () => {
  it('reads the embedded symbol table', () => {
    const table = readFstSymbolTable(buildFst(3, ['<eps>', 'lamp', 'light']));
    expect(table.name).toBe('words.txt');
    expect(table.entries.map((e) => e.symbol)).toEqual(['<eps>', 'lamp', 'light']);
    expect(table.entries[2]!.key).toBe(2);
  });

  it('rejects bad magic, missing tables, and truncated data', () => {
    expect(() => readFstSymbolTable(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/magic/);
    expect(() => readFstSymbolTable(buildFst(0, []))).toThrow(/no embedded symbol table/);
    expect(() => readFstSymbolTable(buildFst(3, ['lamp']).subarray(0, 70))).toThrow(/end of FST/);
  });
});

describe('lexiconWordsFromSymbols', () => {
  it('keeps plain spoken words, sorted and deduplicated', () => {
    const words = lexiconWordsFromSymbols([
      '<eps>', '!SIL', '<unk>', '#0', '[unk]', "'all", 'a=r', 'Lamp', 'lamp', "o'clock", 'b2b', 'desk',
    ]);
    expect(words).toEqual(['desk', 'lamp', "o'clock"]);
  });
});
