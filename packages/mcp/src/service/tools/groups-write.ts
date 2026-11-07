import { CLIENT_NAME_MAX, groupSchema } from '@odudu/contracts/admin';
import { contentWriteTool, descriptionField, metadataTool, nameField } from '#/service/write-tool';

// A group's path is its names joined by slashes, so a name holds none.
const groupNameField = nameField
  .regex(/^[^/]+$/u, { message: 'must not contain a slash' })
  .describe(`The group's name, at most ${String(CLIENT_NAME_MAX)} characters and no slash.`);

export const createGroupTool = contentWriteTool({
  name: 'create_group',
  description:
    'Creates a group at the top level: a name, and optionally a description. A new group ' +
    'grants nothing: it has no roles and no members, it is a default for no one, and giving it ' +
    'roles, adding people, putting it under another group or making it a default is not in ' +
    'this tool. Needs an idempotency_key of your own, the same on every retry of this create, ' +
    'so that one group is made. A name already used at the top level is refused with 409. ' +
    'Answers the group and its etag, which update_group_description takes as if_match.',
  routeKey: 'POST /admin/tenants/:tenant/groups',
  capability: 'manage-tenant',
  what: 'group',
  mode: 'create',
  fields: { name: groupNameField, description: descriptionField.optional() },
  response: groupSchema,
  refusal:
    'insufficient_scope: a token holding mcp:write may create a group with a name and a ' +
    'description only, never under a parent; check the fields.',
});

export const updateGroupDescriptionTool = metadataTool({
  name: 'update_group_description',
  description:
    "Changes a group's description and nothing else (not its name, its parent, whether it is " +
    'a default for new subjects, its roles or its members). Needs the etag of a get_group read ' +
    'as if_match; answers the updated group and its new etag, or a 412 when the group changed ' +
    'since. Each change is audited, and sending the earlier text back undoes it.',
  routeKey: 'PATCH /admin/tenants/:tenant/groups/:id',
  capability: 'manage-tenant',
  what: 'group',
  fields: { description: descriptionField.optional() },
  response: groupSchema,
  refusal:
    "insufficient_scope: a token holding mcp:write may change only a group's description; " +
    'check the target and the fields.',
});

export const groupWriteTools = [createGroupTool, updateGroupDescriptionTool];
