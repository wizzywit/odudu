import { amendSettingsRequestSchema } from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import {
  amendSettings,
  AmendSettingsRefusedError,
  readSettings,
  type AmendSettingsOutcome,
  type Audit,
} from '#/usecase/settings';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface SettingsRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

export function getSettingsHandler(deps: SettingsRouteDeps): AdminRouteHandler {
  return async (_request, reply, _principal, targetTenantId) => {
    const { settings, etag } = await withTenant(deps.database, targetTenantId, (tx) =>
      readSettings(tx, targetTenantId),
    );
    reply.header('etag', etag);
    return reply.code(200).send(settings);
  };
}

export function amendSettingsHandler(deps: SettingsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    // Fastify's ajv compiler already validated `request.body` against this
    // same schema (ADMIN_ROUTES' `bodySchema`); parsing again only narrows
    // the type — it cannot fail.
    const body = amendSettingsRequestSchema.parse(request.body);

    let outcome: AmendSettingsOutcome;
    try {
      outcome = await withTenant(deps.database, targetTenantId, (tx) =>
        amendSettings(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            values: body,
            ifMatch: ifMatchHeader(request),
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      // The transaction has already rolled back by the time this is
      // caught (AmendSettingsRefusedError, #/usecase/settings.ts) — nothing
      // here reads or writes through `tx` again.
      if (error instanceof AmendSettingsRefusedError) {
        return sendProblem(
          reply,
          request,
          problem(400, 'about:blank', 'Bad Request', error.message),
        );
      }
      throw error;
    }

    switch (outcome.kind) {
      case 'unknown_setting':
        return sendProblem(
          reply,
          request,
          problem(
            400,
            'about:blank',
            'Bad Request',
            `unknown tenant setting ${JSON.stringify(outcome.name)}; expected one of ${outcome.known.join(', ')}`,
          ),
        );
      case 'invalid_value':
        return sendProblem(
          reply,
          request,
          problem(
            400,
            'about:blank',
            'Bad Request',
            `tenant setting ${outcome.name} expects ${outcome.expected === 'integer' ? 'an integer' : `a ${outcome.expected}`}`,
          ),
        );
      case 'system_tenant_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'precondition_failed':
        return sendProblem(
          reply,
          request,
          problem(412, 'about:blank', 'Precondition Failed', 'If-Match no longer matches'),
        );
      case 'amended':
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.settings);
    }
  };
}
