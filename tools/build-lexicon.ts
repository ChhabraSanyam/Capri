/**
 * Dev-time tool (never bundled). Builds the speech lexicon: the list of words the small English
 * Vosk model can recognise. Device names and grammar phrases are checked against it, so a name
 * the recogniser cannot hear is flagged and the user is offered a nickname (Requirements 12.8, 14.5).
 *
 * Word source. The small model has no `graph/words.txt` (checked in task 9.2: the archive holds
 * `am/`, `conf/`, `graph/{Gr.fst,HCLr.fst,disambig_tid.int,phones/word_boundary.int}`, `ivector/`).
 * `graph/Gr.fst` embeds the word symbol table in its header, so this tool reads it from there.
 * That table is the decoder's own vocabulary. If a future model does ship `graph/words.txt`, the
 * tool uses it first.
 *
 * Output: `public/vosk/lexicon.txt` (git-ignored, one lowercase word per line). A runtime adapter
 * loads it and passes it to `parseLexiconText` in `src/domain/speech-lang/lexicon.ts`.
 *
 * Usage: npm run build:lexicon [-- --model <model .tar.gz or extracted dir>] [--out <file>]
 * Needs `npm run fetch:vosk` first when using the default model path, and the system `tar` command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { lexiconWordsFromSymbols, readFstSymbolTable } from './fst-symbols.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_MODEL = join(ROOT, 'public', 'vosk', 'vosk-model-small-en-us-0.15.tar.gz');
const DEFAULT_OUT = join(ROOT, 'public', 'vosk', 'lexicon.txt');
const MAX_BYTES = 128 * 1024 * 1024;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Read `graph/<file>` from an extracted model directory or from a `model/`-rooted tar.gz. */
function readModelFile(model: string, file: string): Buffer | null {
  if (statSync(model).isDirectory()) {
    const path = join(model, 'graph', file);
    return existsSync(path) ? readFileSync(path) : null;
  }
  try {
    return execFileSync('tar', ['-xzOf', model, `model/graph/${file}`], {
      maxBuffer: MAX_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'], // a missing member is an expected outcome, not an error
    });
  } catch {
    return null;
  }
}

function main(): void {
  const model = resolve(argValue('--model') ?? DEFAULT_MODEL);
  const out = resolve(argValue('--out') ?? DEFAULT_OUT);
  if (!existsSync(model)) {
    throw new Error(`Model not found: ${model}. Run "npm run fetch:vosk" first or pass --model.`);
  }

  let symbols: string[];
  let source: string;
  const wordsTxt = readModelFile(model, 'words.txt');
  if (wordsTxt !== null) {
    // Kaldi words.txt: "<word> <id>" per line.
    symbols = wordsTxt
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter((word) => word.length > 0);
    source = 'graph/words.txt';
  } else {
    const grFst = readModelFile(model, 'Gr.fst');
    if (grFst === null) throw new Error('The model has neither graph/words.txt nor graph/Gr.fst');
    const table = readFstSymbolTable(new Uint8Array(grFst.buffer, grFst.byteOffset, grFst.byteLength));
    symbols = table.entries.map((entry) => entry.symbol);
    source = `graph/Gr.fst embedded symbol table (${table.name})`;
  }

  const words = lexiconWordsFromSymbols(symbols);
  if (words.length < 1000) throw new Error(`Only ${words.length} words found. Refusing to write.`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${words.join('\n')}\n`);
  console.log(`Source: ${source}`);
  console.log(`Symbols read: ${symbols.length}, lexicon words written: ${words.length}`);
  console.log(`Wrote ${out}`);
}

try {
  main();
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
