import { describe, expect, it } from 'vitest';
import {
  checkDeviceName,
  deriveAliases,
  NICKNAME_CHOICES,
  numberToWords,
  speakableName,
} from '../../src/domain/devices/naming.js';
import {
  createLexicon,
  FALLBACK_LEXICON,
  findOutOfLexicon,
  parseLexiconText,
} from '../../src/domain/speech-lang/lexicon.js';

describe('numberToWords', () => {
  it('spells common numbers', () => {
    expect(numberToWords(0)).toBe('zero');
    expect(numberToWords(2)).toBe('two');
    expect(numberToWords(13)).toBe('thirteen');
    expect(numberToWords(21)).toBe('twenty one');
    expect(numberToWords(100)).toBe('one hundred');
    expect(numberToWords(1205)).toBe('one thousand two hundred five');
  });
});

describe('speakableName', () => {
  it('lowercases, strips punctuation, and spells digits', () => {
    expect(speakableName('Lamp 2')).toBe('lamp two');
    expect(speakableName('Desk-Lamp (Left)')).toBe('desk lamp left');
    expect(speakableName('mock.bulb_1')).toBe('mock bulb one');
    expect(speakableName('Lamp12')).toBe('lamp twelve');
  });

  it('handles ordinals, decimals, symbols, and apostrophes', () => {
    expect(speakableName('2nd Lamp')).toBe('second lamp');
    expect(speakableName('21st light')).toBe('twenty first light');
    expect(speakableName('Strip 1.5')).toBe('strip one point five');
    expect(speakableName('Tom & Jerry')).toBe('tom and jerry');
    expect(speakableName("Sam's Lamp")).toBe("sam's lamp");
    expect(speakableName("'Quoted' lamp")).toBe('quoted lamp');
    expect(speakableName('Café Light')).toBe('cafe light');
  });

  it('reads leading zeros digit by digit and is total', () => {
    expect(speakableName('Light 007')).toBe('light zero zero seven');
    expect(speakableName('')).toBe('');
    expect(speakableName('!!!')).toBe('');
  });

  it('never leaves digits behind', () => {
    expect(speakableName('a1b22c333 99999999999999999999')).not.toMatch(/\d/);
  });
});

describe('deriveAliases', () => {
  it('uses the head noun', () => {
    expect(deriveAliases('desk lamp')).toEqual(['lamp']);
    expect(deriveAliases('bulb one')).toEqual(['bulb']);
    expect(deriveAliases('lamp two')).toEqual(['lamp']);
  });

  it('gives no alias for a single word or only numbers', () => {
    expect(deriveAliases('lamp')).toEqual([]);
    expect(deriveAliases('twenty one')).toEqual([]);
    expect(deriveAliases('')).toEqual([]);
  });
});

describe('lexicon', () => {
  it('matches words case-insensitively and parses text', () => {
    const lexicon = parseLexiconText('lamp\nLight\n\r\ndesk\n');
    expect(lexicon.size).toBe(3);
    expect(lexicon.has('LAMP')).toBe(true);
    expect(lexicon.has('sofa')).toBe(false);
  });

  it('lists out-of-lexicon words once, in order', () => {
    const lexicon = createLexicon(['lamp']);
    expect(findOutOfLexicon(lexicon, 'Zorp lamp  zorp blarg')).toEqual(['zorp', 'blarg']);
    expect(findOutOfLexicon(lexicon, 'lamp')).toEqual([]);
  });

  it('fallback stub knows the command words and the nickname words', () => {
    for (const word of ['turn', 'on', 'off', 'lamp', 'light', 'desk', 'ceiling', 'bedside', 'corner']) {
      expect(FALLBACK_LEXICON.has(word)).toBe(true);
    }
  });
});

describe('checkDeviceName', () => {
  it('accepts a recognisable name', () => {
    const check = checkDeviceName('Desk Lamp 2', FALLBACK_LEXICON);
    expect(check.spoken).toBe('desk lamp two');
    expect(check.aliases).toEqual(['lamp']);
    expect(check.outOfLexicon).toEqual([]);
    expect(check.needsNickname).toBe(false);
    expect(check.nicknameChoices).toEqual([]);
  });

  it('flags unknown words and offers nicknames', () => {
    const check = checkDeviceName('Zorblax Lamp', FALLBACK_LEXICON);
    expect(check.outOfLexicon).toEqual(['zorblax']);
    expect(check.needsNickname).toBe(true);
    expect(check.nicknameChoices).toEqual(NICKNAME_CHOICES);
  });

  it('does not offer a nickname that is taken or unrecognisable', () => {
    const lexicon = createLexicon(['desk', 'lamp', 'floor', 'light']);
    const check = checkDeviceName('Zorblax', lexicon, ['Desk Lamp']);
    expect(check.nicknameChoices).toEqual(['floor lamp']);
  });

  it('asks for a nickname when the name has no speakable words', () => {
    expect(checkDeviceName('???', FALLBACK_LEXICON).needsNickname).toBe(true);
  });
});
