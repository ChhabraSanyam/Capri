/**
 * Dev-time tool (never bundled). Fetches the official `vosk-model-small-en-us-0.15`
 * archive and repackages it into the layout `vosk-browser` expects:
 *
 *   public/vosk/vosk-model-small-en-us-0.15.tar.gz
 *     model/am/final.mdl
 *     model/conf/{mfcc.conf,model.conf}
 *     model/graph/{Gr.fst,HCLr.fst,disambig_tid.int,phones/word_boundary.int}
 *     model/ivector/*
 *
 * `public/vosk/` is git-ignored. The model is licensed Apache-2.0.
 *
 * Usage: npm run fetch:vosk   (runs `node tools/fetch-vosk-model.ts`, Node 22.18+ strips types)
 * Needs the system `unzip` and `tar` commands.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MODEL_NAME = 'vosk-model-small-en-us-0.15';
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;
const OUT_DIR = resolve(import.meta.dirname, '..', 'public', 'vosk');
const OUT_FILE = join(OUT_DIR, `${MODEL_NAME}.tar.gz`);

// Fallback only. The official 0.15 archive already ships conf/model.conf, so this is
// written only if a future archive lacks it. Values mirror the shipped file.
const DEFAULT_MODEL_CONF = [
  '--min-active=200',
  '--max-active=3000',
  '--beam=10.0',
  '--lattice-beam=2.0',
  '--acoustic-scale=1.0',
  '--frame-subsampling-factor=3',
  '--endpoint.silence-phones=1:2:3:4:5:6:7:8:9:10',
  '--endpoint.rule2.min-trailing-silence=0.5',
  '--endpoint.rule3.min-trailing-silence=0.75',
  '--endpoint.rule4.min-trailing-silence=1.0',
  '',
].join('\n');

const REQUIRED_FILES = [
  'am/final.mdl',
  'conf/mfcc.conf',
  'conf/model.conf',
  'graph/Gr.fst',
  'graph/HCLr.fst',
  'graph/phones/word_boundary.int',
  'ivector/final.ie',
];

async function main(): Promise<void> {
  if (existsSync(OUT_FILE) && !process.argv.includes('--force')) {
    console.log(`Already present: ${OUT_FILE} (use --force to rebuild)`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), 'capri-vosk-'));
  try {
    console.log(`Downloading ${MODEL_URL}`);
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const zipPath = join(work, `${MODEL_NAME}.zip`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    execFileSync('unzip', ['-q', zipPath, '-d', work]);
    const extracted = join(work, MODEL_NAME);
    if (!existsSync(extracted)) {
      throw new Error(`Archive did not contain a top-level ${MODEL_NAME}/ folder`);
    }

    // vosk-browser strips the first path component when extracting; `model` matches its README layout.
    const modelDir = join(work, 'model');
    renameSync(extracted, modelDir);

    const confPath = join(modelDir, 'conf', 'model.conf');
    if (!existsSync(confPath)) {
      mkdirSync(join(modelDir, 'conf'), { recursive: true });
      writeFileSync(confPath, DEFAULT_MODEL_CONF);
      console.log('conf/model.conf was missing; wrote a default one');
    }

    const missing = REQUIRED_FILES.filter((f) => !existsSync(join(modelDir, f)));
    if (missing.length > 0) {
      throw new Error(`Repackaged model is missing: ${missing.join(', ')}`);
    }

    mkdirSync(OUT_DIR, { recursive: true });
    // COPYFILE_DISABLE stops macOS tar from adding `._*` AppleDouble entries.
    execFileSync('tar', ['-czf', OUT_FILE, '-C', work, 'model'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    console.log(`Wrote ${OUT_FILE}`);
    console.log(`Top-level entries: ${readdirSync(modelDir).join(', ')}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
