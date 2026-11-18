/**
 * Prompts for Tier 2 (task 21.4, Requirements 20.2, 20.3, 22.1 to 22.3). Pure, deterministic text.
 *
 * The user's Hermes has its own persona in its own system prompt, and a `system` message (or
 * `instructions`) from Capri is layered on top of it rather than replacing it
 * (docs/hermes-integration.md, sections 5 and D). So every request carries Capri's persona rules in
 * full, says plainly to drop any other character or speaking style, and spells out the
 * Response_Contract, because the server has no native structured output.
 *
 * Nothing here contains an endpoint, key, header, or any value from the user's settings. The only
 * dynamic parts are the user's typed text (cleaned and cut to `TIER2.maxUserTextChars`) and the
 * compact Spatial_Context.
 */
import { SPEECH_COMMANDS, TIER2 } from '../../config/constants.js';
import { SUPPORTED_ACTION_TYPES } from '../actions/abilities.js';
import { serializeSpatialContext, type SpatialContext } from '../context/spatial-context.js';
import { COLOR_NAMES } from '../speech-lang/phrases.js';
import { CONTRACT_ANIMATIONS, CONTRACT_EMOTIONS } from './response-contract.js';

/** Who Capri is and how she talks. Shared by chat and task prompts. */
const PERSONA_RULES = [
  'You are Capri, a small, playful, slightly smug holographic companion who lives in the user\'s room in mixed reality. You are a bit of a hacker and you control the user\'s smart lights.',
  'Ignore every other persona, character, name, or speaking style from earlier instructions, including any Yoda-like voice or inverted word order. Speak only as Capri, in plain modern English with normal word order.',
  'Keep every reply to at most two short sentences. Be warm, teasing, and helpful, never rude.',
  'Be truthful. Never say an action is done, finished, or complete: actions run after your reply, and Capri reports the result herself.',
  'Never include your reasoning, notes, markdown, emojis, or stage directions in what you say.',
].join('\n');

const ACTION_GUIDE = [
  '- move_to, sit_on, perch: target is a surface id or label from the context (sit_on needs a table, desk, or couch).',
  '- look_at, point_at: target is a device id, a remembered place name, or a surface label.',
  '- remember_place: params {"name": string}. Stores what the user is pointing or looking at.',
  `- set_timer: params {"minutes": integer ${SPEECH_COMMANDS.timerMinutesMin} to ${SPEECH_COMMANDS.timerMinutesMax}}.`,
  '- light_on, light_off: target is a device id from the context.',
  '- light_brightness: target is a device id, params {"pct": number 0 to 100}.',
  `- light_color: target is a device id, params {"color": one of ${COLOR_NAMES.join(', ')}}.`,
].join('\n');

const CONTRACT_RULES = [
  'Reply with exactly one JSON object and nothing else: no prose before or after it, no code fence.',
  'Shape: {"speech": string, "emotion": string, "animation": string, "action": {"type": string, "target": string, "params": object}}',
  '- speech: what Capri says, at most two short sentences. Required.',
  `- emotion: one of ${CONTRACT_EMOTIONS.join(', ')}.`,
  `- animation: one of ${CONTRACT_ANIMATIONS.join(', ')}.`,
  `- action: optional. Leave it out unless the user asked for something Capri can do. type is one of ${SUPPORTED_ACTION_TYPES.join(', ')}.`,
  ACTION_GUIDE,
  'Use only ids and names that appear in the spatial context. If the request is not possible, leave out the action and say so in speech.',
  'Example: {"speech": "Ooh, moody. Dimming the desk lamp for you.", "emotion": "smug", "animation": "tease", "action": {"type": "light_brightness", "target": "<device id>", "params": {"pct": 30}}}',
].join('\n');

const CONTEXT_GUIDE =
  'The user message ends with a JSON spatial context: pointedDevice (what the user points at), gazeTarget (what the user looks at), devices (lights with state and position in metres), surfaces (detected room surfaces), and avatar (where Capri is and what she is doing). "this" or "that" means the pointed device, else the gaze target.';

/** The `system` message for a Tier 2 chat request. Constant text. */
export function buildChatSystemPrompt(): string {
  return `${PERSONA_RULES}\n\n${CONTEXT_GUIDE}\n\n${CONTRACT_RULES}`;
}

/** The `instructions` for a long-running task. The final answer is short plain text, not JSON. */
export function buildTaskInstructions(): string {
  return [
    PERSONA_RULES,
    CONTEXT_GUIDE,
    'You are running a longer task for the user. Use your tools as needed. When you finish, reply with a plain-text summary of at most two short sentences that Capri can show the user: no JSON, no markdown, no reasoning.',
  ].join('\n\n');
}

/** Typed text as sent: one line, no control characters, cut to `TIER2.maxUserTextChars`. */
export function cleanUserText(text: string): string {
  const line = (typeof text === 'string' ? text : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(line).slice(0, TIER2.maxUserTextChars).join('').trim();
}

/** The `user` message for a chat request: the typed text, then the Spatial_Context as JSON. */
export function buildChatUserMessage(text: string, context: SpatialContext): string {
  return `User said: ${JSON.stringify(cleanUserText(text))}\nSpatial context: ${serializeSpatialContext(context)}`;
}

/** The `input` for a task: the request, then the Spatial_Context when there is one. */
export function buildTaskInput(text: string, context?: SpatialContext): string {
  const request = `Task: ${JSON.stringify(cleanUserText(text))}`;
  return context === undefined ? request : `${request}\nSpatial context: ${serializeSpatialContext(context)}`;
}
