import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import vercelJson from '../../vercel.json?raw';

/** Requirements 30.3, 30.9, 30.11, 30.12, 30.15: the deploy configuration is part of the product. */
interface HeaderEntry {
  source: string;
  headers: { key: string; value: string }[];
}
interface VercelConfig {
  installCommand: string;
  buildCommand: string;
  outputDirectory: string;
  rewrites: { source: string; destination: string }[];
  headers: HeaderEntry[];
}

const config = JSON.parse(vercelJson) as VercelConfig;

function header(source: string, key: string): string {
  const entry = config.headers.find((h) => h.source === source);
  const value = entry?.headers.find((h) => h.key === key)?.value;
  if (value === undefined) throw new Error(`vercel.json has no ${key} header for ${source}`);
  return value;
}

function directive(csp: string, name: string): string[] {
  const part = csp
    .split(';')
    .map((p) => p.trim())
    .find((p) => p === name || p.startsWith(`${name} `));
  if (part === undefined) throw new Error(`CSP has no ${name} directive`);
  return part.split(/\s+/u).slice(1);
}

describe('vercel.json', () => {
  const csp = header('/(.*)', 'Content-Security-Policy');

  it('builds a static Vite app into dist with npm ci and the build:vercel script', () => {
    expect(config.outputDirectory).toBe('dist');
    expect(config.installCommand).toBe('npm ci');
    expect(config.buildCommand).toBe('npm run build:vercel');
  });

  it('build:vercel runs typecheck, tests, the model fetch, the lexicon build, vite build, then the checks, in that order', () => {
    const script = (pkg.scripts as Record<string, string>)['build:vercel'] ?? '';
    const steps = [
      'npm run typecheck',
      'npm test',
      'npm run fetch:vosk',
      'npm run build:lexicon',
      'vite build',
      'npm run check',
    ];
    const positions = steps.map((s) => script.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The smoke checks read dist/, so they must be the last step, and every step is chained with &&
    // so a failing check fails the deployment (Requirements 30.4, 30.9).
    expect(script.endsWith('npm run check')).toBe(true);
    expect(script.split(' && ')).toHaveLength(steps.length);
    expect(script).not.toContain(';');
    expect(script).not.toContain('||');
  });

  it('npm run check runs lint and the smoke checks, and esbuild is a direct dev dependency', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.check).toBe('npm run lint && npm run check:smoke');
    expect(scripts['check:smoke']).toMatch(/^esbuild tools\/checks\/run-checks\.ts .* && node /u);
    // check:smoke calls the esbuild binary, so `npm ci` on Vercel must install it directly, not only
    // as a transitive dependency of vite.
    expect((pkg.devDependencies as Record<string, string>).esbuild).toBeDefined();
  });

  it('allows https: and wss: connections but not http: or ws:', () => {
    const connect = directive(csp, 'connect-src');
    expect(connect).toEqual(expect.arrayContaining(["'self'", 'https:', 'wss:', 'blob:']));
    expect(connect).not.toContain('http:');
    expect(connect).not.toContain('ws:');
    expect(csp).not.toMatch(/(^|[\s;])(http|ws):/u);
  });

  it('allows what vosk-browser needs: blob workers, WASM compilation, and the worker\'s eval and data: fetch', () => {
    expect(directive(csp, 'worker-src')).toEqual(expect.arrayContaining(["'self'", 'blob:']));
    const script = directive(csp, 'script-src');
    expect(script).toEqual(expect.arrayContaining(["'self'", "'wasm-unsafe-eval'"]));
    // The Vosk worker (an inline blob worker that inherits this policy) calls `new Function` for its
    // Emscripten error classes, and fetches its WASM from a data: URI. Both were found as CSP
    // violations in the production build (docs/hosting.md), so removing either breaks the voice model.
    expect(script).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('data:');
    // Everything else stays closed: no inline scripts, no remote script hosts.
    expect(script).not.toContain("'unsafe-inline'");
    expect(script.filter((source) => source.includes(':') && source !== 'blob:')).toEqual([]);
  });

  it('keeps the injection-hardening directives', () => {
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'self'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
  });

  it('grants microphone and xr-spatial-tracking to the page origin only', () => {
    const policy = header('/(.*)', 'Permissions-Policy');
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('xr-spatial-tracking=(self)');
    expect(policy).not.toMatch(/(microphone|xr-spatial-tracking)=\(\*\)/u);
  });

  it('sets the other security headers on every route', () => {
    expect(header('/(.*)', 'X-Content-Type-Options')).toBe('nosniff');
    expect(header('/(.*)', 'Referrer-Policy')).toBe('no-referrer');
    expect(header('/(.*)', 'Strict-Transport-Security')).toContain('max-age=');
  });

  it('serves /vosk/ and /assets/ with a long-lived immutable Cache-Control', () => {
    const immutable = 'public, max-age=31536000, immutable';
    expect(header('/vosk/(.*)', 'Cache-Control')).toBe(immutable);
    expect(header('/assets/(.*)', 'Cache-Control')).toBe(immutable);
  });

  it('gives /voice/ a long max-age without immutable (file names are not content-hashed)', () => {
    const value = header('/voice/(.*)', 'Cache-Control');
    expect(value).toMatch(/max-age=\d{6,}/u);
    expect(value).not.toContain('immutable');
  });

  describe('SPA rewrite', () => {
    const rewrite = config.rewrites[0];
    const matches = (path: string): boolean => new RegExp(`^${rewrite?.source ?? ''}$`, 'u').test(path);

    it('is a single rule that sends extensionless paths to /index.html', () => {
      expect(config.rewrites).toHaveLength(1);
      expect(rewrite?.destination).toBe('/index.html');
      for (const path of ['/', '/setup', '/some/deep/route']) expect(matches(path)).toBe(true);
    });

    it('leaves paths with a file extension alone, so a missing file stays a 404', () => {
      for (const path of [
        '/spike.html',
        '/assets/index-abc123.js',
        '/voice/missing_99.mp3',
        '/vosk/vosk-model-small-en-us-0.15.tar.gz',
        '/models/capri.vrm',
        '/ui/quick-actions.uikitml',
      ]) {
        expect(matches(path)).toBe(false);
      }
    });
  });
});
