import { putSmtpRequestSchema, testSmtpRequestSchema } from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { readPasswordField } from '@odudu/kernel';
import { putSmtp, readSmtp, readSmtpForTest, sendTestMessage, type Audit } from '#/usecase/smtp';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface SmtpRouteDeps {
  readonly database: Database;
  readonly kek: Uint8Array;
  readonly audit: Audit;
}

export function readSmtpHandler(deps: SmtpRouteDeps): AdminRouteHandler {
  return async (_request, reply, _principal, targetTenantId) => {
    const config = await withTenant(deps.database, targetTenantId, (tx) =>
      readSmtp(tx, targetTenantId),
    );
    return reply.code(200).send(config);
  };
}

export function putSmtpHandler(deps: SmtpRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = putSmtpRequestSchema.parse(request.body);

    // Read through the one function every password field goes through
    // (tests/lint/password-read-through-kernel.test.ts), which also bounds
    // it the same way a sign-in candidate is bounded — `null` and omitted
    // both mean "no password", so both read as absent here.
    const passwordField = readPasswordField(body.password ?? undefined);
    if (passwordField.kind === 'too_long') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'password exceeds the maximum length'),
      );
    }

    const config = await withTenant(deps.database, targetTenantId, (tx) =>
      putSmtp(
        tx,
        { audit: deps.audit, kek: deps.kek },
        {
          tenantId: targetTenantId,
          host: body.host,
          port: body.port,
          fromAddress: body.from_address,
          username: body.username ?? null,
          password: passwordField.kind === 'present' ? passwordField.password : null,
          starttls: body.starttls ?? false,
          actorSubjectId: principal.subjectId,
        },
      ),
    );

    return reply.code(200).send(config);
  };
}

export function testSmtpHandler(deps: SmtpRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const body = testSmtpRequestSchema.parse(request.body);

    // Read inside the tenant transaction, then release it before sending —
    // an unreachable or slow SMTP host must never hold a pooled connection
    // for the length of the attempt.
    const readOutcome = await withTenant(deps.database, targetTenantId, (tx) =>
      readSmtpForTest(tx, targetTenantId),
    );
    if (readOutcome.kind === 'not_configured') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'this tenant has no SMTP configuration'),
      );
    }

    const sendOutcome = await sendTestMessage(readOutcome.record, deps.kek, body.to);
    switch (sendOutcome.kind) {
      case 'send_failed':
        return sendProblem(
          reply,
          request,
          problem(502, 'about:blank', 'Bad Gateway', sendOutcome.detail),
        );
      case 'sent':
        return reply.code(200).send({ sent: true });
    }
  };
}
