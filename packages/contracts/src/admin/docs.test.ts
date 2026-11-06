import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { listAuditQuerySchema } from '#/admin/audit';
import { clientSchema, listClientsQuerySchema } from '#/admin/clients';
import { documentedJsonSchema, fieldsMissingFrom } from '#/admin/docs';
import {
  groupRecordSchema,
  listGroupsQuerySchema,
  setGroupDefaultRequestSchema,
} from '#/admin/groups';
import { mailMessageSchema } from '#/admin/mail';
import {
  addRoleCompositeRequestSchema,
  listRolesQuerySchema,
  roleSchema,
  setRoleDefaultRequestSchema,
} from '#/admin/roles';
import {
  putSmtpRequestSchema,
  smtpConfigSchema,
  testSmtpRequestSchema,
  testSmtpResponseSchema,
} from '#/admin/smtp';
import { whoamiResponseSchema } from '#/admin/whoami';
import { countResponseSchema } from '#/admin/counts';
import { createTenantRequestSchema } from '#/admin/tenants';

function property(schema: z.ZodType, name: string): { description?: string } {
  const json = documentedJsonSchema(schema);
  const found = (json.properties as Record<string, { description?: string }> | undefined)?.[name];
  if (found === undefined) throw new Error(`no property ${name}`);
  return found;
}

describe('documentedJsonSchema', () => {
  it('describes a field of an extended shape with the words of the shape it extends', () => {
    expect(property(clientSchema, 'enabled').description).toMatch(/disabled client/u);
    expect(property(clientSchema, 'service_account_admin_reach')).toBeDefined();
  });

  it('describes the paging parameters of any list query', () => {
    expect(property(listClientsQuerySchema, 'cursor').description).toMatch(/next/u);
    expect(property(listClientsQuerySchema, 'type').description).toMatch(/type/u);
  });

  it('does not let a short shape describe a long one that merely holds its fields', () => {
    const wide = z.object({
      cursor: z.string(),
      limit: z.number(),
      client: z.string(),
      a: z.string(),
      b: z.string(),
    });
    expect(property(wide, 'client').description).toBeUndefined();
  });

  it('adds the examples written for a request', () => {
    expect(documentedJsonSchema(createTenantRequestSchema).examples).toEqual([
      { name: 'acme', display_name: 'Acme Corporation' },
    ]);
  });

  it('describes the fields of a group, a role, a mail message, a relay and whoami', () => {
    expect(property(groupRecordSchema, 'path').description).toMatch(/names from the top/u);
    expect(property(groupRecordSchema, 'subtree_admin_reach').description).toMatch(/beneath/u);
    expect(property(listGroupsQuerySchema, 'parent').description).toMatch(/root/u);
    expect(property(roleSchema, 'client_key').description).toMatch(/client/u);
    expect(property(listRolesQuerySchema, 'client').description).toMatch(/tenant/u);
    expect(property(mailMessageSchema, 'to_masked').description).toMatch(/read subjects/u);
    expect(property(smtpConfigSchema, 'password_set').description).toMatch(/never/u);
    expect(property(putSmtpRequestSchema, 'from_address').description).toMatch(/From/u);
    expect(property(whoamiResponseSchema, 'crossTenant').description).toMatch(/path/u);
    expect(property(whoamiResponseSchema, 'issuerTenantName').description).toMatch(/name/u);
  });

  it('keeps the audit trail’s own words for `to`, and gives the relay test its own', () => {
    expect(property(listAuditQuerySchema, 'to').description).toMatch(/before this instant/u);
    expect(property(testSmtpRequestSchema, 'to').description).toMatch(/message/u);
  });

  it('describes a single-field body by its field, and no wider object by it', () => {
    expect(property(setGroupDefaultRequestSchema, 'default').description).toMatch(
      /this group or role/u,
    );
    expect(property(setRoleDefaultRequestSchema, 'default').description).toMatch(
      /this group or role/u,
    );
    expect(property(addRoleCompositeRequestSchema, 'child_role_id').description).toMatch(/nest/u);
    expect(property(testSmtpResponseSchema, 'sent').description).toMatch(/relay/u);
    const wider = z.object({
      default: z.boolean(),
      to: z.string(),
      sent: z.boolean(),
      name: z.string(),
    });
    for (const name of ['default', 'to', 'sent']) {
      expect(property(wider, name).description, name).toBeUndefined();
    }
  });

  it('names a field its schema lacks, so a stray description cannot hide', () => {
    expect(fieldsMissingFrom(countResponseSchema, { count: 'x', capped: 'y' })).toEqual([]);
    expect(fieldsMissingFrom(countResponseSchema, { count: 'x', to: 'y', sent: 'z' })).toEqual([
      'to',
      'sent',
    ]);
  });

  it('leaves the schemas the console imports without any of this prose', () => {
    expect(JSON.stringify(z.toJSONSchema(clientSchema, { unrepresentable: 'any' }))).not.toMatch(
      /disabled client/u,
    );
  });
});
