/**
 * Smoke check rules (task 27.4). Pure functions over file text, so they run under Vitest and in the
 * `npm run check` runner (`run-checks.ts`) alike. Dev-time only, never bundled into the app.
 *
 * Each rule returns a list of problems. An empty list is a pass. Paths are repository-relative with
 * forward slashes. A rule never prints a value it found to be secret, only where it was found.
 */
import { parseVoiceManifest, validateClaims, validateManifest } from '../../src/domain/speech/voice-manifest.js';
import { importSpecifiers, lineAt, stripSource, type ImportRef, type StrippedSource } from './source-text.js';

export interface SourceFile {
  /** Repository-relative path with forward slashes, for example `src/domain/geometry.ts`. */
  readonly path: string;
  readonly text: string;
}

// ---------------------------------------------------------------------------------------------
// Paths

/** `a/b/../c` → `a/c`. Forward slashes only. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Resolve a relative import to a known `.ts` file, or to the plain joined path when none matches. */
export function resolveImport(from: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const joined = normalizePath(`${dirname(from)}/${specifier}`);
  const candidates = [joined, joined.replace(/\.js$/u, '.ts'), `${joined}.ts`, `${joined}/index.ts`];
  return candidates.find((c) => known.has(c)) ?? joined;
}

// ---------------------------------------------------------------------------------------------
// Parsed source cache

interface Parsed {
  readonly file: SourceFile;
  readonly stripped: StrippedSource;
  readonly imports: readonly ImportRef[];
}

const parsedCache = new WeakMap<SourceFile, Parsed>();

function parse(file: SourceFile): Parsed {
  let parsed = parsedCache.get(file);
  if (parsed === undefined) {
    const stripped = stripSource(file.text);
    parsed = { file, stripped, imports: importSpecifiers(stripped.code) };
    parsedCache.set(file, parsed);
  }
  return parsed;
}

function where(file: SourceFile, text: string, offset: number): string {
  return `${file.path}:${lineAt(text, offset)}`;
}

// ---------------------------------------------------------------------------------------------
// Source rules (src/**/*.ts)

/** Packages that `src/domain/` must not reach, directly or through a relative import chain. */
export const DOMAIN_BANNED_PACKAGES = /^(three($|\/)|@iwsdk\/|@pixiv\/|vosk-browser($|\/)|jsdom($|\/)|@pmndrs\/)/u;

/** Browser globals that `src/domain/` must not use. */
const DOMAIN_BANNED_GLOBALS =
  /(?<![.\w$])(window|document|navigator|localStorage|sessionStorage|HTMLElement|HTMLCanvasElement|AudioContext|requestAnimationFrame|customElements|XRSession)\b(?!\s*:(?!:))/gu;

/**
 * Requirement 17.1 (design "Pure, testable core"): no `three`, IWSDK, three-vrm, vosk-browser, UIKit,
 * or DOM in `src/domain/`. Runtime imports are followed through relative paths, so a domain file
 * cannot reach `three` through a helper in another folder. `import type` is erased and not followed.
 */
export function checkDomainPurity(srcFiles: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  const byPath = new Map(srcFiles.map((f) => [f.path, f]));
  const known = new Set(byPath.keys());
  for (const file of srcFiles) {
    if (!file.path.startsWith('src/domain/')) continue;
    const { stripped } = parse(file);
    for (const m of stripped.bare.matchAll(DOMAIN_BANNED_GLOBALS)) {
      problems.push(`${where(file, stripped.bare, m.index ?? 0)} uses the browser global \`${m[1] ?? ''}\``);
    }
    // Breadth-first walk of runtime imports, remembering how each file was reached.
    const via = new Map<string, string>([[file.path, file.path]]);
    const queue = [file.path];
    while (queue.length > 0) {
      const path = queue.shift() ?? '';
      const current = byPath.get(path);
      if (current === undefined) continue;
      for (const ref of parse(current).imports) {
        if (ref.typeOnly) continue;
        if (DOMAIN_BANNED_PACKAGES.test(ref.specifier)) {
          const chain = path === file.path ? file.path : `${file.path} → … → ${path}`;
          problems.push(`${chain} imports \`${ref.specifier}\``);
          continue;
        }
        const target = resolveImport(path, ref.specifier, known);
        if (target !== undefined && !via.has(target)) {
          via.set(target, path);
          queue.push(target);
        }
      }
    }
  }
  return [...new Set(problems)];
}

/** Requirement 18.10, 29.2: no post-processing. */
export function checkNoPostProcessing(srcFiles: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of srcFiles) {
    const { stripped, imports } = parse(file);
    for (const m of stripped.bare.matchAll(/\b(EffectComposer|RenderPass|UnrealBloomPass|ShaderPass|OutputPass|BokehPass)\b/gu)) {
      problems.push(`${where(file, stripped.bare, m.index ?? 0)} uses \`${m[1] ?? ''}\``);
    }
    for (const ref of imports) {
      if (/postprocessing|EffectComposer/iu.test(ref.specifier)) problems.push(`${file.path} imports \`${ref.specifier}\``);
    }
  }
  return problems;
}

/**
 * Requirement 18.10, 29.2: unlit, low-cost materials only. `LineBasicMaterial` (VFX glitch lines,
 * hand skeleton) and `SpriteMaterial` (mock bulb glow) are unlit like the two the design names.
 */
export const MATERIAL_ALLOW_LIST: ReadonlySet<string> = new Set([
  'MeshBasicMaterial',
  'PointsMaterial',
  'LineBasicMaterial',
  'SpriteMaterial',
]);

export function checkMaterialAllowList(srcFiles: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of srcFiles) {
    const { stripped } = parse(file);
    for (const m of stripped.bare.matchAll(/\b([A-Z][A-Za-z0-9]*Material)\b/gu)) {
      const name = m[1] ?? '';
      if (!MATERIAL_ALLOW_LIST.has(name)) {
        problems.push(`${where(file, stripped.bare, m.index ?? 0)} uses \`${name}\`, which is not on the material allow-list`);
      }
    }
  }
  return problems;
}

/** Requirements 10.2, 10.3: one `.vrm` path, in `src/config/`. Returns the path when there is one. */
export function findVrmPaths(srcFiles: readonly SourceFile[]): { path: string; at: string }[] {
  const found: { path: string; at: string }[] = [];
  for (const file of srcFiles) {
    const { code } = parse(file).stripped;
    for (const m of code.matchAll(/(['"`])([^'"`\n]*\.vrm)\1/gu)) {
      found.push({ path: m[2] ?? '', at: where(file, code, m.index ?? 0) });
    }
  }
  return found;
}

export function checkSingleVrmPath(srcFiles: readonly SourceFile[]): string[] {
  const found = findVrmPaths(srcFiles);
  if (found.length === 0) return ['no `.vrm` path found in src/ (expected one in src/config/)'];
  const problems: string[] = [];
  if (found.length > 1) problems.push(`${found.length} \`.vrm\` paths found: ${found.map((f) => f.at).join(', ')}`);
  for (const f of found) if (!f.at.startsWith('src/config/')) problems.push(`\`.vrm\` path outside src/config/ at ${f.at}`);
  return problems;
}

/** Requirements 8.2, 8.3, 9.11: the same rule as tests/unit/no-controller-input.test.ts. */
const CONTROLLER_INPUT =
  /\.gamepad\b|\bgamepads?\b|\bgetButton(Down|Up)?\b|\bgetAxes(Values)?\b|\bInputComponent\b|\bXRControllerVisualAdapter\b/gu;

/** The Milestone 0 spike (`src/spike/`) is exempt because it measures the gamepad on purpose. */
export function checkNoControllerInput(srcFiles: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of srcFiles) {
    if (file.path.startsWith('src/spike/')) continue;
    const { code } = parse(file).stripped;
    for (const m of code.matchAll(CONTROLLER_INPUT)) {
      problems.push(`${where(file, code, m.index ?? 0)} reads controller input (\`${m[0]}\`)`);
    }
  }
  return problems;
}

/** Requirement 16.7: nothing under `tools/` is imported by the app. */
export function checkNoToolsImport(srcFiles: readonly SourceFile[]): string[] {
  const problems: string[] = [];
  const known = new Set(srcFiles.map((f) => f.path));
  for (const file of srcFiles) {
    for (const ref of parse(file).imports) {
      const target = resolveImport(file.path, ref.specifier, known);
      if ((target !== undefined && target.startsWith('tools/')) || /(^|\/)tools\//u.test(ref.specifier)) {
        problems.push(`${file.path} imports \`${ref.specifier}\``);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Hosts, plain HTTP, and secrets (src/ and dist/)

/**
 * Hosts that may appear in a URL in `src/` or `dist/`. None of them is a Home Assistant or Hermes
 * endpoint. A new host fails the check until it is reviewed and added here with its reason.
 */
const ALLOWED_HOSTS: readonly { host: RegExp; why: string }[] = [
  { host: /(^|\.)example(\.(com|org|net))?$/u, why: 'documentation example host' },
  { host: /\.(invalid|test)$/u, why: 'reserved test host' },
  { host: /^iwsdk\.local$/u, why: 'IWSDK base for resolving relative URLs, never fetched' },
  { host: /^www\.w3\.org$/u, why: 'XML namespace URIs (SVG, XHTML, XLink)' },
  { host: /^json-schema\.org$/u, why: 'JSON Schema `$schema` identifiers in zod' },
  { host: /^unpkg\.com$/u, why: 'three.js default decoder base, not used by Capri' },
  { host: /^cdn\.jsdelivr\.net$/u, why: 'WebXR input profile default in IWSDK' },
  { host: /^api\.dicebear\.com$/u, why: 'UIKit Horizon avatar component default' },
  { host: /^(iwsdk\.dev|vrm\.dev|jcgt\.org|github\.com|hacksoflife\.blogspot\.ch)$/u, why: 'library docs links' },
];

/**
 * Text that must never be in `src/` code or `dist/`: the owner's own domain (the hosted origin and
 * the Hermes host, kept out of the app on purpose, see docs/hosting.md) and the usual shapes of a
 * personal Home Assistant or Hermes address.
 */
export const DENIED_HOST_TEXT: readonly RegExp[] = [
  /sanyamchhabra/iu,
  /\bnabu\.casa\b/iu,
  /\.ts\.net\b/iu,
  /\btrycloudflare\.com\b/iu,
  /\bngrok(-free)?\.(io|app|dev)\b/iu,
  /\bhomeassistant\.local\b/iu,
  /[a-z0-9\]]:(8123|8642)\b/iu,
];

const URL_PATTERN = /\b(https?|wss?):\/\/([^\s'"`/?#)\]\\<>]+)/gu;

function hostOf(authority: string): string {
  const noUser = authority.slice(authority.lastIndexOf('@') + 1);
  return noUser.replace(/:\d+$/u, '').toLowerCase();
}

function isRealHost(host: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/u.test(host) || host === 'localhost';
}

export function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.some((a) => a.host.test(host));
}

/**
 * Requirement 19.3, 24.6, 24.7: no hard-coded Home Assistant or Hermes host. Every URL host must be
 * on the allow-list, and none of the denied texts may appear. `text` is comment-stripped source or
 * built output.
 */
export function findHostProblems(label: string, text: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_PATTERN)) {
    const host = hostOf(m[2] ?? '');
    if (host.includes('${') || !isRealHost(host) || isAllowedHost(host) || seen.has(host)) continue;
    seen.add(host);
    problems.push(`${label}:${lineAt(text, m.index ?? 0)} names the host \`${host}\`, which is not on the allow-list`);
  }
  for (const pattern of DENIED_HOST_TEXT) {
    const m = pattern.exec(text);
    if (m !== null) problems.push(`${label}:${lineAt(text, m.index)} contains a personal or backend host (${pattern.source})`);
  }
  return problems;
}

/** `src/` scan for hosts: comment-stripped code, so example URLs in doc comments do not count. */
export function checkSourceHosts(srcFiles: readonly SourceFile[]): string[] {
  return srcFiles.flatMap((file) => findHostProblems(file.path, parse(file).stripped.code));
}

/**
 * `http://` and `ws://` strings in the built output that are not requests: XML namespace URIs, JSON
 * Schema identifiers, a URL in a three-vrm GLSL comment, and zod's IPv6 validator template.
 */
const PLAIN_HTTP_ALLOWED: readonly RegExp[] = [
  /^http:\/\/www\.w3\.org\//u,
  /^http:\/\/json-schema\.org\//u,
  /^http:\/\/hacksoflife\.blogspot\.ch\//u,
  /^http:\/\/\[\$\{\w+\}\]/u,
];

/** Requirement 30.8: no plain `http://` or `ws://` URL in `dist/`. */
export function findPlainHttp(label: string, text: string): string[] {
  const problems: string[] = [];
  for (const m of text.matchAll(/\b(?:http|ws):\/\/[^\s'"`<>)]*/gu)) {
    const url = m[0];
    if (PLAIN_HTTP_ALLOWED.some((p) => p.test(url))) continue;
    problems.push(`${label}:${lineAt(text, m.index ?? 0)} has a plain-HTTP URL \`${url.slice(0, 60)}\``);
  }
  return problems;
}

/** Shapes of real credentials. A match is reported by location only, never by value. */
const TOKEN_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'a JWT (Home Assistant long-lived tokens are JWTs)', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u },
  { name: 'a literal Bearer token', pattern: /\bBearer\s+(?!\$\{)[A-Za-z0-9._~+/-]{20,}/u },
  { name: 'an API key (sk-...)', pattern: /\bsk-[A-Za-z0-9_-]{20,}/u },
  { name: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/u },
  { name: 'an AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
];

/** Requirements 24.10, 29.6, 29.7: no credential in `src/` or `dist/`. */
export function findTokens(label: string, text: string): string[] {
  const problems: string[] = [];
  for (const { name, pattern } of TOKEN_PATTERNS) {
    const m = pattern.exec(text);
    if (m !== null) problems.push(`${label}:${lineAt(text, m.index)} contains what looks like ${name}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// dist/ rules

/** Dev-only window handles and the VFX dev module, all behind `import.meta.env.DEV`. */
export function findDevHandles(label: string, text: string): string[] {
  const m = /__capri\w*|vfx-dev/u.exec(text);
  return m === null ? [] : [`${label}:${lineAt(text, m.index)} contains the dev-only \`${m[0]}\``];
}

/** Requirement 16.7: markers of `tools/` code (Node APIs and script names) in the bundle. */
export function findToolsCode(label: string, text: string): string[] {
  const m = /node:(child_process|fs|os|path)\b|\b(execFileSync|spawnSync)\b|generate-voice-library|fetch-vosk-model|build-lexicon|\bffmpeg\b|\bsourceMappingURL=/u.exec(
    text,
  );
  return m === null ? [] : [`${label}:${lineAt(text, m.index)} contains \`${m[0]}\` (dev-time tooling or a source map)`];
}

/** Files that must not ship: agent guidance, source maps, env files, TypeScript sources, tools/. */
export function checkDistFileNames(distPaths: readonly string[]): string[] {
  const problems: string[] = [];
  for (const path of distPaths) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name === 'AGENTS.md' || name === 'CLAUDE.md') problems.push(`${path} is agent guidance`);
    else if (name.endsWith('.map')) problems.push(`${path} is a source map`);
    else if (name.startsWith('.env')) problems.push(`${path} is an env file`);
    else if (/\.tsx?$/u.test(name) && !name.endsWith('.d.ts')) problems.push(`${path} is TypeScript source`);
    if (/(^|\/)tools\//u.test(path)) problems.push(`${path} is under tools/`);
  }
  return problems;
}

/** Parse `.env` text into key and value pairs. Quotes around a value are removed. */
export function parseEnv(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(raw);
    if (m === null) continue;
    let value = m[2] ?? '';
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/u, '');
    out.push({ key: m[1] ?? '', value });
  }
  return out;
}

/** Values shorter than this are too generic to search for (`true`, `8081`). */
export const ENV_VALUE_MIN_LENGTH = 8;

/** Requirement 24.12 and `.env.example`: no `.env` value in `dist/`. Reports the key, never the value. */
export function findEnvValues(
  envFiles: readonly SourceFile[],
  distTexts: readonly SourceFile[],
): string[] {
  const problems: string[] = [];
  for (const env of envFiles) {
    for (const { key, value } of parseEnv(env.text)) {
      if (value.length < ENV_VALUE_MIN_LENGTH) continue;
      const hit = distTexts.find((d) => d.text.includes(value));
      if (hit !== undefined) problems.push(`the value of ${key} from ${env.path} appears in ${hit.path}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Repository documents

/** Requirement 24.12: `.env.example` exists and holds placeholders only (every value empty). */
export function checkEnvExample(text: string | undefined): string[] {
  if (text === undefined) return ['.env.example is missing'];
  const filled = parseEnv(text).filter((e) => e.value !== '');
  return filled.map((e) => `.env.example sets a value for ${e.key}; keep values empty`);
}

/** Requirement 10.5: the placeholder VRM record names the model, author, source URL, and license. */
export function checkThirdParty(text: string | undefined, vrmPublicPath: string | undefined): string[] {
  if (text === undefined) return ['docs/THIRD_PARTY.md is missing'];
  const fields = new Map<string, string>();
  for (const m of text.matchAll(/^\|\s*([^|\n]+?)\s*\|\s*([^|\n]*?)\s*\|\s*$/gmu)) fields.set(m[1] ?? '', m[2] ?? '');
  const problems: string[] = [];
  for (const name of ['Model name', 'Author', 'Source', 'License']) {
    const value = fields.get(name);
    if (value === undefined || value === '') problems.push(`docs/THIRD_PARTY.md has no "${name}" field`);
  }
  if (!/https:\/\//u.test(fields.get('Source') ?? '')) problems.push('docs/THIRD_PARTY.md "Source" has no https URL');
  if (vrmPublicPath !== undefined && !text.includes(vrmPublicPath)) {
    problems.push(`docs/THIRD_PARTY.md does not name the bundled model file ${vrmPublicPath}`);
  }
  return problems;
}

interface Heading {
  readonly level: number;
  readonly text: string;
  readonly offset: number;
}

function stripFences(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gmu, (block) => block.replace(/[^\n]/gu, ' '));
}

function headings(markdown: string): Heading[] {
  const out: Heading[] = [];
  for (const m of stripFences(markdown).matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gmu)) {
    out.push({ level: (m[1] ?? '').length, text: m[2] ?? '', offset: m.index ?? 0 });
  }
  return out;
}

/** The text under the first heading matching `title`, up to the next heading of the same or higher level. */
function section(markdown: string, title: RegExp): string | undefined {
  const all = headings(markdown);
  const index = all.findIndex((h) => title.test(h.text));
  const start = all[index];
  if (start === undefined) return undefined;
  const end = all.slice(index + 1).find((h) => h.level <= start.level);
  return markdown.slice(start.offset, end?.offset ?? markdown.length);
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens, `-1` for repeats. */
export function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  const counts = new Map<string, number>();
  for (const h of headings(markdown)) {
    const base = h.text
      .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/gu, '-');
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

/** README sections the requirements ask for, each as a name and a test. */
export function readmeRequirements(vrmPublicPath: string | undefined): { name: string; test: (readme: string) => boolean }[] {
  return [
    {
      name: 'Mock Mode from the hosted link with no setup (31.7)',
      test: (r) => {
        const s = section(r, /quick start/iu);
        return s !== undefined && /Mock Mode/u.test(s) && /https:\/\//u.test(s) && /\bno (account|setup|configuration)\b/iu.test(s);
      },
    },
    {
      name: 'How to configure Live Mode (31.8)',
      test: (r) => section(r, /^Live Mode$/u) !== undefined && section(r, /configure live mode/iu) !== undefined,
    },
    {
      name: 'Credentials stored only on the device, sent only to configured endpoints, never logged (24.13)',
      test: (r) => /stored only on/iu.test(r) && /sent only to/iu.test(r) && /never logged/iu.test(r),
    },
    { name: 'Dev server over the local network (30.5)', test: (r) => /\b(local network|LAN)\b/u.test(r) },
    { name: 'Dev server through `adb reverse` (30.6)', test: (r) => /adb reverse tcp:\d+ tcp:\d+/u.test(r) },
    {
      name: 'Cloudflare Tunnel or ngrok as a fallback only (30.7)',
      test: (r) => /(Cloudflare Tunnel|ngrok)/u.test(r) && /(last resort|fallback)/iu.test(r),
    },
    {
      name: 'Vercel deploy with the Git integration or CLI and the CNAME record (30.3)',
      test: (r) => {
        const s = section(r, /deploy/iu);
        return s !== undefined && /Git integration/u.test(s) && /vercel --prod|Vercel CLI/u.test(s) && /CNAME/u.test(s);
      },
    },
    { name: 'Demo_Path script linked (28.5, 28.8)', test: (r) => /\]\(docs\/demo-path\.md\)/u.test(r) },
    {
      name: 'Third-party assets with licenses, including the placeholder VRM (10.6, 31.9)',
      test: (r) => {
        const s = section(r, /third-party assets/iu);
        return s !== undefined && /licen[sc]e/iu.test(s) && (vrmPublicPath === undefined || s.includes(vrmPublicPath));
      },
    },
  ];
}

export function checkReadmeSections(readme: string | undefined, vrmPublicPath: string | undefined): string[] {
  if (readme === undefined) return ['README.md is missing'];
  return readmeRequirements(vrmPublicPath)
    .filter((req) => !req.test(readme))
    .map((req) => `README.md is missing: ${req.name}`);
}

/** Every relative link and in-page anchor in the README resolves. */
export function checkReadmeLinks(readme: string | undefined, exists: (path: string) => boolean): string[] {
  if (readme === undefined) return ['README.md is missing'];
  const problems: string[] = [];
  const slugs = headingSlugs(readme);
  const body = stripFences(readme);
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    const target = m[1] ?? '';
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
    const line = lineAt(body, m.index ?? 0);
    if (target.startsWith('#')) {
      if (!slugs.has(target.slice(1))) problems.push(`README.md:${line} links to a missing heading ${target}`);
      continue;
    }
    const path = normalizePath(decodeURIComponent(target.split('#')[0] ?? ''));
    if (!exists(path)) problems.push(`README.md:${line} links to a missing file ${path}`);
  }
  return problems;
}

/**
 * Requirements 16.2, 16.3, 16.5, 22.2: the Voice_Manifest parses and validates (categories, 5 to 10
 * variants, two sentences at most, claims per category), and `public/voice/index.json` lists the
 * same lines with a file that exists.
 */
export function checkVoiceLibrary(
  manifestText: string | undefined,
  indexText: string | undefined,
  voiceFileExists: (file: string) => boolean,
): string[] {
  if (manifestText === undefined) return ['voice/voice-manifest.txt is missing'];
  const parsed = parseVoiceManifest(manifestText);
  if (!parsed.ok) return parsed.errors.map((e) => `voice/voice-manifest.txt:${e.line} ${e.message}`);
  const problems = [...validateManifest(parsed.manifest), ...validateClaims(parsed.manifest)].map(
    (issue) => `voice/voice-manifest.txt: ${issue.message}`,
  );
  if (indexText === undefined) return [...problems, 'public/voice/index.json is missing'];
  let lines: unknown;
  try {
    lines = (JSON.parse(indexText) as { lines?: unknown }).lines;
  } catch {
    return [...problems, 'public/voice/index.json is not valid JSON'];
  }
  if (!Array.isArray(lines)) return [...problems, 'public/voice/index.json has no `lines` array'];
  const entries = new Map<string, Record<string, unknown>>();
  for (const raw of lines as unknown[]) {
    if (typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string') {
      entries.set((raw as { id: string }).id, raw as Record<string, unknown>);
    }
  }
  const manifestIds = new Set<string>();
  for (const category of Object.keys(parsed.manifest.categories) as (keyof typeof parsed.manifest.categories)[]) {
    for (const line of parsed.manifest.categories[category]) {
      manifestIds.add(line.id);
      const entry = entries.get(line.id);
      if (entry === undefined) {
        problems.push(`public/voice/index.json has no entry for ${line.id}`);
        continue;
      }
      if (entry.category !== category || entry.claims !== line.claims || entry.text !== line.text) {
        problems.push(`public/voice/index.json entry ${line.id} differs from the manifest (run npm run voice)`);
      }
    }
  }
  for (const [id, entry] of entries) {
    if (!manifestIds.has(id)) problems.push(`public/voice/index.json lists ${id}, which is not in the manifest`);
    const file = typeof entry.file === 'string' ? entry.file : `${id}.mp3`;
    if (!voiceFileExists(file)) problems.push(`voice file ${file} for ${id} is missing`);
  }
  return problems;
}

/** Requirement 30.9 (the full header rules are in tests/unit/vercel-config.test.ts). */
export function checkVercelJson(text: string | undefined): string[] {
  if (text === undefined) return ['vercel.json is missing'];
  let config: { outputDirectory?: unknown; headers?: unknown };
  try {
    config = JSON.parse(text) as typeof config;
  } catch {
    return ['vercel.json is not valid JSON'];
  }
  const problems: string[] = [];
  if (config.outputDirectory !== 'dist') problems.push('vercel.json outputDirectory is not "dist"');
  const all = Array.isArray(config.headers)
    ? (config.headers as { source?: unknown; headers?: { key?: unknown }[] }[]).find((h) => h.source === '/(.*)')
    : undefined;
  const keys = new Set((all?.headers ?? []).map((h) => h.key));
  for (const key of ['Content-Security-Policy', 'Permissions-Policy']) {
    if (!keys.has(key)) problems.push(`vercel.json has no ${key} header for every route`);
  }
  return problems;
}

/** `.uikitml` panel names the app (not the spike) refers to in code. */
export function referencedPanels(srcFiles: readonly SourceFile[]): string[] {
  const names = new Set<string>();
  for (const file of srcFiles) {
    if (file.path.startsWith('src/spike/')) continue;
    for (const m of parse(file).stripped.code.matchAll(/([a-z0-9-]+)\.uikitml\b/gu)) names.add(m[1] ?? '');
  }
  return [...names].sort();
}

/** Literal `assetUrl('...')` paths (relative to `public/`) in the app code, not the spike. */
export function assetUrlLiterals(srcFiles: readonly SourceFile[]): string[] {
  const paths = new Set<string>();
  for (const file of srcFiles) {
    if (file.path.startsWith('src/spike/')) continue;
    for (const m of parse(file).stripped.code.matchAll(/\bassetUrl\(\s*(['"])([^'"\n]+)\1\s*\)/gu)) paths.add(m[2] ?? '');
  }
  return [...paths].sort();
}

/** The value of `export const NAME = '...'` in a source file, if present. */
export function exportedString(file: SourceFile | undefined, name: string): string | undefined {
  if (file === undefined) return undefined;
  const m = new RegExp(`export const ${name}(?:\\s*:\\s*string)?\\s*=\\s*(['"])([^'"]+)\\1`, 'u').exec(file.text);
  return m?.[2];
}
