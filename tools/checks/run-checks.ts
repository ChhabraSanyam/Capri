/**
 * `npm run check` smoke checks (task 27.4; Requirements 8.2, 8.3, 10.5, 16.7, 18.10, 19.3, 24.12,
 * 30.8). Dev-time only, never bundled into the app.
 *
 * Reads `src/`, the built `dist/`, and the repository documents, runs the rules in `rules.ts`, prints
 * one PASS or FAIL line per check with the problems under it, and exits 1 when any check fails. Run
 * it after `vite build`: the dist checks need a fresh build. It is bundled with esbuild first (see
 * package.json) because the voice manifest rules import `src/domain/` modules.
 *
 * Usage: npm run check            (from the repository root)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assetUrlLiterals,
  checkDistFileNames,
  checkDomainPurity,
  checkEnvExample,
  checkMaterialAllowList,
  checkNoControllerInput,
  checkNoPostProcessing,
  checkNoToolsImport,
  checkReadmeLinks,
  checkReadmeSections,
  checkSingleVrmPath,
  checkSourceHosts,
  checkThirdParty,
  checkVercelJson,
  checkVoiceLibrary,
  exportedString,
  findDevHandles,
  findEnvValues,
  findHostProblems,
  findPlainHttp,
  findTokens,
  findToolsCode,
  findVrmPaths,
  referencedPanels,
  type SourceFile,
} from './rules.js';

const ROOT = process.cwd();
const TEXT_FILE = /\.(js|mjs|cjs|html|css|json|uikitml|txt|svg|webmanifest|xml)$/u;
const CODE_FILE = /\.(js|mjs|cjs|html)$/u;
/** Vite's env files. `.env.example` is checked separately and holds no values. */
const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local'];

function abs(rel: string): string {
  return join(ROOT, ...rel.split('/'));
}

function exists(rel: string): boolean {
  return existsSync(abs(rel));
}

function readText(rel: string): string | undefined {
  return exists(rel) ? readFileSync(abs(rel), 'utf8') : undefined;
}

/** Repository-relative paths of every file under `dir`, skipping dependency and cache folders. */
function walk(dir: string): string[] {
  if (!exists(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs(dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...walk(rel));
    } else out.push(rel);
  }
  return out;
}

function load(paths: readonly string[]): SourceFile[] {
  return paths.map((path) => ({ path, text: readText(path) ?? '' }));
}

interface Check {
  readonly name: string;
  readonly run: () => string[];
  /** Shown after PASS, for example how many files were scanned. */
  readonly detail?: () => string;
}

// ---------------------------------------------------------------------------------------------

const srcFiles = load(walk('src').filter((p) => p.endsWith('.ts')));
const srcByPath = new Map(srcFiles.map((f) => [f.path, f]));
const distBuilt = exists('dist/index.html');
const distPaths = walk('dist');
const distTexts = load(distPaths.filter((p) => TEXT_FILE.test(p)));
const distCode = distTexts.filter((f) => CODE_FILE.test(f.path));
const envFiles = load(ENV_FILES.filter(exists));

const vrmLiteral = findVrmPaths(srcFiles)[0]?.path;
const vrmPublicPath = vrmLiteral === undefined ? undefined : `public/${vrmLiteral.replace(/^\/+/u, '')}`;

function needsDist(run: () => string[]): () => string[] {
  return () => (distBuilt ? run() : ['dist/index.html is missing: run `npm run build` (vite build) first']);
}

/** Every file the app loads by a fixed path, relative to `dist/`. */
function requiredAssets(): string[] {
  const required = new Set<string>(['index.html', ...assetUrlLiterals(srcFiles)]);
  for (const name of referencedPanels(srcFiles)) required.add(`ui/${name}.uikitml`);
  const worklet = exportedString(srcByPath.get('src/audio/mic-capture.ts'), 'CAPTURE_WORKLET_PATH');
  const model = exportedString(srcByPath.get('src/audio/voice-model.ts'), 'MODEL_FILE_NAME');
  const problems: string[] = [];
  if (worklet === undefined) problems.push('CAPTURE_WORKLET_PATH not found in src/audio/mic-capture.ts');
  else required.add(worklet);
  if (model === undefined) problems.push('MODEL_FILE_NAME not found in src/audio/voice-model.ts');
  else required.add(`vosk/${model}`);

  const iwsdk = readText('iwsdk.config.json');
  const scene = iwsdk === undefined ? undefined : (JSON.parse(iwsdk) as { scene?: string }).scene;
  if (scene === undefined) problems.push('iwsdk.config.json names no scene');
  else required.add(scene.replace(/^\.?\/?public\//u, ''));

  required.add('voice/index.json');
  const voiceIndex = readText('dist/voice/index.json');
  if (voiceIndex !== undefined) {
    const lines = (JSON.parse(voiceIndex) as { lines?: { id: string; file?: string }[] }).lines ?? [];
    for (const line of lines) required.add(`voice/${line.file ?? `${line.id}.mp3`}`);
  }

  for (const rel of [...required].sort()) {
    const path = `dist/${rel}`;
    if (!exists(path)) problems.push(`${path} is missing`);
    else if (statSync(abs(path)).size === 0) problems.push(`${path} is empty`);
    else if (rel.endsWith('.json')) {
      try {
        JSON.parse(readText(path) ?? '');
      } catch {
        problems.push(`${path} is not valid JSON`);
      }
    }
  }
  return problems;
}

const groups: { title: string; checks: Check[] }[] = [
  {
    title: 'Source (src/)',
    checks: [
      {
        name: 'domain/ imports no three, IWSDK, three-vrm, vosk-browser, UIKit, or DOM (followed through relative imports)',
        run: () => checkDomainPurity(srcFiles),
        detail: () => `${srcFiles.filter((f) => f.path.startsWith('src/domain/')).length} domain files`,
      },
      { name: 'no EffectComposer or post-processing passes', run: () => checkNoPostProcessing(srcFiles) },
      { name: 'material allow-list (unlit materials only)', run: () => checkMaterialAllowList(srcFiles) },
      {
        name: 'a single .vrm path, in src/config/',
        run: () => [
          ...checkSingleVrmPath(srcFiles),
          ...(vrmPublicPath !== undefined && !exists(vrmPublicPath) ? [`${vrmPublicPath} does not exist`] : []),
        ],
        detail: () => vrmPublicPath ?? '',
      },
      { name: 'no controller-only input code (src/spike/ exempt)', run: () => checkNoControllerInput(srcFiles) },
      { name: 'src/ imports nothing from tools/', run: () => checkNoToolsImport(srcFiles) },
      { name: 'no hard-coded Home Assistant or Hermes host in src/', run: () => checkSourceHosts(srcFiles) },
      { name: 'no credential or token in src/', run: () => srcFiles.flatMap((f) => findTokens(f.path, f.text)) },
    ],
  },
  {
    title: 'Build output (dist/)',
    checks: [
      {
        name: 'no plain http:// or ws:// URL in dist/',
        run: needsDist(() => distTexts.flatMap((f) => findPlainHttp(f.path, f.text))),
        detail: () => `${distTexts.length} text files`,
      },
      {
        name: 'no hard-coded Home Assistant or Hermes host in dist/',
        run: needsDist(() => distTexts.flatMap((f) => findHostProblems(f.path, f.text))),
      },
      { name: 'no credential or token in dist/', run: needsDist(() => distTexts.flatMap((f) => findTokens(f.path, f.text))) },
      {
        name: 'no .env value in dist/',
        run: needsDist(() => findEnvValues(envFiles, distTexts)),
        detail: () => (envFiles.length === 0 ? 'no .env files present' : envFiles.map((f) => f.path).join(', ')),
      },
      {
        name: 'tools/ absent from the bundle',
        run: needsDist(() => distCode.flatMap((f) => findToolsCode(f.path, f.text))),
      },
      {
        name: 'no AGENTS.md, source maps, env files, or TypeScript sources in dist/',
        run: needsDist(() => checkDistFileNames(distPaths)),
        detail: () => `${distPaths.length} files`,
      },
      {
        name: 'no dev-only handles (__capri*, vfx-dev) in dist/',
        run: needsDist(() => distCode.flatMap((f) => findDevHandles(f.path, f.text))),
      },
      {
        name: 'required assets present (VRM, voice index and every mp3, Vosk model, lexicon, worklet, panels, scene)',
        run: needsDist(requiredAssets),
      },
    ],
  },
  {
    title: 'Repository',
    checks: [
      {
        name: 'voice manifest valid and matches public/voice/index.json',
        run: () =>
          checkVoiceLibrary(readText('voice/voice-manifest.txt'), readText('public/voice/index.json'), (file) =>
            exists(`public/voice/${file}`),
          ),
      },
      { name: 'README required sections present', run: () => checkReadmeSections(readText('README.md'), vrmPublicPath) },
      { name: 'README links resolve', run: () => checkReadmeLinks(readText('README.md'), exists) },
      { name: '.env.example present, placeholders only', run: () => checkEnvExample(readText('.env.example')) },
      {
        name: 'docs/THIRD_PARTY.md names the model, author, source URL, and license',
        run: () => checkThirdParty(readText('docs/THIRD_PARTY.md'), vrmPublicPath),
      },
      { name: 'vercel.json parses, outputs dist/, sets CSP and Permissions-Policy', run: () => checkVercelJson(readText('vercel.json')) },
    ],
  },
];

let failed = 0;
let total = 0;
for (const group of groups) {
  console.log(`\n${group.title}`);
  for (const check of group.checks) {
    total += 1;
    let problems: string[];
    try {
      problems = check.run();
    } catch (error) {
      problems = [`check crashed: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (problems.length === 0) {
      const detail = check.detail?.() ?? '';
      console.log(`  PASS  ${check.name}${detail === '' ? '' : ` (${detail})`}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${check.name}`);
      for (const problem of problems.slice(0, 20)) console.log(`        - ${problem}`);
      if (problems.length > 20) console.log(`        - ... and ${problems.length - 20} more`);
    }
  }
}
console.log(`\n${total - failed} of ${total} checks passed.`);
if (failed > 0) process.exitCode = 1;
