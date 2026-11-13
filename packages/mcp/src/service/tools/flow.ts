import {
  flowSchema,
  listExecutionsResponseSchema,
  listFlowsResponseSchema,
} from '@odudu/contracts/admin';
import { idField, tenantGet, valueTool } from '#/service/read-tool';

export const flowTools = [
  valueTool({
    name: 'get_flow_executions',
    description:
      "Reads the tenant's default sign-in flow: the authenticators it runs in order, each required or " +
      'alternative, any settings a step overrides, and the authenticators that could be added.',
    routeKey: tenantGet('/flow/executions'),
    capability: 'manage-tenant',
    shape: {},
    response: listExecutionsResponseSchema,
  }),
  valueTool({
    name: 'list_flows',
    description:
      "Lists the tenant's sign-in flows, at most 20, by name, with the steps of each, which one " +
      'is the default and how many clients name each. Never paged.',
    routeKey: tenantGet('/flows'),
    capability: 'manage-tenant',
    shape: {},
    response: listFlowsResponseSchema,
  }),
  valueTool({
    name: 'get_flow',
    description:
      'Reads one sign-in flow: its name, whether it is the default, and its steps in order, with any ' +
      'authenticator settings a step overrides.',
    routeKey: tenantGet('/flows/:id'),
    capability: 'manage-tenant',
    shape: { id: idField('flow') },
    pathParams: ['id'],
    response: flowSchema,
  }),
];
