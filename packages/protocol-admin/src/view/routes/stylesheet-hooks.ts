import { stylesheetHooks } from '#/service/stylesheet-hooks';
import { type AdminRouteHandler } from '#/view/routes/router';

// The same answer for every tenant and every call, so there is nothing to read.
export const stylesheetHooksHandler: AdminRouteHandler = (_request, reply) =>
  reply.code(200).send(stylesheetHooks());
