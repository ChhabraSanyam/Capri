/**
 * Titles and exact headset steps for the five spike items. The steps are shown in the scene
 * next to the active row (Requirement 1.9).
 *
 * Keep each line short and plain ASCII: UIKit text wraps, and the Quest font may lack
 * typographic punctuation.
 */
import type { SpikeItemSpec } from './types.js';

export const SPIKE_ITEM_SPECS: readonly SpikeItemSpec[] = [
  {
    id: 'a',
    title: 'AR session, passthrough, hand joints',
    instructions: [
      'Put both controllers down so only your hands are tracked.',
      'Press Start with a pinch.',
      'Hold both hands up in front of you.',
      'Check that a ball sits on every joint and follows your fingers.',
      'If the balls are wrong or missing, pinch Stop. Otherwise wait for the result.',
    ],
  },
  {
    id: 'b',
    title: 'Planes, labels, mesh, anchors, hit-test, depth',
    instructions: [
      'Press Start with a pinch. Use your RIGHT hand for every placing pinch.',
      'Scan the room: look at the floor, a table, and the walls for a few seconds.',
      'Pinch the floor, then a table top. Check the cyan figure stands on the floor and the orange one sits at the table (lean aside if the panel hides them).',
      'Depth prompt: hold a hand in front of the orange figure. Right pinch if it hid, left pinch if not.',
      'Reload check: exit AR, reload this page, enter AR, press Start on (b) again, pinch the table under the magenta ring. A left pinch skips it.',
    ],
  },
  {
    id: 'c',
    title: 'Microphone during the AR session',
    instructions: [
      'Press Start with a pinch. The microphone is asked for right then.',
      'Allow the microphone permission prompt if one appears.',
      'Say clearly: "turn that off". Watch the level bar move as you speak.',
      'If the AR view closes on the prompt, enter AR again and press Start on (c) again.',
    ],
  },
  {
    id: 'd',
    title: 'Vosk speech recognition (restricted grammar)',
    instructions: [
      'Press Start with a pinch. The speech model is about 41 MB, so the first load takes a while.',
      'When the panel says SAY NOW, say that phrase clearly, then wait for the result.',
      'Phrases: "turn on", "turn off", "come here" (10 each), then "set a timer for five minutes" (3 times, not in the grammar).',
      'Last: say "turn off that" 3 times. After that the timing runs by itself.',
    ],
  },
  {
    id: 'e',
    title: 'speechSynthesis voices',
    instructions: [
      'Turn the headset volume up. Press Start with a pinch. Capri speaks one short line at once.',
      'Listen. When the panel says RATE NOW, judge the voice for a playful hacker-girl character.',
      'RIGHT pinch = Good. LEFT pinch = not good, then RIGHT pinch = Robotic (heard, sounds bad) or LEFT pinch = Silent (heard nothing).',
      'Aim your hand away from the panel when you pinch, so it is not a button press.',
      'A new voice speaks after each rating. The result appears by itself after the last voice.',
    ],
  },
];
