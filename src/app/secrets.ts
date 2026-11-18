/**
 * The app's one secret registry (design: Credential handling, Requirements 24.10, 29.7). Whatever
 * reads credentials registers their secret values here; the logger and every error-to-UI path
 * redact through `redactOutput`. `forgetSecrets` drops the values when credentials are forgotten.
 */
import { SecretRegistry } from '../domain/settings/redact.js';
import { registerCredentialSecrets, type Credentials } from '../domain/settings/credentials.js';

export const appSecrets = new SecretRegistry();

/** Text safe for the console, a log, or the page: registered secrets and credential shapes removed. */
export function redactOutput(text: string): string {
  return appSecrets.redact(text);
}

/** Register the token and key of `credentials`. Call wherever credentials are read. */
export function registerSecrets(credentials: Partial<Credentials>): void {
  registerCredentialSecrets(appSecrets, credentials);
}

export function forgetSecrets(): void {
  appSecrets.clear();
}
