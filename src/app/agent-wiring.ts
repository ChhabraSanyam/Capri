/**
 * Agent wiring (tasks 21.12, 25.10, Requirements 19.3, 20.1, 20.8, 23.5, 23.10, 24.6). Builds the
 * agent for the resolved mode, puts it in the `AgentSlot`, and settles its connection once with
 * `testConnection()` (the tier router only chats while `connected`).
 *
 * - Mock Mode: the scripted `MockAgent` (no network).
 * - `agent: 'live'`: the `LiveHermesAdapter` on the stored Hermes URL and key, with a `fetch` pinned
 *   to the Hermes origin, so the key can go nowhere else.
 * - `agent: 'absent'`: no agent. The slot reports `not_configured` and Capri says the
 *   in-character "Hermes is unavailable" line for chat and tasks.
 *
 * Credentials come only from a `HermesCredentialsProvider`, which reads the credential store
 * (`storedHermesCredentials`). Secrets are never read from environment variables, the URL, or the
 * bundle.
 */
import type { AgentSlot } from '../backends/agent-slot.js';
import type { HermesCredentials } from '../backends/hermes/live-hermes-adapter.js';
import { pinnedFetchFor, type PinnableFetch } from '../backends/pinned-fetch.js';
import { selectAgentBackend } from '../backends/select-backend.js';
import type { HermesLog } from '../backends/hermes/hermes-adapter.js';
import type { Credentials } from '../domain/settings/credentials.js';
import type { ModeState } from '../domain/settings/mode-resolver.js';
import type { Logger } from './logger.js';
import { appSecrets, registerSecrets } from './secrets.js';

/** Returns the stored Hermes URL and key. Called once per connect, only in Live Mode. */
export type HermesCredentialsProvider = () => HermesCredentials;

/** What `storedHermesCredentials` reads: the credential store (`persistence/credential-store.ts`). */
export interface CredentialSource {
  snapshot(): { readonly credentials: Partial<Credentials> };
}

/** A provider that reads the Hermes URL and key from the credential store at connect time. */
export function storedHermesCredentials(source: CredentialSource): HermesCredentialsProvider {
  return () => {
    const { hermes_url, hermes_key } = source.snapshot().credentials;
    return { hermes_url, hermes_key };
  };
}

export interface ConnectAgentOptions {
  readonly credentials: HermesCredentialsProvider;
  readonly logger: Logger;
  /**
   * The page's own `fetch`, captured before the Mock Mode network guard. Pinned to the Hermes origin
   * for the live adapter. Defaults to the global `fetch`.
   */
  readonly fetch?: PinnableFetch;
}

/**
 * Put the mode's agent in `slot` and test its connection once. Resolves when the test has settled.
 * Never rejects. Logs the outcome kind only, never a URL, key, or message body.
 */
export async function connectAgent(mode: ModeState, slot: AgentSlot, options: ConnectAgentOptions): Promise<void> {
  const { logger } = options;
  const log: HermesLog = { info: (m) => logger.info(m), warn: (m) => logger.warn(m) };
  const hermes = mode.agent === 'live' ? options.credentials() : undefined;
  if (hermes !== undefined) {
    // Register before anything can log, so the key is scrubbed from every line (Requirement 29.7).
    registerSecrets(hermes);
    appSecrets.add(hermes.hermes_key?.trim());
  }
  const pageFetch =
    options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  const agent = selectAgentBackend(mode, {
    ...(hermes === undefined ? {} : { hermes }),
    live: {
      log,
      ...(hermes === undefined ? {} : { fetch: pinnedFetchFor(pageFetch, 'hermes_url', hermes.hermes_url) }),
    },
  });
  slot.set(agent);
  if (agent === undefined) {
    logger.info('agent: none configured, so Tier 1 answers alone');
    return;
  }
  try {
    const result = await agent.testConnection();
    if (slot.current !== agent) return;
    if (result.ok) logger.info(`agent: ${agent.kind} agent connected`);
    else logger.warn(`agent: connection test failed (${result.error.kind})`);
  } catch {
    logger.warn('agent: connection test threw');
  }
}
