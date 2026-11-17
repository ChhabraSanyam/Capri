/**
 * Dev-time helper (never bundled). Reads the word symbol table that OpenFst embeds in a binary
 * `.fst` file. The small Vosk model ships no `graph/words.txt`, but its `graph/Gr.fst` (the
 * language-model grammar) carries the same table inside the file header: the symbol table named
 * `exp/chain_a/tdnn/lgraph/words.txt`, 152,217 entries in `vosk-model-small-en-us-0.15`.
 *
 * Binary layout (OpenFst `FstHeader::Read` and `SymbolTable::Read`, little-endian):
 *   header:  int32 magic 0x7eb2fdd6, string fsttype, string arctype, int32 version, int32 flags,
 *            uint64 properties, int64 start, int64 numstates, int64 numarcs
 *   flags:   bit 0 = has input symbols, bit 1 = has output symbols
 *   table:   int32 magic 0x7eb2fb74, string name, int64 availableKey, int64 size,
 *            then `size` times (string symbol, int64 key)
 *   string:  int32 byte length followed by the bytes
 *
 * This file has no imports so the Vitest suite can import it directly.
 */

const FST_MAGIC = 0x7eb2fdd6;
const SYMBOL_TABLE_MAGIC = 0x7eb2fb74;
const HAS_INPUT_SYMBOLS = 1;
const HAS_OUTPUT_SYMBOLS = 2;

export interface SymbolEntry {
  readonly symbol: string;
  readonly key: number;
}

export interface SymbolTable {
  readonly name: string;
  readonly entries: readonly SymbolEntry[];
}

class Reader {
  private offset = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(count: number): void {
    if (count < 0 || this.offset + count > this.bytes.length) {
      throw new Error(`Unexpected end of FST data at byte ${this.offset}`);
    }
  }

  int32(): number {
    this.need(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  int64(): number {
    this.need(8);
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('FST int64 value out of safe range');
    }
    return Number(value);
  }

  string(): string {
    const length = this.int32();
    this.need(length);
    const text = new TextDecoder('utf-8').decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return text;
  }
}

function readSymbolTable(reader: Reader): SymbolTable {
  if (reader.int32() !== SYMBOL_TABLE_MAGIC) throw new Error('Not an OpenFst symbol table');
  const name = reader.string();
  reader.int64(); // available key
  const size = reader.int64();
  if (size < 0 || size > 50_000_000) throw new Error(`Implausible symbol table size ${size}`);
  const entries: SymbolEntry[] = [];
  for (let i = 0; i < size; i += 1) {
    const symbol = reader.string();
    const key = reader.int64();
    entries.push({ symbol, key });
  }
  return { name, entries };
}

/**
 * Parse the input symbol table (falling back to the output table) embedded in a binary FST.
 * Throws when the data is not an OpenFst file or carries no symbol table.
 */
export function readFstSymbolTable(bytes: Uint8Array): SymbolTable {
  const reader = new Reader(bytes);
  if (reader.int32() !== FST_MAGIC) throw new Error('Not an OpenFst binary file (bad magic number)');
  reader.string(); // fst type, for example "ngram"
  reader.string(); // arc type, for example "standard"
  reader.int32(); // version
  const flags = reader.int32();
  reader.int64(); // properties
  reader.int64(); // start state
  reader.int64(); // number of states
  reader.int64(); // number of arcs
  if ((flags & (HAS_INPUT_SYMBOLS | HAS_OUTPUT_SYMBOLS)) === 0) {
    throw new Error('The FST has no embedded symbol table');
  }
  // The first embedded table is the input table when present. Gr.fst is an acceptor, so both are
  // the same word table. If only output symbols exist, that table comes first.
  return readSymbolTable(reader);
}

/** Pure tokens only: lowercase letters and inner apostrophes, at least one letter, no leading `'`. */
const WORD_PATTERN = /^[a-z][a-z']*$/;

/**
 * Turn raw symbols into the lexicon word list: drop epsilon, `!SIL`, `<unk>`, `#0`, `[...]` and
 * anything that is not a plain spoken word, lowercase, deduplicate, and sort.
 */
export function lexiconWordsFromSymbols(symbols: Iterable<string>): string[] {
  const words = new Set<string>();
  for (const raw of symbols) {
    const word = raw.toLowerCase();
    if (WORD_PATTERN.test(word)) words.add(word);
  }
  return [...words].sort();
}
