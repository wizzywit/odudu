import { previewThemeQuerySchema, type PreviewThemeQuery } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { previewHeaders } from '@odudu/kernel';
import { issuerBaseFor } from '@odudu/protocol-oidc';
import { previewInfo, previewTheme, type ThemePreviewDeps } from '#/usecase/theme-preview';
import { type ThemeTarget } from '#/usecase/theme';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface ThemePreviewRouteDeps extends ThemePreviewDeps {
  readonly database: Database;
}

// The scope a request addresses, and what to preview of it: the tenant's draft
// or a client's, which differ only in whose row it is.
function previewRequest(
  request: Parameters<AdminRouteHandler>[0],
  tenantId: string,
  scope: 'tenant' | 'client',
): { target: ThemeTarget; input: { query: PreviewThemeQuery; origin: string } } {
  const tenantName = request.params.tenant;
  const clientRowId = scope === 'client' ? request.params.id : undefined;
  if (tenantName === undefined || (scope === 'client' && clientRowId === undefined)) {
    throw new Error('protocol-admin: a theme preview route received no :tenant or :id');
  }
  return {
    target: { tenantId, tenantName, clientRowId: clientRowId ?? null },
    input: {
      query: previewThemeQuerySchema.parse(request.query),
      origin: new URL(issuerBaseFor(request)).origin,
    },
  };
}

// One handler for a scope, like the theme routes beside it.
export function themePreviewHandler(
  deps: ThemePreviewRouteDeps,
  scope: 'tenant' | 'client',
): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const { target, input } = previewRequest(request, tenantId, scope);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      previewTheme(tx, deps, target, input),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    }
    if (outcome.kind === 'too_large') {
      return sendProblem(
        reply,
        request,
        problem(
          422,
          'about:blank#theme-preview-too-large',
          'Unprocessable Content',
          `the draft's stylesheet and images come to ${String(outcome.bytes)} bytes once inlined, over the ${String(outcome.limit)} bytes a preview carries`,
        ),
      );
    }
    reply.code(200).header('content-type', 'text/html; charset=utf-8');
    for (const [name, value] of previewHeaders(outcome.inlined)) reply.header(name, value);
    if (outcome.inlined.scriptOmitted) reply.header('x-odudu-preview-script', 'omitted');
    if (outcome.fallbacks.length > 0) {
      reply.header('x-odudu-preview-fallback', outcome.fallbacks.join(','));
    }
    return reply.send(outcome.inlined.html);
  };
}

// What the preview of the same request shows and why, for a console that
// frames the preview and cannot read its headers.
export function themePreviewInfoHandler(
  deps: ThemePreviewRouteDeps,
  scope: 'tenant' | 'client',
): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const { target, input } = previewRequest(request, tenantId, scope);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      previewInfo(tx, deps, target, input),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    }
    return reply.code(200).header('cache-control', 'no-store').send(outcome.info);
  };
}
