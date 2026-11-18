import { describe, expect, it } from 'vitest';
import envExample from '../../.env.example?raw';
import thirdParty from '../../docs/THIRD_PARTY.md?raw';
import voiceIndex from '../../public/voice/index.json?raw';
import readme from '../../README.md?raw';
import vercelJson from '../../vercel.json?raw';
import manifestText from '../../voice/voice-manifest.txt?raw';
import {
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
  findEnvValues,
  findHostProblems,
  findPlainHttp,
  findTokens,
  headingSlugs,
  type SourceFile,
} from '../../tools/checks/rules.js';
import { importSpecifiers, stripSource } from '../../tools/checks/source-text.js';

/** Task 27.4 smoke check rules (Requirements 8.2, 8.3, 10.5, 16.7, 18.10, 19.3, 24.12, 30.8). */

const SRC = Object.entries(
  import.meta.glob<string>('/src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
).map(([path, text]) => ({ path: path.slice(1), text }));

const file = (path: string, text: string): SourceFile => ({ path, text });

describe('stripSource', () => {
  it('blanks comments in both views and literal contents only in the bare view', () => {
    const text = "const a = 'window'; // document\n/* navigator */ const b = `x ${window.y} z`;\n";
    const { code, bare } = stripSource(text);
    expect(code.split('\n')).toHaveLength(text.split('\n').length);
    expect(code).toContain("'window'");
    expect(code).not.toContain('document');
    expect(code).not.toContain('navigator');
    expect(bare).not.toContain("'window'");
    expect(bare).toContain('${window.y}');
    expect(bare).not.toMatch(/x .*z/u);
  });

  it('treats a quote inside a regex literal as part of the regex', () => {
    const { bare } = stripSource("const r = /'/u; const w = window;\nreturn /\"/.test(s);");
    expect(bare).toContain('const w = window;');
  });
});

describe('importSpecifiers', () => {
  it('finds static, type-only, side-effect, dynamic, re-export, and require specifiers', () => {
    const code = [
      "import { a } from './a.js';",
      "import type { B } from 'three';",
      "import './side.js';",
      "const m = await import('@iwsdk/core');",
      "export * from '../c.js';",
      "const v = require('vosk-browser');",
    ].join('\n');
    const refs = importSpecifiers(code);
    expect(refs.map((r) => r.specifier).sort()).toEqual(['../c.js', './a.js', './side.js', '@iwsdk/core', 'three', 'vosk-browser'].sort());
    expect(refs.find((r) => r.specifier === 'three')?.typeOnly).toBe(true);
    expect(refs.find((r) => r.specifier === './a.js')?.typeOnly).toBe(false);
  });
});

describe('source rules', () => {
  it('the source tree passes every source rule', () => {
    expect(SRC.length).toBeGreaterThan(50);
    expect(checkDomainPurity(SRC)).toEqual([]);
    expect(checkNoPostProcessing(SRC)).toEqual([]);
    expect(checkMaterialAllowList(SRC)).toEqual([]);
    expect(checkSingleVrmPath(SRC)).toEqual([]);
    expect(checkNoControllerInput(SRC)).toEqual([]);
    expect(checkNoToolsImport(SRC)).toEqual([]);
    expect(checkSourceHosts(SRC)).toEqual([]);
    expect(SRC.flatMap((f) => findTokens(f.path, f.text))).toEqual([]);
  });

  it('domain purity catches direct and indirect three imports and DOM globals, not types or strings', () => {
    const files = [
      file('src/domain/direct.ts', "import { Vector3 } from 'three';"),
      file('src/domain/indirect.ts', "import { helper } from '../app/helper.js';"),
      file('src/app/helper.ts', "import { Object3D } from '@iwsdk/core';\nexport const helper = 1;"),
      file('src/domain/typed.ts', "import type { Vector3 } from 'three';\nconst word = 'window';\nconst o = { window: 1 };"),
      file('src/domain/dom.ts', 'export const w = window.innerWidth;'),
    ];
    const problems = checkDomainPurity(files).join('\n');
    expect(problems).toContain('src/domain/direct.ts imports `three`');
    expect(problems).toContain('src/domain/indirect.ts → … → src/app/helper.ts imports `@iwsdk/core`');
    expect(problems).toContain('src/domain/dom.ts:1 uses the browser global `window`');
    expect(problems).not.toContain('typed.ts');
  });

  it('flags post-processing, materials off the allow-list, and controller reads', () => {
    expect(checkNoPostProcessing([file('src/vfx/x.ts', "import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';")])).toHaveLength(2);
    expect(checkMaterialAllowList([file('src/vfx/x.ts', 'new MeshStandardMaterial(); new MeshBasicMaterial();')])).toEqual([
      'src/vfx/x.ts:1 uses `MeshStandardMaterial`, which is not on the material allow-list',
    ]);
    const input = 'const g = source.gamepad;';
    expect(checkNoControllerInput([file('src/xr/hands.ts', input)])).toHaveLength(1);
    expect(checkNoControllerInput([file('src/spike/items/a.ts', input)])).toEqual([]);
  });

  it('requires one .vrm path, in src/config/, and no tools/ import', () => {
    expect(checkSingleVrmPath([file('src/config/a.ts', "assetUrl('models/a.vrm')")])).toEqual([]);
    expect(checkSingleVrmPath([file('src/config/a.ts', "'models/a.vrm'"), file('src/avatar/b.ts', "'b.vrm'")]).join('\n')).toContain(
      'outside src/config/',
    );
    expect(checkNoToolsImport([file('src/app/x.ts', "import { f } from '../../tools/voice-script/loudness.js';")])).toHaveLength(1);
  });
});

describe('host, HTTP, token, and env rules', () => {
  it('flags the owner domain, personal backend hosts, and unknown hosts, not example hosts', () => {
    expect(findHostProblems('a.js', 'fetch("https://hermes-api.sanyamchhabra.in/v1/runs")').length).toBeGreaterThan(0);
    expect(findHostProblems('a.js', 'const u = "https://abc.ui.nabu.casa";').join('\n')).toContain('nabu');
    expect(findHostProblems('a.js', 'const u = "https://my-home.duckdns.org";')).toHaveLength(1);
    expect(findHostProblems('a.js', 'placeholder: "https://your-home.example", ns: "http://www.w3.org/2000/svg"')).toEqual([]);
  });

  it('flags plain http:// and ws:// URLs except namespace identifiers', () => {
    expect(findPlainHttp('a.js', 'fetch("http://homeassistant.local:8123/api")')).toHaveLength(1);
    expect(findPlainHttp('a.js', 'new WebSocket("ws://host/x")')).toHaveLength(1);
    expect(findPlainHttp('a.js', 'createElementNS("http://www.w3.org/2000/svg", "svg")')).toEqual([]);
  });

  it('reports a token or .env value by location and key, never by value', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    const hits = findTokens('dist/assets/x.js', `const t = "${jwt}";`);
    expect(hits).toHaveLength(1);
    expect(hits[0]).not.toContain(jwt);

    const secret = 'super-secret-token-value';
    const env = [file('.env', `VITE_DEV_HA_TOKEN=${secret}\nSHORT=abc\n`)];
    const leaks = findEnvValues(env, [file('dist/assets/x.js', `a="${secret}"`)]);
    expect(leaks).toEqual(['the value of VITE_DEV_HA_TOKEN from .env appears in dist/assets/x.js']);
    expect(findEnvValues(env, [file('dist/assets/x.js', 'abc')])).toEqual([]);
  });

  it('flags agent guidance, source maps, env files, TypeScript, and tools/ in dist', () => {
    const problems = checkDistFileNames([
      'dist/index.html',
      'dist/ui/AGENTS.md',
      'dist/assets/main.js.map',
      'dist/.env',
      'dist/src/app.ts',
      'dist/tools/x.js',
    ]);
    expect(problems).toHaveLength(5);
  });
});

describe('repository documents', () => {
  const existing = new Set(['docs/demo-path.md', 'docs/performance-note.md']);

  it('README has the required sections and its links resolve', () => {
    expect(checkReadmeSections(readme, 'public/models/capri.vrm')).toEqual([]);
    expect(checkReadmeSections('# Capri\n\nNothing here.\n', undefined).length).toBeGreaterThan(5);
  });

  it('README link check catches a missing doc and a missing anchor', () => {
    const text = '# Top\n\n## Live Mode\n\n[a](docs/performance.md) [b](docs/demo-path.md#x) [c](#live-mode) [d](#nope) [e](https://x.example)\n';
    expect(checkReadmeLinks(text, (p) => existing.has(p))).toEqual([
      'README.md:5 links to a missing file docs/performance.md',
      'README.md:5 links to a missing heading #nope',
    ]);
    expect(headingSlugs('## Your credentials\n### Your credentials\n')).toEqual(new Set(['your-credentials', 'your-credentials-1']));
  });

  it('voice manifest and index agree, and a missing mp3 is reported', () => {
    expect(checkVoiceLibrary(manifestText, voiceIndex, () => true)).toEqual([]);
    expect(checkVoiceLibrary(manifestText, voiceIndex, (f) => f !== 'quip_01.mp3')).toEqual(['voice file quip_01.mp3 for quip_01 is missing']);
    expect(checkVoiceLibrary('[greeting]\ngreeting_01 | neutral | Hi.\n', voiceIndex, () => true).length).toBeGreaterThan(0);
  });

  it('.env.example, THIRD_PARTY.md, and vercel.json pass, and a filled value fails', () => {
    expect(checkEnvExample(envExample)).toEqual([]);
    expect(checkEnvExample('VITE_DEV_HA_TOKEN=abc\n')).toEqual(['.env.example sets a value for VITE_DEV_HA_TOKEN; keep values empty']);
    expect(checkEnvExample(undefined)).toEqual(['.env.example is missing']);
    expect(checkThirdParty(thirdParty, 'public/models/capri.vrm')).toEqual([]);
    expect(checkThirdParty('| Model name | X |\n', undefined).length).toBeGreaterThan(0);
    expect(checkVercelJson(vercelJson)).toEqual([]);
    expect(checkVercelJson('{"outputDirectory":"build"}').length).toBeGreaterThan(0);
  });
});
