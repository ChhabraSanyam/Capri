/**
 * Piper engine for the Voice_Script (task 13.19; decision in docs/voice-engine.md).
 *
 * Shells out to `tools/voice-script/.venv/bin/python -m piper` with the voice `en_US-kristin-medium`
 * from `tools/voice-script/.cache/voices`. The text goes in on stdin, so quotes and dashes in a line
 * never reach a shell or the argument list. Piper writes a WAV file that this module reads back.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceEngine } from './types.ts';

export const PIPER_VOICE = 'en_US-kristin-medium';

// `npm run voice` bundles the script into `.tmp/`, so paths come from the project root (the npm cwd).
const SCRIPT_DIR = join(process.cwd(), 'tools', 'voice-script');
const PYTHON = join(SCRIPT_DIR, '.venv', 'bin', 'python');
const VOICES_DIR = join(SCRIPT_DIR, '.cache', 'voices');
const SETUP_HINT = 'Set it up with the commands in docs/voice-engine.md ("Setup").';

export function createPiperEngine(voice: string = PIPER_VOICE): VoiceEngine {
  return {
    name: `piper:${voice}`,
    check() {
      if (!existsSync(PYTHON)) {
        throw new Error(`Piper is not installed: ${PYTHON} is missing. ${SETUP_HINT}`);
      }
      const model = join(VOICES_DIR, `${voice}.onnx`);
      if (!existsSync(model) || !existsSync(`${model}.json`)) {
        throw new Error(`Piper voice model is missing: ${model}(.json). ${SETUP_HINT}`);
      }
    },
    async synthesize(text, id) {
      const work = mkdtempSync(join(tmpdir(), `capri-piper-${id}-`));
      const wavPath = join(work, 'out.wav');
      try {
        await run(PYTHON, ['-m', 'piper', '--data-dir', VOICES_DIR, '-m', voice, '-f', wavPath], text);
        if (!existsSync(wavPath)) throw new Error(`Piper wrote no audio for "${id}".`);
        return new Uint8Array(readFileSync(wavPath));
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
  };
}

function run(command: string, args: readonly string[], stdin: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`piper exited with code ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}`));
    });
    child.stdin.end(stdin);
  });
}
