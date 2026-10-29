import { putSmtpRequestSchema, testSmtpRequestSchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type MailLookResolver } from '@odudu/email';
import { readPasswordField } from '@odudu/kernel';
import { etagOf } from '#/service/etag';
import { type SmtpDestinationPolicy } from '#/service/smtp-destination';
import {
  deleteSmtp,
  putSmtp,
  readSmtp,
  readSmtpForTest,
  sendTestMessage,
  auditSmtpTest,
  type Audit,
  type SmtpTestResult,
  type SmtpPasswordChange,
} from '#/usecase/smtp';
import { fieldProblem, ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { recordCapabilityRefused } from '#/usecase/access-audit';
import { recordRefusal, type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

function tenantNameOf(request: AdminRequest): string {
  const name = request.params.tenant;
  if (name === undefined) throw new Error('protocol-admin: the SMTP test received no :tenant');
  return name;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

export interface SmtpRouteDeps {
  readonly database: Database;
  readonly kek: Uint8Array;
  readonly audit: Audit;
  /** Where this server is willing to open an SMTP connection — see `#/service/smtp-destination.ts`. */
  readonly smtpDestination: SmtpDestinationPolicy;
  /** Whether the deployment has a sender of its own, which a tenant without one falls back to. */
  readonly deploymentSmtp: boolean;
  readonly now: () => Date;
  /** The tenant's wording, which the test mail is read through like any other. */
  readonly resolveMailLook?: MailLookResolver | undefined;
  /** What the caller holds, for the capability a chosen client adds. */
  callerCapabilities(issuerTenantId: string, subjectId: string): Promise<ReadonlySet<string>>;
}

export function readSmtpHandler(deps: SmtpRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const config = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readSmtp(tx, targetTenantId, deps.deploymentSmtp),
    );
    reply.header('etag', etagOf(config));
    return reply.code(200).send(config);
  };
}

export function putSmtpHandler(deps: SmtpRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = putSmtpRequestSchema.parse(request.body);

    // Read through the one function every password field goes through
    // (tests/lint/password-read-through-kernel.test.ts), which also bounds
    // it the same way a sign-in candidate is bounded.
    const passwordField = readPasswordField(body.password ?? undefined);
    if (passwordField.kind === 'too_long') {
      return sendProblem(
        reply,
        request,
        fieldProblem(
          [{ path: 'password', message: 'exceeds the maximum length' }],
          'password exceeds the maximum length',
        ),
      );
    }

    // Sent as `null`, the field is present and reads as absent.
    const password: SmtpPasswordChange =
      passwordField.kind === 'present'
        ? { kind: 'set', password: passwordField.password }
        : Object.hasOwn(body, 'password')
          ? { kind: 'clear' }
          : { kind: 'keep' };

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      putSmtp(
        tx,
        { audit: deps.audit, kek: deps.kek, deploymentSmtp: deps.deploymentSmtp },
        {
          tenantId: targetTenantId,
          ifMatch: ifMatchHeader(request),
          host: body.host,
          port: body.port,
          fromAddress: body.from_address,
          username: body.username ?? null,
          password,
          starttls: body.starttls ?? false,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    if (outcome.kind === 'precondition_failed') {
      return sendProblem(reply, request, ifMatchStale());
    }
    if (outcome.kind === 'password_required') {
      return sendProblem(
        reply,
        request,
        fieldProblem(
          [
            {
              path: 'password',
              message: 'must be sent again when host, port or username changes',
            },
          ],
          'password must be sent again when host, port or username changes',
        ),
      );
    }
    if (outcome.kind === 'starttls_required') {
      return sendProblem(
        reply,
        request,
        fieldProblem(
          [{ path: 'starttls', message: 'must be true when a username or password is configured' }],
          'starttls must be true when a username or password is configured',
        ),
      );
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.config);
  };
}

export function deleteSmtpHandler(deps: SmtpRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      deleteSmtp(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    // 404 rather than a silent 204: the caller asked for a configuration
    // to be removed and there was none, which is worth being told.
    if (outcome.kind === 'not_configured') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', 'this tenant has no SMTP configuration'),
      );
    }
    return reply.code(204).send();
  };
}

export function testSmtpHandler(deps: SmtpRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const record = (result: SmtpTestResult): Promise<void> =>
      adminTx(deps.database, request, targetTenantId, (tx) =>
        auditSmtpTest(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            result,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    const body = testSmtpRequestSchema.parse(request.body);

    // Read inside the tenant transaction, then release it before sending —
    // an unreachable or slow SMTP host must never hold a pooled connection
    // for the length of the attempt.
    // Choosing a client reads a client's theme, which is manage-clients
    // wherever else it is read, on top of the route's own capability.
    if (body.client_id !== undefined) {
      const held = await deps.callerCapabilities(principal.issuerTenantId, principal.subjectId);
      if (!held.has('manage-clients')) {
        await recordRefusal(deps.database, request, targetTenantId, (tx) =>
          recordCapabilityRefused(tx, principal, 'manage-clients'),
        );
        return sendProblem(reply, request, problem(403, 'about:blank', 'Forbidden'));
      }
    }
    const readOutcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readSmtpForTest(
        tx,
        { tenantId: targetTenantId, tenantName: tenantNameOf(request) },
        deps.resolveMailLook,
        body.client_id,
      ),
    );
    if (readOutcome.kind === 'client_not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    }
    if (readOutcome.kind === 'not_configured') {
      await record('not_configured');
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'this tenant has no SMTP configuration'),
      );
    }

    const sendOutcome = await sendTestMessage(readOutcome.record, deps.kek, deps.smtpDestination, {
      to: body.to,
      tenantDisplayName: readOutcome.tenantDisplayName,
      now: deps.now(),
      ...readOutcome.wording,
    });
    switch (sendOutcome.kind) {
      case 'refused_destination':
        await record('refused_destination');
        return sendProblem(
          reply,
          request,
          problem(400, 'about:blank', 'Bad Request', sendOutcome.reason),
        );
      case 'send_failed':
        await record('send_failed');
        return sendProblem(
          reply,
          request,
          problem(502, 'about:blank', 'Bad Gateway', sendOutcome.detail),
        );
      case 'sent':
        await record('sent');
        return reply.code(200).send({ sent: true });
    }
  };
}
