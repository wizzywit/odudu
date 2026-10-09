import {
  loadClientKey,
  loadRetiredClientKey,
  registeredClientJwks,
  type ClientKey,
} from '@odudu/crypto';
import { type Config, consoleBaseUrl, OduduError } from '@odudu/kernel';
import { type ClientJwks } from '@odudu/protocol-oidc';

export interface ConsoleKeys {
  /** Signs the gateway's client assertions. */
  readonly key: ClientKey;
  /** What every tenant's admin client registers: the signing key, then the one it replaces. */
  readonly jwks: ClientJwks;
}

export function missingConsoleKey(): OduduError {
  return new OduduError(
    'config_invalid',
    'ODUDU_CONSOLE_CLIENT_KEY is required while the administration console is on: the ' +
      "gateway authenticates as every tenant's admin client with it. Generate one with " +
      '`odudu console keygen`, or set ODUDU_CONSOLE=false to serve no console.',
  );
}

async function readable<T>(variable: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new OduduError('config_invalid', `${variable} cannot be used: ${reason}`, { cause });
  }
}

/**
 * The console's keys, or `undefined` when nothing is registered under a
 * console base: the console is off, or no base is configured. With the
 * console on, a missing or unreadable key is a refusal that names the
 * variable.
 */
export async function loadConsoleKeys(config: Config): Promise<ConsoleKeys | undefined> {
  if (consoleBaseUrl(config) === undefined) return undefined;
  const serialized = config.ODUDU_CONSOLE_CLIENT_KEY;
  if (serialized === undefined) throw missingConsoleKey();
  const key = await readable('ODUDU_CONSOLE_CLIENT_KEY', () => loadClientKey(serialized));
  const previous = config.ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS;
  const retired =
    previous === undefined
      ? []
      : [await readable('ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS', () => loadRetiredClientKey(previous))];
  return { key, jwks: registeredClientJwks(key, retired) };
}

export interface ConsoleProvisioning {
  readonly consoleBaseUrl?: string;
  readonly consoleClientJwks?: ClientJwks;
}

/** What `provisionAdminClient` is given on every path that writes a tenant's admin client. */
export async function consoleProvisioning(config: Config): Promise<ConsoleProvisioning> {
  const keys = await loadConsoleKeys(config);
  const baseUrl = consoleBaseUrl(config);
  if (keys === undefined || baseUrl === undefined) return {};
  return { consoleBaseUrl: baseUrl, consoleClientJwks: keys.jwks };
}
