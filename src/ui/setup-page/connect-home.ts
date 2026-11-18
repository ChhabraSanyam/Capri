/**
 * "Connect your own home" on the Setup_Page (task 25.9, Requirements 24.2 to 24.4, 24.8 to 24.11,
 * 26.7, 27.4, 27.6). A collapsible form for the Home Assistant URL and long-lived token, the Hermes
 * URL and key, the "Live Mode" and "Remember on this device" switches, and the Save, Test
 * connections, and Forget credentials buttons.
 *
 * - `CredentialStore` is the only persistence. It normalises values and registers the token and key
 *   for redaction on every save and load, and `forget()` deletes them and returns to Mock Mode.
 * - Fields accept pasted values. Line breaks and surrounding spaces are removed when a field loses
 *   focus and again on save. No field has a length limit, so a long token is never cut.
 * - Token and key fields are masked. "Show" reveals one field until it is toggled again, saved,
 *   or forgotten.
 * - Every message comes from fixed text that names the setting (`ha_url`) and never its value. Text
 *   written to the page goes through `redactOutput` as defense in depth.
 * - Nothing here logs.
 *
 * The AR session follows the saved mode (task 25.10, `app/session-mode.ts`).
 */
import type { HaFetch } from '../../backends/ha/ha-client.js';
import type { BackendSettingName } from '../../backends/types.js';
import { redactOutput } from '../../app/secrets.js';
import { CREDENTIAL_KEYS, normalizeCredential, type Credentials, type SecretSettingName } from '../../domain/settings/credentials.js';
import type { ModeState } from '../../domain/settings/mode-resolver.js';
import {
  describeMissing,
  hasFieldErrors,
  validateSetting,
  validateSetupForm,
  type FieldErrors,
} from '../../domain/settings/setup-form.js';
import type { CredentialStore } from '../../persistence/credential-store.js';
import { testConnections, type ConnectionTestOutcome } from './connection-test.js';

export interface ConnectHomeElements {
  readonly details: HTMLDetailsElement;
  readonly form: HTMLFormElement;
  readonly fields: Readonly<Record<BackendSettingName, HTMLInputElement>>;
  readonly errors: Readonly<Record<BackendSettingName, HTMLElement>>;
  readonly showToggles: Readonly<Record<SecretSettingName, HTMLButtonElement>>;
  readonly live: HTMLInputElement;
  readonly remember: HTMLInputElement;
  readonly save: HTMLButtonElement;
  readonly test: HTMLButtonElement;
  readonly forget: HTMLButtonElement;
  /** What Live Mode still needs (`ModeState.missing`). */
  readonly missing: HTMLElement;
  /** One status line for the last action. */
  readonly status: HTMLElement;
  /** A list: one item per integration after a test. */
  readonly results: HTMLElement;
}

export interface ConnectHomeOptions {
  readonly elements: ConnectHomeElements;
  readonly store: CredentialStore;
  /** The page's own `fetch`, captured before the Mock Mode network guard. */
  readonly fetch: HaFetch | undefined;
  /** `window.location.origin`, named in CORS hints. */
  readonly pageOrigin: string;
  readonly haTimeoutMs?: number;
}

export interface ConnectHome {
  /** Validate and store the form. False when a field is invalid (nothing is stored then). */
  save(): boolean;
  /** Save, then test the saved settings. */
  test(): Promise<ConnectionTestOutcome | undefined>;
  forget(): void;
  dispose(): void;
}

const SHOW_LABELS: Readonly<Record<SecretSettingName, string>> = {
  ha_token: 'Home Assistant token',
  hermes_key: 'Hermes key',
};

const SECRET_FIELDS: readonly SecretSettingName[] = ['ha_token', 'hermes_key'];

function setText(element: HTMLElement, text: string): void {
  element.textContent = redactOutput(text);
  element.hidden = text === '';
}

export function createConnectHome(options: ConnectHomeOptions): ConnectHome {
  const el = options.elements;
  const { store } = options;
  const disposers: (() => void)[] = [];
  // Bumped by save and forget, so a test that finishes later does not show stale results.
  let generation = 0;

  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    target.addEventListener(type, handler as EventListener);
    disposers.push(() => target.removeEventListener(type, handler as EventListener));
  };

  const setMasked = (setting: SecretSettingName, masked: boolean): void => {
    const toggle = el.showToggles[setting];
    el.fields[setting].type = masked ? 'password' : 'text';
    toggle.textContent = masked ? 'Show' : 'Hide';
    toggle.setAttribute('aria-pressed', masked ? 'false' : 'true');
    toggle.setAttribute('aria-label', `${masked ? 'Show' : 'Hide'} ${SHOW_LABELS[setting]}`);
  };
  const maskAll = (): void => SECRET_FIELDS.forEach((s) => setMasked(s, true));

  const showFieldError = (setting: BackendSettingName, message: string | undefined): void => {
    const input = el.fields[setting];
    setText(el.errors[setting], message ?? '');
    if (message === undefined) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
  };
  const showErrors = (errors: FieldErrors): void => {
    for (const setting of CREDENTIAL_KEYS) showFieldError(setting, errors[setting]);
  };

  const readForm = (): Credentials => {
    const values = {} as Credentials;
    for (const setting of CREDENTIAL_KEYS) {
      const input = el.fields[setting];
      input.value = normalizeCredential(input.value);
      values[setting] = input.value;
    }
    return values;
  };

  const fillForm = (): void => {
    const snapshot = store.snapshot();
    for (const setting of CREDENTIAL_KEYS) el.fields[setting].value = snapshot.credentials[setting];
    el.live.checked = snapshot.liveRequested;
    el.remember.checked = snapshot.remember;
    maskAll();
    showErrors({});
  };

  // Say plainly what Enter AR will use (task 25.10): real lights in Live Mode, which are taught in AR.
  const renderMode = (state: ModeState): void =>
    setText(
      el.missing,
      [
        describeMissing(state),
        state.mode === 'live'
          ? 'Live Mode is on. Enter AR uses your Home Assistant lights: teach each one in AR with the orb beside Capri.'
          : '',
      ]
        .filter((line) => line !== '')
        .join(' '),
    );
  const clearResults = (): void => el.results.replaceChildren();

  const renderOutcome = (outcome: ConnectionTestOutcome): void => {
    clearResults();
    if (!outcome.ran) {
      setText(el.status, outcome.notice ?? '');
      return;
    }
    const failed = outcome.results.some((r) => r.ok === false);
    setText(el.status, failed ? 'Test finished. Something needs attention.' : 'Test finished.');
    const doc = el.results.ownerDocument;
    for (const result of outcome.results) {
      const item = doc.createElement('li');
      item.dataset.integration = result.integration;
      item.dataset.result = result.ok === undefined ? 'skipped' : result.ok ? 'ok' : 'failed';
      for (const line of result.lines) {
        const p = doc.createElement('p');
        p.textContent = redactOutput(line);
        item.append(p);
      }
      el.results.append(item);
    }
  };

  const save = (): boolean => {
    generation += 1;
    clearResults();
    const credentials = readForm();
    const errors = validateSetupForm(credentials);
    showErrors(errors);
    if (hasFieldErrors(errors)) {
      setText(el.status, 'Nothing was saved. Fix the settings marked above.');
      const first = CREDENTIAL_KEYS.find((s) => errors[s] !== undefined);
      if (first !== undefined) el.fields[first].focus();
      return false;
    }
    const result = store.save({ credentials, liveRequested: el.live.checked, remember: el.remember.checked });
    fillForm();
    for (const refusal of result.refused) showFieldError(refusal.setting, refusal.message);
    const where = el.remember.checked ? 'Saved on this device.' : 'Saved for this tab only. It is cleared when you close the tab.';
    setText(
      el.status,
      result.persisted ? where : "Saved for now, but this browser's storage could not be written. The settings last until you close the page.",
    );
    return result.refused.length === 0;
  };

  const test = async (): Promise<ConnectionTestOutcome | undefined> => {
    if (!save()) return undefined;
    const mine = generation;
    el.test.disabled = true;
    setText(el.status, 'Testing connections...');
    try {
      const outcome = await testConnections({
        credentials: store.snapshot().credentials,
        mode: store.mode.value,
        fetch: options.fetch,
        pageOrigin: options.pageOrigin,
        ...(options.haTimeoutMs === undefined ? {} : { haTimeoutMs: options.haTimeoutMs }),
      });
      if (mine === generation) renderOutcome(outcome);
      return outcome;
    } catch {
      if (mine === generation) setText(el.status, 'The connection test did not finish.');
      return undefined;
    } finally {
      el.test.disabled = false;
    }
  };

  const forget = (): void => {
    generation += 1;
    const { removed } = store.forget();
    fillForm();
    clearResults();
    setText(
      el.status,
      removed
        ? 'Credentials forgotten. They are deleted from this device and Capri is back in Mock Mode.'
        : 'Credentials cleared for this page, but the browser storage could not be fully deleted. Clear the site data in the browser settings.',
    );
  };

  // Wiring.
  for (const setting of CREDENTIAL_KEYS) {
    const input = el.fields[setting];
    // Blur only cleans the value. Errors appear on Save or Test: showing one on blur would move the
    // buttons under a pointer that is already pressing them, and the click would miss.
    listen(input, 'blur', () => {
      input.value = normalizeCredential(input.value);
    });
    // Once a field shows an error, re-check it while the user types so the message clears.
    listen(input, 'input', () => {
      if (input.getAttribute('aria-invalid') === 'true') showFieldError(setting, validateSetting(setting, input.value));
    });
  }
  for (const setting of SECRET_FIELDS) {
    listen(el.showToggles[setting], 'click', () => setMasked(setting, el.fields[setting].type !== 'password'));
  }
  listen(el.form, 'submit', (event) => {
    event.preventDefault();
    save();
  });
  listen(el.test, 'click', () => {
    void test();
  });
  listen(el.forget, 'click', forget);
  disposers.push(store.mode.subscribe(renderMode));

  fillForm();
  renderMode(store.mode.value);
  setText(el.status, '');
  const snapshot = store.snapshot();
  if (snapshot.liveRequested || CREDENTIAL_KEYS.some((s) => snapshot.credentials[s] !== '')) el.details.open = true;

  return {
    save,
    test,
    forget,
    dispose() {
      for (const undo of disposers.splice(0)) undo();
    },
  };
}
