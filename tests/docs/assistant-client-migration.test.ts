import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_CLIENT_ID,
  ASSISTANT_CLIENT_NAME,
} from '../../packages/domain-tenant/src/service/assistant-client.js';
import { ADMIN_API_AUDIENCE } from '../../packages/domain-tenant/src/service/admin-capabilities.js';

const MIGRATION = readFileSync(
  new URL('../../packages/db/drizzle/0150_builtin_assistant_client.sql', import.meta.url),
  'utf8',
);

describe('the built-in assistant client', () => {
  it('is the same in provisioning and in the backfill migration', () => {
    for (const literal of [ASSISTANT_CLIENT_ID, ASSISTANT_CLIENT_NAME, ADMIN_API_AUDIENCE]) {
      expect(MIGRATION).toContain(`'${literal}'`);
    }
  });
});
