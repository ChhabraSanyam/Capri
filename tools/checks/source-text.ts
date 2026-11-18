/**
 * TypeScript source helpers for the smoke checks (task 27.4). Dev-time only, never bundled.
 *
 * `stripSource` blanks comments, and separately the contents of string, template, and regex
 * literals, so a rule can ask "does the code use `window`" without matching a comment or a word
 * inside a string. Newlines are kept, so offsets still map to the same line numbers.
 */

export interface StrippedSource {
  /** Comments replaced by spaces. String, template, and regex literals are kept. */
  readonly code: string;
  /** Comments and the contents of every literal replaced by spaces. The quotes stay. */
  readonly bare: string;
}

/** Words after which a `/` starts a regex literal rather than a division. */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'case', 'do', 'else', 'in', 'of', 'void', 'yield', 'await', 'delete', 'new', 'throw',
]);

const WORD_CHAR = /[A-Za-z0-9_$]/u;

export function stripSource(text: string): StrippedSource {
  const code: string[] = [];
  const bare: string[] = [];
  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ');
  const keep = (ch: string): void => {
    code.push(ch);
    bare.push(ch);
  };
  const comment = (ch: string): void => {
    code.push(blank(ch));
    bare.push(blank(ch));
  };
  const literal = (ch: string): void => {
    code.push(ch);
    bare.push(blank(ch));
  };

  // One counter per open `${`: the depth of plain `{` inside that substitution.
  const braces: number[] = [];
  // The last significant code character. '"' stands for "the end of a literal" (a value).
  let last = '';
  let word = '';
  let mode: 'code' | 'template' = 'code';
  let i = 0;
  const n = text.length;

  const regexAllowed = (): boolean => {
    if (last === '') return true;
    if (WORD_CHAR.test(last)) return REGEX_KEYWORDS.has(word);
    return !['"', ')', ']', '}'].includes(last);
  };

  while (i < n) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';

    if (mode === 'template') {
      if (ch === '\\') {
        literal(ch);
        if (i + 1 < n) literal(next);
        i += 2;
      } else if (ch === '`') {
        keep(ch);
        i += 1;
        mode = 'code';
        last = '"';
        word = '';
      } else if (ch === '$' && next === '{') {
        keep(ch);
        keep(next);
        i += 2;
        braces.push(0);
        mode = 'code';
        last = '{';
        word = '';
      } else {
        literal(ch);
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < n && text[i] !== '\n') {
        comment(text[i] ?? '');
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      comment(ch);
      comment(next);
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        comment(text[i] ?? '');
        i += 1;
      }
      if (i < n) {
        comment('*');
        comment('/');
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      keep(ch);
      i += 1;
      while (i < n && text[i] !== ch && text[i] !== '\n') {
        if (text[i] === '\\' && i + 1 < n) {
          literal('\\');
          i += 1;
        }
        literal(text[i] ?? '');
        i += 1;
      }
      if (i < n && text[i] === ch) {
        keep(ch);
        i += 1;
      }
      last = '"';
      word = '';
      continue;
    }
    if (ch === '`') {
      keep(ch);
      i += 1;
      mode = 'template';
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      keep(ch);
      i += 1;
      let inClass = false;
      while (i < n && text[i] !== '\n') {
        const c = text[i] ?? '';
        if (c === '\\' && i + 1 < n) {
          literal(c);
          literal(text[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        literal(c);
        i += 1;
      }
      if (i < n && text[i] === '/') {
        keep('/');
        i += 1;
      }
      last = '"';
      word = '';
      continue;
    }

    if (ch === '{' && braces.length > 0) braces[braces.length - 1] = (braces[braces.length - 1] ?? 0) + 1;
    if (ch === '}' && braces.length > 0) {
      const depth = braces[braces.length - 1] ?? 0;
      if (depth === 0) {
        braces.pop();
        keep(ch);
        i += 1;
        mode = 'template';
        continue;
      }
      braces[braces.length - 1] = depth - 1;
    }

    keep(ch);
    if (WORD_CHAR.test(ch)) {
      word = (WORD_CHAR.test(text[i - 1] ?? '') ? word : '') + ch;
      last = ch;
    } else if (!/\s/u.test(ch)) {
      last = ch;
      word = '';
    }
    i += 1;
  }

  return { code: code.join(''), bare: bare.join('') };
}

export interface ImportRef {
  readonly specifier: string;
  /** `import type ... from` or `export type ... from`: erased at build time. */
  readonly typeOnly: boolean;
}

/**
 * Module specifiers of the static, side-effect, and dynamic imports, re-exports, and `require`
 * calls in comment-stripped code (`StrippedSource.code`).
 */
export function importSpecifiers(code: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\b([^;'"`]*?)\bfrom\s*(['"])([^'"\n]+)\2/gu)) {
    refs.push({ specifier: m[3] ?? '', typeOnly: /^\s*type\b/u.test(m[1] ?? '') });
  }
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"\n]+)\1/gu)) refs.push({ specifier: m[2] ?? '', typeOnly: false });
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1\s*\)/gu)) {
    refs.push({ specifier: m[2] ?? '', typeOnly: false });
  }
  return refs;
}

/** 1-based line number of `offset` in `text`. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}
