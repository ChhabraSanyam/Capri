/**
 * Commands_Tile catalog (task 33.9, Requirements 33.19, 33.49 to 33.51). Pure.
 *
 * `buildCommandCatalog` turns the phrase table (`domain/speech-lang/phrases.ts`) into the rows the
 * HUD_Menu Commands tile shows, so the list always matches what the grammar and the parser know:
 * every command type in the table gets at least one row (Property 50).
 *
 * Each row says the exact phrase to speak (`say`). A row whose command needs no parameter also has
 * `runText`, which equals `say`; tapping it runs `processText(runText)`, the same path as speech
 * (Requirement 33.51). Rows with a placeholder (`<light name>`, `<colour>`, `<place>`, `<name>`, `<n>`)
 * have no `runText`. Task phrases never have one, so no tap starts a Hermes task such as the evening
 * routine (Requirement 33.19). "that one" has none either: it confirms what the finger points at,
 * and the finger is on the menu while tapping.
 *
 * Deictic rows ("turn that on") act on the light the user picked or points at, as speech does.
 */
import type { DeviceRecord } from '../devices/registry.js';
import type { CommandType, PhraseTable } from '../speech-lang/phrases.js';

export type CommandGroup = 'lights' | 'capri' | 'hermes';

export const COMMAND_GROUPS: readonly CommandGroup[] = ['lights', 'capri', 'hermes'];

export const COMMAND_GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
  lights: 'Lights',
  capri: 'Capri',
  hermes: 'Hermes',
};

export interface CommandRow {
  /** Stable and unique within one catalog. */
  readonly id: string;
  readonly type: CommandType;
  readonly group: CommandGroup;
  /** Short name of the command, "Turn on". */
  readonly label: string;
  /** The exact phrase to say, with a `<placeholder>` where a parameter goes. */
  readonly say: string;
  /** One line of help: what it acts on, or the allowed values. */
  readonly detail?: string;
  /** Present only when the command needs no parameter. Equal to `say`. */
  readonly runText?: string;
}

/** At most this many light names are listed in a row's detail line. */
const MAX_NAMES = 4;

function listNames(names: readonly string[], max = MAX_NAMES): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

function lightNames(registry: readonly Pick<DeviceRecord, 'name'>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const record of registry) {
    const name = record.name.trim();
    const key = name.toLowerCase();
    if (name.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function runnable(row: Omit<CommandRow, 'runText'>): CommandRow {
  return { ...row, runText: row.say };
}

const POINTED = 'The light you point at, or the one you picked';

/** Build the Commands_Tile rows, grouped Lights, Capri, Hermes, in display order. Deterministic. */
export function buildCommandCatalog(table: PhraseTable, registry: readonly Pick<DeviceRecord, 'name'>[]): CommandRow[] {
  const rows: CommandRow[] = [];
  const deictic = table.deicticPhrases[0] ?? 'that';
  const names = lightNames(registry);
  const namesDetail = names.length === 0 ? 'Teach a light first (Lights tile)' : `Your lights: ${listNames(names)}`;
  const splitVerb = table.splitVerbWords[0];

  // ---- Lights -----------------------------------------------------------------------------------
  for (const entry of table.deviceVerbs) {
    const id = `device:${entry.verb}` as const;
    if (entry.verb === 'set_color') {
      rows.push({
        id: 'lights-color',
        type: id,
        group: 'lights',
        label: 'Set a colour',
        say: `${entry.head} <colour>`,
        detail: table.colorNames.join(' '),
      });
      continue;
    }
    // "turn that on" reads more naturally than "turn on that"; both parse to the same intent.
    const particle = table.splitParticles.find((p) => p.verb === entry.verb)?.particle;
    const say =
      particle !== undefined && splitVerb !== undefined ? `${splitVerb} ${deictic} ${particle}` : `${entry.head} ${deictic}`;
    const label = entry.head.charAt(0).toUpperCase() + entry.head.slice(1);
    rows.push(runnable({ id: `lights-${entry.verb}`, type: id, group: 'lights', label, say, detail: POINTED }));
  }
  for (const entry of table.deviceVerbs) {
    if (entry.verb !== 'turn_on' && entry.verb !== 'turn_off') continue;
    rows.push({
      id: `lights-${entry.verb}-named`,
      type: `device:${entry.verb}`,
      group: 'lights',
      label: `${entry.head.charAt(0).toUpperCase()}${entry.head.slice(1)} by name`,
      say: `${entry.head} <light name>`,
      detail: namesDetail,
    });
  }
  const confirm = table.confirmPhrases[0];
  if (confirm !== undefined) {
    rows.push({
      id: 'lights-confirm',
      type: 'confirm_pointed',
      group: 'lights',
      label: 'Pick a light',
      say: confirm,
      detail: 'Say it while you point at a light',
    });
  }

  // ---- Capri ------------------------------------------------------------------------------------
  const heads = table.avatarHeads;
  rows.push(runnable({ id: 'capri-come_here', type: 'avatar:come_here', group: 'capri', label: 'Come here', say: heads.come_here }));
  rows.push(runnable({ id: 'capri-go_away', type: 'avatar:go_away', group: 'capri', label: 'Go away', say: heads.go_away }));
  for (const surface of table.sitSurfaces) {
    rows.push(
      runnable({
        id: `capri-sit-${surface}`,
        type: 'avatar:sit_on',
        group: 'capri',
        label: `Sit on the ${surface}`,
        say: `${heads.sit_on} the ${surface}`,
      }),
    );
  }
  for (const surface of table.perchSurfaces) {
    rows.push(
      runnable({
        id: `capri-perch-${surface}`,
        type: 'avatar:perch_on',
        group: 'capri',
        label: `Perch on the ${surface}`,
        say: `${heads.perch_on} the ${surface}`,
      }),
    );
  }
  rows.push(runnable({ id: 'capri-look_me', type: 'avatar:look_at_me', group: 'capri', label: 'Look at me', say: table.lookAtMe }));
  rows.push(
    runnable({
      id: 'capri-point_that',
      type: 'avatar:point_at',
      group: 'capri',
      label: 'Point at a light',
      say: `${heads.point_at} ${deictic}`,
      detail: POINTED,
    }),
  );
  const places = listNames(table.builtinPlaceNames, table.builtinPlaceNames.length);
  rows.push({
    id: 'capri-look_place',
    type: 'avatar:look_at',
    group: 'capri',
    label: 'Look at a place',
    say: `${heads.look_at} <place>`,
    detail: `Also "${heads.point_at} <place>". ${places}`,
  });
  rows.push({
    id: 'capri-remember',
    type: 'avatar:remember_place',
    group: 'capri',
    label: 'Remember a place',
    say: `${heads.remember_place} <name>`,
    detail: places,
  });
  rows.push({
    id: 'capri-timer',
    type: 'avatar:set_timer',
    group: 'capri',
    label: 'Set a timer',
    say: `${heads.set_timer} <n> minutes`,
    detail: `n from ${table.timerMinutes.min} to ${table.timerMinutes.max}`,
  });

  // ---- Hermes -----------------------------------------------------------------------------------
  for (const prompt of table.hermesPromptPhrases) {
    rows.push(
      runnable({
        id: `hermes-prompt-${prompt.mode}`,
        type: `hermes_prompt:${prompt.mode}`,
        group: 'hermes',
        label: 'Ask Hermes',
        say: prompt.phrase,
        detail: 'Opens the keyboard for your question',
      }),
    );
  }
  // The wake phrase is first in the chat list; a greeting is the friendlier example.
  const chat = table.chatPhrases.find((p) => p !== table.chatPhrases[0]) ?? table.chatPhrases[0];
  if (chat !== undefined) {
    const others = table.chatPhrases.filter((p) => p !== chat);
    rows.push(
      runnable({
        id: 'hermes-chat',
        type: 'chat',
        group: 'hermes',
        label: 'Chat',
        say: chat,
        detail: others.length === 0 ? 'Hermes answers' : `Also: ${others.join(', ')}`,
      }),
    );
  }
  for (const task of table.taskPhrases) {
    rows.push({
      id: `hermes-task-${task.kind}`,
      type: `task:${task.kind}`,
      group: 'hermes',
      label: 'Hermes task',
      say: task.phrase,
      detail: 'Say it to start a Hermes task',
    });
  }
  return rows;
}

/** The rows of one group, in catalog order. */
export function rowsOfGroup(catalog: readonly CommandRow[], group: CommandGroup): CommandRow[] {
  return catalog.filter((r) => r.group === group);
}
