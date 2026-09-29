import { amendSettingsRequestSchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import {
  amendSettings,
  AmendSettingsRefusedError,
  readSettings,
  type AmendSettingsOutcome,
  type Audit,
} from '#/usecase/settings';
import { fieldProblem, problem, sendProblem, type Problem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { endSessionsAfterDisable } from '#/view/routes/disabled-tenant-sessions';
import { type EndDisabledTenantSessionsDeps } from '#/usecase/end-sessions';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface SettingsRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  readonly kek: Uint8Array;
  readonly now: () => Date;
  readonly sessionsAudit: EndDisabledTenantSessionsDeps['audit'];
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

function settingValueProblem(
  outcome: Extract<AmendSettingsOutcome, { kind: 'invalid_value' }>,
): Problem {
  const expects =
    outcome.values === undefined
      ? `expects ${outcome.expected === 'integer' ? 'an integer' : `a ${outcome.expected}`}`
      : `must be one of ${outcome.values.join(', ')}`;
  return fieldProblem(
    [{ path: outcome.name, message: expects }],
    `tenant setting ${outcome.name} ${expects}`,
  );
}

export function getSettingsHandler(deps: SettingsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const { settings, etag } = await adminTx(deps.database, request, targetTenantId, (tx) =>
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
      outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
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
          fieldProblem(
            error.settingNames.map((name) => ({ path: name, message: 'refused that value' })),
            error.message,
          ),
        );
      }
      throw error;
    }

    switch (outcome.kind) {
      case 'unknown_setting':
        return sendProblem(
          reply,
          request,
          fieldProblem(
            [{ path: outcome.name, message: 'is not a tenant setting' }],
            `unknown tenant setting ${JSON.stringify(outcome.name)}; expected one of ${outcome.known.join(', ')}`,
          ),
        );
      case 'invalid_value':
        return sendProblem(reply, request, settingValueProblem(outcome));
      case 'out_of_range':
        return sendProblem(
          reply,
          request,
          fieldProblem(
            outcome.problems.map(({ name, message }) => ({ path: name, message })),
            `${String(outcome.problems.length)} tenant setting(s) outside the permitted range, listed under errors`,
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
      case 'amended': {
        if (body.enabled === false) {
          const failed = await endSessionsAfterDisable(deps, request, principal, targetTenantId);
          if (failed !== null) return sendProblem(reply, request, failed);
        }
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.settings);
      }
    }
  };
}
