import { expect, it } from 'vitest';
import { deleteFixed } from '#/pages/clients/services/clientDeletion';
import {
  builtinKind,
  enabledFixed,
  fieldsFixed,
  listsReadOnly,
  redirectsFixed,
} from '#/pages/clients/services/builtinFixed';

const NONE = { builtin_admin: false, builtin_mcp: false, builtin_assistant: false };
const ADMIN = { ...NONE, builtin_admin: true, client_id: 'odudu-admin', name: 'Odudu admin' };
const MCP = { ...NONE, builtin_mcp: true, client_id: 'odudu-mcp', name: 'Odudu MCP' };
const ASSISTANT = {
  ...NONE,
  builtin_assistant: true,
  client_id: 'odudu-assistant',
  name: 'Odudu assistant',
};
const OTHER = { ...NONE, client_id: 'billing', name: 'Billing' };

it('fixes what could lock every administrator out, on the built-in admin client alone', () => {
  expect(enabledFixed(ADMIN)).toMatch(/^odudu-admin cannot be disabled\. This is the tenant's/u);
  expect(redirectsFixed(ADMIN)).toMatch(/^odudu-admin's redirect URIs and web origins cannot/u);
  expect(deleteFixed(ADMIN)).toMatch(/^odudu-admin cannot be deleted\./u);
  for (const free of [OTHER, MCP, ASSISTANT]) expect(enabledFixed(free)).toBeNull();
  expect([redirectsFixed(OTHER), deleteFixed(OTHER), redirectsFixed(MCP)]).toEqual([
    null,
    null,
    null,
  ]);
});

it('names which built-in client it is, by the markers the record carries', () => {
  expect([ADMIN, MCP, ASSISTANT, OTHER].map(builtinKind)).toEqual([
    'admin',
    'mcp',
    'assistant',
    null,
  ]);
});

it('says in one plain sentence that the MCP and assistant clients cannot be deleted, and how to switch them off', () => {
  expect(deleteFixed(ASSISTANT)).toBe(
    'Odudu assistant is built in and cannot be deleted. Disable it to switch it off.',
  );
  expect(deleteFixed(MCP)).toBe(
    'Odudu MCP is built in and cannot be deleted. Disable it to switch it off.',
  );
});

it("fixes everything but the assistant's words and whether it is on, with the reason", () => {
  expect(redirectsFixed(ASSISTANT)).toMatch(
    /^odudu-assistant's redirect URIs and web origins cannot be changed\. /u,
  );
  expect(fieldsFixed(ASSISTANT)).toMatch(
    /^Odudu assistant is built in\. Only its name, description and whether it is enabled can be changed\./u,
  );
  for (const open of [ADMIN, MCP, OTHER]) expect(fieldsFixed(open)).toBeNull();
});

it('shows the two lists as text where the page is read-only, or where they are fixed', () => {
  expect(listsReadOnly(OTHER, true)).toBe(false);
  expect(listsReadOnly(OTHER, false)).toBe(true);
  expect(listsReadOnly(ADMIN, true)).toBe(true);
  expect(listsReadOnly(ASSISTANT, true)).toBe(true);
  expect(listsReadOnly(MCP, true)).toBe(false);
});
