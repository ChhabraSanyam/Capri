import tseslint from 'typescript-eslint';

// Domain purity rule (design: "Pure, testable core"; Requirement 17.1).
// Everything under src/domain/ is plain TypeScript that runs in Node under Vitest.
// It must not import Three.js, IWSDK, three-vrm, or vosk-browser, and must not touch
// the browser globals `window` or `document`. Adapters in other folders implement
// ports that the domain defines.
const RESTRICTED_MODULES = ['three', 'three/*', '@iwsdk/*', '@pixiv/*', 'vosk-browser'];
const RESTRICTED_MESSAGE =
  'src/domain/** is pure: it must not import three, @iwsdk/*, @pixiv/*, or vosk-browser. ' +
  'Define a port in the domain and implement it in an adapter outside src/domain/.';

// esquery ends a regex literal at the first "/", so the slash is written as \x2f.
const MODULE_REGEX = '^(three($|\\x2f)|@iwsdk\\x2f|@pixiv\\x2f|vosk-browser($|\\x2f))';

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-preflight/**', 'node_modules/**', '.iwsdk/**', '.tmp/**', 'public/**'],
  },
  {
    files: ['src/domain/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: 'module' },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: RESTRICTED_MODULES, message: RESTRICTED_MESSAGE }],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'src/domain/** is pure: it must not use window. Inject what you need through a port.',
        },
        {
          name: 'document',
          message: 'src/domain/** is pure: it must not use document. Inject what you need through a port.',
        },
      ],
      // Dynamic import() and require() bypass no-restricted-imports, so ban them by shape.
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression[source.value=/${MODULE_REGEX}/]`,
          message: RESTRICTED_MESSAGE,
        },
        {
          selector: `CallExpression[callee.name='require'][arguments.0.value=/${MODULE_REGEX}/]`,
          message: RESTRICTED_MESSAGE,
        },
      ],
    },
  },
);
