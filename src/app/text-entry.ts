/**
 * Text entry (task 33.9, Requirements 33.52 to 33.58): what happens when a HUD_Menu text tile or the
 * spoken "ask hermes" opens the System_Keyboard, and where the typed text goes.
 *
 * - `command` (Commands tile, Type): the text goes through `processText` exactly as speech does
 *   (`VoiceLoop.submitText(text, 'keyboard')`, Requirement 33.53). Free text that matches no command
 *   goes to Hermes as chat while it is connected, as typed text always did.
 * - `ask` (Ask Hermes tile, or "ask hermes"): the text goes to Hermes as Tier 2 chat, and the reply
 *   shows in Capri's Speech_Bubble after her thinking line (Requirement 33.55).
 * - `task` (Give Hermes a task tile): the text starts a long-running Hermes task through the task
 *   flow, with the Task_Panel steps and approvals (Requirement 33.56).
 *
 * While Hermes is not connected, `ask` and `task` do not open the keyboard: Capri says the in-character
 * not-connected line (task 33.4, Requirement 33.58). Without the System_Keyboard nothing opens and the
 * Transcript_Bubble says text entry is unavailable (the HUD_Menu hides the tiles, Requirement 33.54).
 *
 * The typed text is shown in the Transcript_Bubble like heard words, and never logged.
 * No DOM and no Three.js here, so it runs under Node with a fake keyboard.
 */
import { TEXT_ENTRY_UNAVAILABLE } from '../domain/hud/hud-view.js';
import type { SystemKeyboardPort } from '../ui/system-keyboard.js';
import type { Logger } from './logger.js';

export type TextEntryPurpose = 'ask' | 'task' | 'command';

/** The keyboard field's placeholder for each purpose. */
export const TEXT_ENTRY_PROMPTS: Readonly<Record<TextEntryPurpose, string>> = {
  ask: 'Ask Hermes anything',
  task: 'Give Hermes a task',
  command: 'Type a command for Capri',
};

/** What an `open` came to. */
export type TextEntryOutcome = 'submitted' | 'cancelled' | 'not_connected' | 'unsupported';

/** Where submitted text goes. `VoiceLoop` provides all three. */
export interface TextEntryTargets {
  command(text: string): Promise<void>;
  ask(text: string): Promise<void>;
  task(text: string): Promise<void>;
}

export interface TextEntryDeps {
  readonly keyboard: SystemKeyboardPort;
  readonly targets: TextEntryTargets;
  readonly isHermesConnected: () => boolean;
  /** Capri says the not-connected line (Persona `hermes_not_connected`). */
  readonly sayNotConnected: () => void;
  /** Show a short line in the Transcript_Bubble: the prompt, a note, or the typed words. */
  readonly showLine: (text: string) => void;
  readonly logger: Logger;
}

export class TextEntry {
  constructor(private readonly deps: TextEntryDeps) {}

  /** The System_Keyboard can show now. The HUD_Menu hides the text tiles when it cannot. */
  get available(): boolean {
    return this.deps.keyboard.supported;
  }

  get isOpen(): boolean {
    return this.deps.keyboard.isOpen;
  }

  /**
   * Open the keyboard for `purpose` and route the text. Resolves once the text was handed on (the
   * chat or task itself may still be running), or straight away when nothing opened.
   */
  async open(purpose: TextEntryPurpose): Promise<TextEntryOutcome> {
    const { keyboard, logger } = this.deps;
    if (purpose !== 'command' && !this.deps.isHermesConnected()) {
      logger.info(`text entry: ${purpose} while Hermes is not connected`);
      this.deps.sayNotConnected();
      return 'not_connected';
    }
    if (!keyboard.supported) {
      logger.info('text entry: the system keyboard is not available');
      this.deps.showLine(TEXT_ENTRY_UNAVAILABLE);
      return 'unsupported';
    }
    // A prompt that is still open (its keyboard may never have shown) is replaced, never stacked.
    const prompt = TEXT_ENTRY_PROMPTS[purpose];
    this.deps.showLine(`${prompt}: type, then Done`);
    const result = await keyboard.open(prompt);
    if (result.kind !== 'submitted') {
      logger.info(`text entry: ${purpose} closed without text (${result.reason})`);
      return 'cancelled';
    }
    logger.info(`text entry: ${purpose} text sent`);
    this.deps.showLine(result.text);
    const target = this.deps.targets[purpose];
    await target.call(this.deps.targets, result.text);
    return 'submitted';
  }
}
