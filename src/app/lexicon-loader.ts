/**
 * Loads the generated speech lexicon (task 9.8, Requirements 12.8, 14.5). `npm run build:lexicon`
 * writes `public/vosk/lexicon.txt` (about 150,000 words from the Vosk model). The teach flow needs a
 * lexicon at once, so `createLazyLexicon` starts on `FALLBACK_LEXICON` and switches to the generated
 * list when it has loaded. If the file is missing, unreadable, or not a word list, the fallback stays.
 *
 * The check for "not a word list" matters because Vite's dev server answers an unknown path with
 * `index.html` and status 200.
 */
import { assetUrl } from '../config/asset-url.js';
import { FALLBACK_LEXICON, parseLexiconText, type Lexicon } from '../domain/speech-lang/lexicon.js';
import type { Logger } from './logger.js';

export const LEXICON_URL = assetUrl('vosk/lexicon.txt');

/** The generated list has about 150,000 words. Anything far smaller is not it. */
export const MIN_GENERATED_LEXICON_WORDS = 5000;

export type TextFetcher = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

/** Fetch and parse the generated list. `undefined` when it cannot be used. */
export async function loadGeneratedLexicon(
  fetcher: TextFetcher = (url) => fetch(url),
  url: string = LEXICON_URL,
): Promise<Lexicon | undefined> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return undefined;
    const lexicon = parseLexiconText(await response.text());
    return lexicon.size >= MIN_GENERATED_LEXICON_WORDS ? lexicon : undefined;
  } catch {
    return undefined;
  }
}

export interface LazyLexicon extends Lexicon {
  /** True once the generated list replaced the fallback. */
  readonly generated: boolean;
}

/** A lexicon that answers from the fallback until `loadGeneratedLexicon` succeeds. */
export function createLazyLexicon(logger?: Logger, fetcher?: TextFetcher): LazyLexicon {
  let current: Lexicon = FALLBACK_LEXICON;
  let generated = false;
  void loadGeneratedLexicon(fetcher).then((loaded) => {
    if (loaded === undefined) {
      logger?.warn('speech lexicon: using the built-in fallback list (public/vosk/lexicon.txt did not load)');
      return;
    }
    current = loaded;
    generated = true;
    logger?.info(`speech lexicon: loaded ${loaded.size} words`);
  });
  return {
    has: (word) => current.has(word),
    get size() {
      return current.size;
    },
    get generated() {
      return generated;
    },
  };
}
