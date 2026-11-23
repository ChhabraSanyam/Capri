import { describe, expect, it } from 'vitest';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { buildGrammar } from '../../src/domain/speech-lang/grammar-builder.js';
import { parseIntent, renderIntent, type Intent } from '../../src/domain/speech-lang/intent-parser.js';
import { createLexicon, FALLBACK_LEXICON } from '../../src/domain/speech-lang/lexicon.js';
import fc from 'fast-check';
import { buildCommandCatalog } from '../../src/domain/commands/command-catalog.js';
import { COLOR_NAMES, COLOR_RGB, normalizeText, PHRASE_TABLE } from '../../src/domain/speech-lang/phrases.js';
import { processText } from '../../src/domain/speech-lang/process-text.js';
import { resolve } from '../../src/domain/speech-lang/resolver.js';

function makeRegistry(...names: string[]): DeviceRegistry {
  let n = 0;
  const registry = new DeviceRegistry({ idFactory: () => `id-${(n += 1)}` });
  names.forEach((name, i) => {
    registry.add({ entityId: `light.${i}`, name, position: { x: i, y: 1, z: -1 } });
  });
  return registry;
}

describe('normalizeText', () => {
  it('lowercases, drops fillers and punctuation, spells digits, and keeps [unk]', () => {
    expect(normalizeText('Please, TURN off the Lamp!')).toEqual(['turn', 'off', 'lamp']);
    expect(normalizeText('set a timer for 5 minutes')).toEqual(['set', 'timer', 'for', 'five', 'minutes']);
    expect(normalizeText('[unk]')).toEqual(['[unk]']);
    expect(normalizeText('   ')).toEqual([]);
  });
});

describe('buildGrammar', () => {
  const registry = makeRegistry('desk lamp', 'floor lamp');
  const input = { devices: registry.all(), places: ['reading nook'] };

  it('always ends with [unk], has no duplicates, and serialises to a JSON array of strings', () => {
    for (const strategy of ['fragments', 'utterances'] as const) {
      const grammar = buildGrammar(input, strategy);
      expect(grammar[grammar.length - 1]).toBe('[unk]');
      expect(new Set(grammar).size).toBe(grammar.length);
      expect(JSON.parse(JSON.stringify(grammar))).toEqual(grammar);
    }
  });

  it('defaults to the fragments strategy confirmed by the spike', () => {
    expect(buildGrammar(input)).toEqual(buildGrammar(input, 'fragments'));
    expect(buildGrammar(input)).toContain('turn off');
    expect(buildGrammar(input)).toContain('that');
    expect(buildGrammar(input)).not.toContain('turn off that');
  });

  it('lists every phrase group, device names, aliases, and places', () => {
    const grammar = buildGrammar(input, 'fragments');
    for (const phrase of [
      'turn on',
      'turn off',
      'dim',
      'brighten',
      'set to',
      'red',
      'that',
      'this',
      'it',
      'that one',
      "the one i'm pointing at",
      'desk lamp',
      'floor lamp',
      'lamp',
      'come here',
      'sit on the desk',
      'look at',
      'point at',
      'remember this as',
      'set a timer for',
      'minutes',
      'go away',
      'reading nook',
      'desk',
      'hey capri',
      'tell me a joke',
      'run my evening routine',
      'ask hermes',
      'perch on the table',
      'look at me',
    ]) {
      expect(grammar, phrase).toContain(phrase);
    }
    // Property 14 for the task 33.9 phrases: also in the whole-utterance grammar, and in the lexicon.
    const utterances = buildGrammar(input, 'utterances');
    for (const phrase of ['ask hermes', 'perch on the table', 'look at me']) expect(utterances, phrase).toContain(phrase);
    const withLexicon = buildGrammar({ ...input, lexicon: FALLBACK_LEXICON }, 'fragments');
    for (const phrase of ['ask hermes', 'perch on the table', 'look at me']) expect(withLexicon, phrase).toContain(phrase);
    for (const color of COLOR_NAMES) expect(grammar).toContain(color);
  });

  it('offers the single words for the split order "turn that off" (Requirement 15.25)', () => {
    const grammar = buildGrammar(input, 'fragments');
    for (const word of ['turn', 'switch', 'on', 'off', 'turn on', 'turn off', '[unk]']) {
      expect(grammar, word).toContain(word);
    }
    const utterances = buildGrammar(input, 'utterances');
    for (const phrase of ['turn that off', 'turn it on', 'switch this off', 'turn desk lamp off']) {
      expect(utterances, phrase).toContain(phrase);
    }
  });

  it('expands whole commands with the utterances strategy', () => {
    const grammar = buildGrammar(input, 'utterances');
    expect(grammar).toContain('turn off that');
    expect(grammar).toContain('turn on desk lamp');
    expect(grammar).toContain('set to blue floor lamp');
    expect(grammar).toContain('set a timer for sixty minutes');
    expect(grammar).toContain('set a timer for one minute');
    expect(grammar).toContain('remember this as reading nook');
  });

  it('every whole utterance parses to a non-repeat, non-unknown intent', () => {
    const ctx = { registry, places: ['reading nook'] };
    for (const phrase of buildGrammar(input, 'utterances')) {
      if (phrase === '[unk]') continue;
      const intent = parseIntent(phrase, ctx);
      expect(['repeat', 'unknown'], phrase).not.toContain(intent.type);
    }
  });

  it('drops phrases with words outside the lexicon', () => {
    const lexicon = createLexicon(['turn', 'on', 'off', 'lamp', 'that']);
    const grammar = buildGrammar({ devices: registry.all(), places: [], lexicon }, 'fragments');
    expect(grammar).toContain('turn on');
    expect(grammar).toContain('lamp');
    expect(grammar).not.toContain('desk lamp');
    expect(grammar).not.toContain('come here');
    expect(grammar).toContain('[unk]');
  });
});

describe('parseIntent', () => {
  const registry = makeRegistry('desk lamp', 'floor lamp', 'strip');
  const ctx = { registry, places: ['reading nook'] };
  const ids = (name: string): string[] => registry.all().filter((d) => d.name === name).map((d) => d.id);

  it('parses light verbs with deictic, implicit, and named targets', () => {
    expect(parseIntent('turn off that', ctx)).toEqual({ type: 'device', verb: 'turn_off', target: { kind: 'deictic' } });
    expect(parseIntent('Turn on', ctx)).toEqual({ type: 'device', verb: 'turn_on', target: { kind: 'deictic' } });
    expect(parseIntent("dim the one I'm pointing at", ctx)).toEqual({
      type: 'device',
      verb: 'dim',
      target: { kind: 'deictic' },
    });
    expect(parseIntent('brighten the strip', ctx)).toEqual({
      type: 'device',
      verb: 'brighten',
      target: { kind: 'named', spoken: 'strip', candidates: ids('strip') },
    });
  });

  it('collects every candidate for a shared alias, sorted by id', () => {
    const intent = parseIntent('turn on lamp', ctx);
    expect(intent).toEqual({
      type: 'device',
      verb: 'turn_on',
      target: { kind: 'named', spoken: 'lamp', candidates: ['id-1', 'id-2'] },
    });
    const reversed = new DeviceRegistry({ initial: [...registry.all()].reverse() });
    expect(parseIntent('turn on lamp', { registry: reversed })).toEqual(intent);
  });

  it('keeps an unregistered name as a named target with no candidates', () => {
    expect(parseIntent('turn on kitchen light', ctx)).toEqual({
      type: 'device',
      verb: 'turn_on',
      target: { kind: 'named', spoken: 'kitchen light', candidates: [] },
    });
  });

  it('parses colours in the spoken and typed word orders', () => {
    const want: Intent = { type: 'device', verb: 'set_color', target: { kind: 'deictic' }, color: 'red' };
    expect(parseIntent('set to red', ctx)).toEqual(want);
    expect(parseIntent('set to red that', ctx)).toEqual(want);
    expect(parseIntent('set that to red', ctx)).toEqual(want);
    expect(parseIntent('set the strip to blue', ctx)).toMatchObject({ verb: 'set_color', color: 'blue' });
    expect(parseIntent('set to plaid', ctx).type).toBe('unknown');
  });

  it('accepts typed "turn <target> on|off"', () => {
    expect(parseIntent('turn the desk lamp off', ctx)).toMatchObject({ verb: 'turn_off', target: { kind: 'named' } });
    expect(parseIntent('turn it on', ctx)).toMatchObject({ verb: 'turn_on', target: { kind: 'deictic' } });
  });

  it('parses avatar abilities', () => {
    expect(parseIntent('come here', ctx)).toEqual({ type: 'avatar', ability: 'come_here' });
    expect(parseIntent('go away', ctx)).toEqual({ type: 'avatar', ability: 'go_away' });
    expect(parseIntent('sit on the desk', ctx)).toEqual({ type: 'avatar', ability: 'sit_on', surface: 'desk' });
    expect(parseIntent('look at that', ctx)).toEqual({
      type: 'avatar',
      ability: 'look_at',
      target: { kind: 'deictic' },
    });
    expect(parseIntent('point at the strip', ctx)).toMatchObject({ ability: 'point_at', target: { kind: 'named' } });
    expect(parseIntent('look at the shelf', ctx)).toEqual({
      type: 'avatar',
      ability: 'look_at',
      target: { kind: 'place', name: 'shelf' },
    });
    expect(parseIntent('point at reading nook', ctx)).toMatchObject({ target: { kind: 'place', name: 'reading nook' } });
    expect(parseIntent('remember this as shelf', ctx)).toEqual({
      type: 'avatar',
      ability: 'remember_place',
      name: 'shelf',
    });
  });

  it('parses timers, including one minute in either form and digits', () => {
    expect(parseIntent('set a timer for five minutes', ctx)).toMatchObject({ ability: 'set_timer', minutes: 5 });
    expect(parseIntent('set a timer for twenty one minutes', ctx)).toMatchObject({ minutes: 21 });
    expect(parseIntent('set a timer for one minutes', ctx)).toMatchObject({ minutes: 1 });
    expect(parseIntent('set a timer for a minute', ctx)).toMatchObject({ minutes: 1 });
    expect(parseIntent('set a timer for 12 minutes', ctx)).toMatchObject({ minutes: 12 });
    expect(parseIntent('set a timer for lots', ctx).type).toBe('unknown');
  });

  it('parses confirm, chat, task phrases, and strips the wake phrase before a command', () => {
    expect(parseIntent('that one', ctx)).toEqual({ type: 'confirm_pointed' });
    expect(parseIntent('Hello', ctx)).toEqual({ type: 'chat', phrase: 'hello' });
    expect(parseIntent('hey capri', ctx)).toEqual({ type: 'chat', phrase: 'hey capri' });
    expect(parseIntent('run my evening routine', ctx)).toMatchObject({ type: 'task', kind: 'routine' });
    expect(parseIntent('hey capri turn off that', ctx)).toMatchObject({ type: 'device', verb: 'turn_off' });
  });

  it('parses "ask hermes", "perch on the table", and "look at me" (task 33.9)', () => {
    expect(parseIntent('ask hermes', ctx)).toEqual({ type: 'hermes_prompt', mode: 'ask' });
    expect(parseIntent('Ask Hermes.', ctx)).toEqual({ type: 'hermes_prompt', mode: 'ask' });
    expect(parseIntent('hey capri ask hermes', ctx)).toEqual({ type: 'hermes_prompt', mode: 'ask' });
    expect(parseIntent('perch on the table', ctx)).toEqual({ type: 'avatar', ability: 'perch_on', surface: 'table' });
    expect(parseIntent('look at me', ctx)).toEqual({ type: 'avatar', ability: 'look_at_me' });
    expect(processText('ask hermes', ctx).action).toEqual({ type: 'resolved', command: { kind: 'hermes_prompt', mode: 'ask' } });
    expect(processText('perch on the table', ctx).action).toEqual({
      type: 'resolved',
      command: { kind: 'navigate', request: { type: 'perch', surface: 'table' } },
    });
    expect(processText('look at me', ctx).action).toEqual({ type: 'resolved', command: { kind: 'look_user' } });
  });

  it('keeps the low-confidence rule for "ask hermes" mixed with another command (task 33.9)', () => {
    for (const text of ['ask hermes turn off', 'turn on ask hermes', 'ask hermes ask hermes', 'come here ask hermes']) {
      expect(parseIntent(text, ctx), text).toEqual({ type: 'repeat' });
    }
    // One fragment with free words is typed chat, not garble.
    expect(parseIntent('ask hermes about the weather', ctx).type).toBe('unknown');
  });

  it('returns unknown for free text', () => {
    expect(parseIntent('what is the weather like', ctx)).toEqual({ type: 'unknown', text: 'what is weather like' });
  });

  it('is deterministic and round-trips its own rendering', () => {
    for (const text of [
      'turn off that',
      'turn on desk lamp',
      'set to green that',
      'dim strip',
      'sit on the table',
      'look at the shelf',
      'point at that',
      'remember this as reading nook',
      'set a timer for seven minutes',
      'set a timer for one minute',
      'come here',
      'that one',
      'tell me a joke',
      'ask hermes',
      'perch on the table',
      'look at me',
    ]) {
      const intent = parseIntent(text, ctx);
      expect(parseIntent(text, ctx)).toEqual(intent);
      expect(parseIntent(renderIntent(intent), ctx), text).toEqual(intent);
    }
  });
});

describe('split verb order (Requirement 15.25)', () => {
  const registry = makeRegistry('desk lamp');
  const ctx = { registry, pointed: 'id-1' };

  it.each([
    ['turn that off', 'turn off that'],
    ['turn that on', 'turn on that'],
    ['turn it off', 'turn off it'],
    ['turn it on', 'turn on it'],
    ['turn this off', 'turn off this'],
    ['turn this on', 'turn on this'],
    ['switch that off', 'turn off that'],
    ['switch that on', 'turn on that'],
    ['turn that one off', 'turn off that one'],
    ['turn the desk lamp off', 'turn off the desk lamp'],
  ])('"%s" gives the same intent and action as "%s"', (split, joined) => {
    const want = parseIntent(joined, ctx);
    expect(want.type).toBe('device');
    expect(parseIntent(split, ctx)).toEqual(want);
    expect(processText(split, ctx)).toEqual(processText(joined, ctx));
  });

  it('resolves the split deictic form to the Pointed_Device', () => {
    expect(processText('turn that off', ctx).action).toMatchObject({
      type: 'resolved',
      command: { kind: 'light', device: { id: 'id-1' }, command: { kind: 'off' } },
    });
    expect(processText('switch it on', ctx).action).toMatchObject({ command: { command: { kind: 'on' } } });
  });

  it('keeps every joined form parsing as before', () => {
    for (const [text, verb] of [
      ['turn on that', 'turn_on'],
      ['turn off that', 'turn_off'],
      ['turn on it', 'turn_on'],
      ['turn off this', 'turn_off'],
      ['turn on', 'turn_on'],
      ['turn off', 'turn_off'],
    ] as const) {
      expect(parseIntent(text, ctx), text).toEqual({ type: 'device', verb, target: { kind: 'deictic' } });
    }
  });

  it('never runs a device action for a bare particle, a verb with no particle, or split garble', () => {
    for (const text of ['on', 'off', 'turn', 'switch', 'turn that', 'switch it', 'that off', 'turn on that off', 'turn that on off']) {
      expect(parseIntent(text, ctx).type, text).not.toBe('device');
      expect(processText(text, ctx).action.type, text).not.toBe('resolved');
    }
  });

  it('treats repeated split commands as low confidence', () => {
    for (const text of ['turn that off turn that on', 'turn on turn that off', 'switch that off turn it off']) {
      expect(parseIntent(text, ctx), text).toEqual({ type: 'repeat' });
    }
  });
});

describe('low-confidence rule (Requirement 15.24)', () => {
  const registry = makeRegistry('desk lamp');
  const ctx = { registry, pointed: 'id-1' };

  it.each([
    'turn on turn off',
    'turn off turn on',
    'turn on turn on',
    'turn off turn off',
    'come here turn off',
    'turn on go away',
    'turn off that turn off',
    'that one turn on',
    'dim brighten',
    'turn on that one that one',
  ])('"%s" asks the user to repeat and never acts', (text) => {
    expect(parseIntent(text, ctx)).toEqual({ type: 'repeat' });
    expect(processText(text, ctx).action).toEqual({ type: 'repeat' });
  });

  it('treats empty, [unk], and [unk] mixed with words as repeat', () => {
    for (const text of ['', '   ', '[unk]', '[unk] [unk]', 'turn on [unk]', '[unk] turn off that']) {
      expect(parseIntent(text, ctx), text).toEqual({ type: 'repeat' });
    }
  });

  it('does not flag a single clean command or a device name that holds a fragment word', () => {
    expect(parseIntent('turn off that', ctx).type).toBe('device');
    const dim = makeRegistry('dim light');
    expect(parseIntent('turn on dim light', { registry: dim })).toMatchObject({
      type: 'device',
      verb: 'turn_on',
      target: { kind: 'named', candidates: ['id-1'] },
    });
  });
});

describe('resolve', () => {
  const registry = makeRegistry('desk lamp', 'floor lamp', 'strip');
  const [desk, floor, strip] = registry.all();

  it('maps dim, brighten, on, off to fixed commands', () => {
    const ctx = { registry, pointed: strip!.id };
    expect(processText('dim', ctx).action).toEqual({
      type: 'resolved',
      command: { kind: 'light', device: strip, command: { kind: 'brightness', pct: 30 } },
    });
    expect(processText('brighten that', ctx).action).toMatchObject({
      command: { command: { kind: 'brightness', pct: 100 } },
    });
    expect(processText('turn on that', ctx).action).toMatchObject({ command: { command: { kind: 'on' } } });
    expect(processText('turn off strip', { registry }).action).toMatchObject({
      command: { device: strip, command: { kind: 'off' } },
    });
  });

  it('maps every colour name to its table value', () => {
    for (const name of COLOR_NAMES) {
      const out = processText(`set to ${name}`, { registry, pointed: desk!.id }).action;
      expect(out).toMatchObject({ command: { command: { kind: 'color', rgb: COLOR_RGB.get(name), name } } });
    }
  });

  it('resolves a deictic to the selected device, else the pointed one', () => {
    const both = { registry, pointed: desk!.id, selected: floor!.id };
    expect(processText('turn on that', both).action).toMatchObject({ command: { device: floor } });
    expect(processText('turn on that', { registry, pointed: desk!.id }).action).toMatchObject({
      command: { device: desk },
    });
  });

  it('asks which device when nothing is pointed or the pointed id is stale', () => {
    for (const ctx of [{ registry }, { registry, pointed: 'gone' }]) {
      const out = processText('turn off that', ctx);
      expect(out.action).toEqual({ type: 'clarify', reason: 'no_pointed', candidates: [], intent: out.intent });
    }
    expect(processText('that one', { registry }).action).toMatchObject({ type: 'clarify', reason: 'no_pointed' });
    expect(processText('look at that', { registry }).action).toMatchObject({ type: 'clarify', reason: 'no_pointed' });
  });

  it('confirms the pointed device for "that one"', () => {
    expect(processText('that one', { registry, pointed: strip!.id }).action).toEqual({
      type: 'resolved',
      command: { kind: 'confirm_pointed', device: strip },
    });
  });

  it('lists exactly the matching devices when a name is ambiguous', () => {
    const out = processText('turn on lamp', { registry });
    expect(out.action).toMatchObject({ type: 'clarify', reason: 'ambiguous' });
    if (out.action.type === 'clarify') expect(out.action.candidates).toEqual([desk, floor]);
  });

  it('reports an unknown device, bad timer, and unrecognised text as unsupported', () => {
    expect(processText('turn on kitchen light', { registry }).action).toEqual({
      type: 'unsupported',
      reason: 'unknown_device',
      text: 'kitchen light',
    });
    expect(processText('set a timer for ninety minutes', { registry }).action).toMatchObject({
      type: 'unsupported',
      reason: 'bad_timer',
    });
    expect(processText('set a timer for zero minutes', { registry }).action).toMatchObject({ reason: 'bad_timer' });
    expect(processText('book me a flight', { registry }).action).toEqual({
      type: 'unsupported',
      reason: 'unrecognised',
      text: 'book me flight',
    });
  });

  it('resolves avatar abilities', () => {
    const ctx = { registry, pointed: desk!.id, places: ['reading nook'] };
    expect(processText('come here', ctx).action).toEqual({
      type: 'resolved',
      command: { kind: 'navigate', request: { type: 'come_here' } },
    });
    expect(processText('sit on the couch', ctx).action).toMatchObject({
      command: { request: { type: 'sit_on', surface: 'couch' } },
    });
    expect(processText('look at that', ctx).action).toMatchObject({
      command: { kind: 'look_at', target: { kind: 'device', device: desk } },
    });
    expect(processText('point at reading nook', ctx).action).toMatchObject({
      command: { kind: 'point_at', target: { kind: 'place', name: 'reading nook' } },
    });
    expect(processText('set a timer for ten minutes', ctx).action).toEqual({
      type: 'resolved',
      command: { kind: 'set_timer', minutes: 10 },
    });
    expect(processText('run my evening routine', ctx).action).toMatchObject({
      command: { kind: 'task', taskKind: 'routine' },
    });
  });

  it('resolve is total over every parsed intent kind', () => {
    const ctx = { registry };
    for (const intent of [{ type: 'repeat' }, { type: 'unknown', text: 'x' }, { type: 'chat', phrase: 'hello' }] as const) {
      expect(resolve(intent, ctx).type).toMatch(/resolved|repeat|unsupported/);
    }
  });
});

describe('System_Keyboard, Commands_Tile, and speech parity (Requirements 15.12, 33.51, 33.53)', () => {
  const registry = makeRegistry('desk lamp');
  const ctx = { registry, pointed: 'id-1' };

  // Feature: capri-spatial-companion, Property 18: Keyboard and speech paths are equivalent
  // **Validates: Requirements 15.12, 33.53**
  it('Property 18: System_Keyboard text resolves to the same action as the same text heard', () => {
    // Speech and the System_Keyboard share `processText`, so a typed line can differ from the heard one
    // only by case, punctuation, extra spaces, fillers, and digits for number words.
    const spoken = buildGrammar({ devices: registry.all(), places: [] }, 'utterances').filter((p) => p !== '[unk]');
    const typed = (text: string, upper: boolean[], punct: string, pad: string): string =>
      `${pad}${text
        .split(' ')
        .map((w, i) => (upper[i % upper.length] === true ? w.toUpperCase() : w))
        .join('  ')}${punct}`;
    fc.assert(
      fc.property(
        fc.constantFrom(...spoken),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
        fc.constantFrom('', '.', '!', '?', ','),
        fc.constantFrom('', ' ', 'please '),
        (text, upper, punct, pad) => {
          expect(processText(typed(text, upper, punct, pad), ctx)).toEqual(processText(text, ctx));
        },
      ),
      { numRuns: 100 },
    );
    expect(processText('Turn off that.', ctx)).toEqual(processText('turn off that', ctx));
    expect(processText('set a timer for 5 minutes', ctx)).toEqual(processText('set a timer for five minutes', ctx));
  });

  it('every tappable Commands row runs through processText like its spoken phrase', () => {
    for (const row of buildCommandCatalog(PHRASE_TABLE, registry.all())) {
      if (row.runText === undefined) continue;
      expect(processText(row.runText, ctx), row.id).toEqual(processText(row.say, ctx));
    }
  });

  it('deictic rows act on the pointed light and ask when nothing is pointed', () => {
    expect(processText('dim that', ctx).action).toMatchObject({ command: { command: { kind: 'brightness', pct: 30 } } });
    expect(processText('turn that on', { registry }).action).toMatchObject({ type: 'clarify', reason: 'no_pointed' });
  });

  it('typed free-form names and chat work through the same path', () => {
    expect(processText('remember this as my reading nook', ctx).action).toMatchObject({
      command: { kind: 'remember_place', name: 'my reading nook' },
    });
    expect(processText('tell me a joke', ctx).action).toMatchObject({ command: { kind: 'chat' } });
  });
});
