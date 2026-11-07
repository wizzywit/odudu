import { roleSchema } from '@odudu/contracts/admin';
import { idField } from '#/service/read-tool';
import { contentWriteTool, descriptionField, metadataTool, nameField } from '#/service/write-tool';

export const createRoleTool = contentWriteTool({
  name: 'create_role',
  description:
    'Creates a role: a name, and optionally a description and the client it belongs to. A new ' +
    'role grants nothing: nobody holds it, it is a default for no one and nothing is nested ' +
    'under it, and giving it to people, nesting it or making it a default is not in this tool. ' +
    'Needs an idempotency_key of your own, the same on every retry of this create, so that one ' +
    'role is made. A name already in use is refused with 409, a role of a built-in client named ' +
    'like one of its capabilities included. Answers the role and its etag, which ' +
    'update_role_description takes as if_match.',
  routeKey: 'POST /admin/tenants/:tenant/roles',
  capability: 'manage-tenant',
  what: 'role',
  mode: 'create',
  fields: {
    name: nameField,
    description: descriptionField.optional(),
    client_id: idField('client the role belongs to').optional(),
  },
  response: roleSchema,
  refusal:
    'insufficient_scope: a token holding mcp:write may create a role with a name, a description ' +
    'and a client only, never one that is a default for new subjects; check the fields.',
});

export const updateRoleDescriptionTool = metadataTool({
  name: 'update_role_description',
  description:
    "Changes a role's description and nothing else (not its name, its owner, whether it is a " +
    'default for new subjects, the roles nested in it or who holds it). Needs the etag of a ' +
    'get_role read as if_match; answers the updated role and its new etag, or a 412 when the ' +
    'role changed since. Each change is audited, and sending the earlier text back undoes it.',
  routeKey: 'PATCH /admin/tenants/:tenant/roles/:id',
  capability: 'manage-tenant',
  what: 'role',
  fields: { description: descriptionField.optional() },
  response: roleSchema,
  refusal:
    "insufficient_scope: a token holding mcp:write may change only a role's description; " +
    'check the target and the fields.',
});

export const roleWriteTools = [createRoleTool, updateRoleDescriptionTool];
