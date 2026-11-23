/**
 * Banter templates (task 13.7, Requirements 17.8, 22.1, 22.2, 22.4). Each context kind has 3 to 6
 * `templates`. A template may hold slots such as `{device}`. Some contexts also name a Voice_Library
 * pool: when the manifest has those lines, the Banter engine plays a library line (tier 1 audio)
 * and the templates are only the fallback.
 *
 * Tone: playful, teasing, confident hacker-girl who "jacks into" the house. Light slang, never
 * mean. Every template is at most two short sentences. Templates with claim `ack` or `neutral`
 * never use completion wording, and only `done` templates say a job is finished.
 *
 * A slot value that already carries an article ("the table") is filled as is, so templates add no
 * article before `{surface}`.
 */
import type { VoiceCategory, VoiceClaims } from '../speech/voice-manifest.js';
import type { Emotion, GestureId } from '../animation-types.js';

export type SlotName = 'device' | 'count' | 'surface' | 'minutes' | 'list' | 'label' | 'pct' | 'color' | 'min' | 'max';
export type Slots = Partial<Record<SlotName, string>>;

/** Used when a template needs a slot the caller did not fill, so no `{slot}` ever reaches the user. */
export const SLOT_DEFAULTS: Readonly<Record<SlotName, string>> = {
  device: 'light',
  count: 'a few',
  surface: 'that spot',
  minutes: 'a while',
  list: 'one of those',
  label: 'that',
  pct: 'some',
  color: 'a new colour',
  min: '1',
  max: '60',
};

export interface Template {
  readonly id: string;
  readonly text: string;
  readonly claims: VoiceClaims;
}

export interface LibraryPool {
  readonly category: VoiceCategory;
  /** Restrict the pool to these manifest line ids. All lines of the category when absent. */
  readonly ids?: readonly string[];
}

export interface BanterContext {
  /** Dynamic lines. Three to six, or none for a context that only exists as a library line. */
  readonly templates: readonly Template[];
  /** Voice_Library lines used first when the manifest has them. */
  readonly library?: readonly LibraryPool[];
  readonly gesture?: GestureId;
  readonly emotion?: Emotion;
}

export type BanterKind =
  | 'greeting'
  | 'idle_ignored'
  | 'toggle_repeat'
  | 'timer_done'
  | 'timer_reminder'
  | 'timer_set'
  | 'place_remembered'
  | 'place_failed'
  | 'surface_not_found'
  | 'surface_unsuitable'
  | 'hermes_unavailable'
  | 'hermes_not_connected'
  | 'unsupported'
  | 'unknown_device'
  | 'bad_timer'
  | 'bad_color'
  | 'ask_which'
  | 'ask_pointed'
  | 'ask_repeat'
  | 'pending_light'
  | 'pending_task'
  | 'approval_requested'
  | 'success_light'
  | 'success_task'
  | 'failure'
  | 'status_on'
  | 'status_off'
  | 'status_brightness'
  | 'status_color'
  | 'status_task';

function make(kind: string, claims: VoiceClaims, texts: readonly string[]): Template[] {
  return texts.map((text, i) => ({ id: `${kind}_${String(i + 1).padStart(2, '0')}`, text, claims }));
}

export const BANTER_CONTEXTS: Readonly<Record<BanterKind, BanterContext>> = {
  greeting: {
    library: [{ category: 'greeting' }],
    templates: make('greeting', 'neutral', [
      "Hey, it's me. Ready to hack the house?",
      'Hi! Capri online.',
      "Oh good, you're here. Let's make some trouble.",
    ]),
    gesture: 'wave',
    emotion: 'happy',
  },
  idle_ignored: {
    library: [{ category: 'tease', ids: ['tease_03', 'tease_05', 'tease_06', 'tease_07'] }],
    templates: make('idle_ignored', 'neutral', [
      'Bored already? I can tell.',
      'Hello? Still here, you know.',
      'Ignoring me is rude. Just saying.',
    ]),
    gesture: 'ignored',
    emotion: 'annoyed',
  },
  toggle_repeat: {
    templates: make('toggle_repeat', 'neutral', [
      '{count} flips on the {device} in a minute. Make up your mind.',
      'On, off, on, off. The {device} is getting dizzy.',
      'Flipping the {device} again? Are we throwing a party?',
      'Careful, the {device} might file a complaint. That is {count} toggles.',
      "The {device} again? You're wearing out that switch.",
    ]),
    gesture: 'tease',
    emotion: 'smug',
  },
  timer_done: {
    templates: make('timer_done', 'neutral', [
      "Time's up! Your timer for {minutes} just ran out.",
      'Ding! The timer you set for {minutes} is up.',
      'Beep beep. That timer for {minutes} is over.',
      "Time's up, human. {minutes} went fast.",
    ]),
    gesture: 'notify',
    emotion: 'happy',
  },
  timer_reminder: {
    templates: make('timer_reminder', 'neutral', [
      "Time's up! Reminder: {label}.",
      'Ding! You asked me to remind you: {label}.',
      'Psst. Reminder time: {label}.',
      "Hey, don't forget: {label}.",
    ]),
    gesture: 'notify',
    emotion: 'happy',
  },
  // The user's own commands for timers and places. They state what was set up, never an outcome of a call.
  timer_set: {
    templates: make('timer_set', 'neutral', [
      "Timer's running for {minutes}. I'll give you a shout.",
      'Okay, {minutes} on the clock. I will let you know.',
      'Timer set for {minutes}. Count on me.',
    ]),
    gesture: 'none',
    emotion: 'happy',
  },
  place_remembered: {
    templates: make('place_remembered', 'neutral', [
      "Got it. I'll remember {label}.",
      "{label} is saved in my map. I won't forget.",
      'Noted. {label} is on my list now.',
    ]),
    gesture: 'none',
    emotion: 'happy',
  },
  place_failed: {
    templates: make('place_failed', 'neutral', [
      "I couldn't save that spot. Look at it and try again.",
      "That spot didn't stick. Try again, or use a simpler name.",
      "Couldn't remember that one. My place list might be full.",
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  surface_not_found: {
    templates: make('surface_not_found', 'neutral', [
      "I can't find {surface}. Scan that bit of the room and ask again.",
      "{surface} isn't on my radar. Show me that area and ask again.",
      "Can't see {surface} from here. Try scanning the room first.",
      'Hmm, {surface} is missing from my map. Give me a better look.',
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  surface_unsuitable: {
    templates: make('surface_unsuitable', 'neutral', [
      "Hmm, I can't stand on {surface}. Try a table or the floor.",
      "{surface} won't hold me. Pick a table or the floor.",
      'Not {surface}. I need a table or the floor.',
      "I'd rather not perch on {surface}. A table or the floor works.",
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  hermes_unavailable: {
    templates: make('hermes_unavailable', 'neutral', [
      "My smart friend isn't answering. I'll handle it on my own.",
      "Hermes is out of reach. I'm handling this one myself.",
      "No answer from the agent. I'll do what I can offline.",
      'The cloud brain is napping. Local me has this.',
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  // A Tier 2 request (task phrase, Ask Hermes prompt, typed chat) while no Hermes is connected,
  // Mock Mode included (Requirement 33.18). Points the user at the setup page.
  hermes_not_connected: {
    templates: make('hermes_not_connected', 'neutral', [
      "Hermes isn't connected. You can add it on the setup page.",
      "No Hermes hooked up yet. Add it on the setup page and I'll call it in.",
      "My agent friend isn't plugged in. Set up Hermes on the setup page.",
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  unsupported: {
    templates: make('unsupported', 'neutral', [
      "Sorry, I can't do that. Try a light, a timer, or a place.",
      "That one's beyond my skills. I'm good with lights, timers, and places.",
      "Can't do that yet. Even hackers have limits.",
      'Nope, not something I can do. Ask me about lights instead.',
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  unknown_device: {
    templates: make('unknown_device', 'neutral', [
      "I don't know a light called {device}. Teach me about it first.",
      '{device}? Never heard of it, so teach me your lights first.',
      'No light called {device} in my system. Re-teach me your lights.',
      "Can't find {device} in my list. Teach me that light first.",
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  bad_timer: {
    templates: make('bad_timer', 'neutral', [
      'I can do timers from {min} to {max} minutes. Pick a number in that range.',
      'Timers run {min} to {max} minutes. Try one of those.',
      'Too short or too long for me. Stick to {min} to {max} minutes.',
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  bad_color: {
    templates: make('bad_color', 'neutral', [
      "That colour isn't in my palette. Try something simpler.",
      "I don't know that colour. Pick a simpler one.",
      'Colour not found in my palette. Try another.',
    ]),
    gesture: 'shrug',
    emotion: 'neutral',
  },
  ask_which: {
    templates: make('ask_which', 'neutral', [
      'Which one do you mean, {list}?',
      'I see a few matches. Is it {list}?',
      'Hold up, which one: {list}?',
      'Careful, {list} all fit. Which one?',
    ]),
    gesture: 'none',
    emotion: 'neutral',
  },
  ask_pointed: {
    templates: make('ask_pointed', 'neutral', [
      'Point at a light first, then tell me again.',
      'I need a target. Point at one and say it again.',
      'Which light? Point at it so I can see.',
      "Show me with your finger first. I can't read minds.",
    ]),
    gesture: 'none',
    emotion: 'neutral',
  },
  ask_repeat: {
    templates: make('ask_repeat', 'neutral', [
      "Say that again? I didn't catch it.",
      'That came through garbled. Say it again or tap a quick action.',
      'Static on the line. Try again, or use a quick action.',
      "Didn't get that. Repeat it, or tap a quick action.",
    ]),
    gesture: 'none',
    emotion: 'neutral',
  },
  pending_light: {
    library: [{ category: 'confirm' }],
    templates: make('pending_light', 'ack', [
      'Working on it.',
      'On it. Hacking the {device}.',
      'Hold on. Poking the {device}.',
    ]),
    gesture: 'none',
    emotion: 'neutral',
  },
  pending_task: {
    library: [{ category: 'thinking' }],
    templates: make('pending_task', 'ack', ['Working on it.', 'On it. Give me a moment.', 'Hold on, digging in.']),
    gesture: 'none',
    emotion: 'neutral',
  },
  // A running Hermes task asks the user to approve one operation (task 21.12). Capri only asks: the
  // answer is the user's, so these lines never say anything was allowed or done.
  approval_requested: {
    templates: make('approval_requested', 'neutral', [
      'Hermes wants your OK on something. Check the panel.',
      'Quick question from Hermes. Approve or deny it on the panel.',
      'Hermes is asking permission. Your call, on the panel.',
    ]),
    gesture: 'none',
    emotion: 'surprised',
  },
  // Lead lines of a result. The dynamic status line that follows carries the facts, so these have
  // no fallback templates: without library lines only the status line is shown.
  success_light: {
    library: [{ category: 'quip' }, { category: 'celebrate' }],
    templates: [],
    gesture: 'celebrate',
    emotion: 'happy',
  },
  success_task: {
    library: [{ category: 'task-complete' }],
    templates: [],
    gesture: 'celebrate',
    emotion: 'happy',
  },
  failure: {
    library: [{ category: 'error' }],
    templates: [],
    gesture: 'shrug',
    emotion: 'sad',
  },
  status_on: {
    templates: make('status_on', 'done', [
      '{device} is on.',
      'Switched the {device} on.',
      'Lit up the {device}.',
      'The {device} is glowing now.',
    ]),
  },
  status_off: {
    templates: make('status_off', 'done', [
      '{device} is off.',
      'Switched the {device} off.',
      'Lights out on the {device}.',
      'The {device} is dark now.',
    ]),
  },
  status_brightness: {
    templates: make('status_brightness', 'done', [
      '{device} is at {pct} percent.',
      'Set the {device} to {pct} percent.',
      'The {device} now sits at {pct} percent.',
    ]),
  },
  status_color: {
    templates: make('status_color', 'done', [
      '{device} is now {color}.',
      'Painted the {device} {color}.',
      'Switched the {device} to {color}.',
    ]),
  },
  status_task: {
    templates: make('status_task', 'done', [
      'The {label} is finished.',
      'All done with the {label}.',
      'Wrapped up the {label}.',
    ]),
  },
};

const SLOT_PATTERN = /\{([a-z]+)\}/g;

/** Names of the slots a template text uses. */
export function templateSlots(text: string): string[] {
  return Array.from(text.matchAll(SLOT_PATTERN), (m) => m[1]!);
}

/** Clean one slot value: no braces, one line, no trailing sentence punctuation. */
export function cleanSlotValue(value: string): string {
  return value
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?\s]+$/u, '');
}

/** First letter upper case. */
export function capitalizeFirst(text: string): string {
  return text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Fill every `{slot}` in one pass. A missing or empty value uses `SLOT_DEFAULTS`, a value that
 * itself contains braces is cleaned first, so the result never holds an unreplaced slot.
 */
export function renderTemplate(text: string, slots: Slots): string {
  const filled = text.replace(SLOT_PATTERN, (_whole, name: string) => {
    const raw = (slots as Record<string, string | undefined>)[name];
    const cleaned = raw === undefined ? '' : cleanSlotValue(raw);
    if (cleaned !== '') return cleaned;
    return (SLOT_DEFAULTS as Record<string, string | undefined>)[name] ?? '';
  });
  return capitalizeFirst(filled);
}
