import { generateClientKey, loadClientKey, registeredClientJwks } from '@odudu/crypto';
import { type ConsoleKeys } from '#/console-key';

// One key for every test of the console: the gateway signs with it and each
// tenant's admin client registers its public half.
export const CONSOLE_CLIENT_KEY: string = await generateClientKey();

const key = await loadClientKey(CONSOLE_CLIENT_KEY);

export const CONSOLE_KEYS: ConsoleKeys = { key, jwks: registeredClientJwks(key, []) };
