import {
  type ListThemeVersionsResponse,
  type PublishThemeResponse,
  type PutThemeRequest,
  type ThemeView,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import {
  discardDraft,
  listVersions,
  publishDraft,
  readTheme,
  resetTheme,
  restoreVersion,
  saveDraft,
  type Actor,
  type Audit,
  type ThemeDeps,
  type ThemeTarget,
  type ThemeViewResult,
} from '#/usecase/theme';
import { fieldProblem, ifMatchRequired, ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface ThemeRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  readonly isMessageKey: ThemeDeps['isMessageKey'];
  // Drops the tenant's cached themes in this process, once a publish, a
  // restore or a reset has committed.
  readonly invalidateTenant: (tenantId: string) => void;
}

export interface ThemeHandlers {
  readonly read: AdminRouteHandler;
  readonly put: AdminRouteHandler;
  readonly publish: AdminRouteHandler;
  readonly versions: AdminRouteHandler;
  readonly restore: AdminRouteHandler;
  readonly reset: AdminRouteHandler;
  readonly discard: AdminRouteHandler;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

function wireView(view: ThemeViewResult): ThemeView {
  return {
    scope: view.scope,
    draft: view.draft,
    published:
      view.published === null
        ? null
        : {
            id: view.published.id,
            version: view.published.version,
            published_at: view.published.publishedAt?.toISOString() ?? null,
            body: view.published.body,
          },
    sources: view.sources,
    draft_sources: view.draftSources,
    tenant_sources: view.tenantSources,
    changed: view.changed,
  };
}

function sendView(
  reply: FastifyReply,
  view: ThemeViewResult,
  warnings?: PublishThemeResponse['warnings'],
): FastifyReply {
  if (view.draftEtag !== null) reply.header('etag', `"${view.draftEtag}"`);
  const body: ThemeView | PublishThemeResponse =
    warnings === undefined ? wireView(view) : { ...wireView(view), warnings };
  return reply.code(200).send(body);
}

const NOT_FOUND = problem(404, 'about:blank', 'Not Found');

function notFound(reply: FastifyReply, request: AdminRequest): FastifyReply {
  return sendProblem(reply, request, NOT_FOUND);
}

function invalid(
  reply: FastifyReply,
  request: AdminRequest,
  errors: Parameters<typeof fieldProblem>[0],
  summary: string,
): FastifyReply {
  return sendProblem(reply, request, fieldProblem(errors, summary));
}

// One set of handlers for a scope: the tenant's own theme, or a client's,
// which differ only in whose row the theme is.
export function themeHandlers(deps: ThemeRouteDeps, scope: 'tenant' | 'client'): ThemeHandlers {
  const usecaseDeps: ThemeDeps = { audit: deps.audit, isMessageKey: deps.isMessageKey };

  function targetOf(request: AdminRequest, tenantId: string): ThemeTarget {
    const tenantName = request.params.tenant;
    const clientRowId = scope === 'client' ? request.params.id : null;
    if (tenantName === undefined || (scope === 'client' && clientRowId === undefined)) {
      throw new Error('protocol-admin: a theme route received no :tenant or :id');
    }
    return { tenantId, tenantName, clientRowId: clientRowId ?? null };
  }

  const actorOf = (principal: Parameters<AdminRouteHandler>[2]): Actor => ({
    actorSubjectId: principal.subjectId,
    actorTenantId: principal.issuerTenantId,
    actorClientId: principal.clientDbId,
  });

  return {
    read: async (request, reply, _principal, tenantId) => {
      const target = targetOf(request, tenantId);
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        readTheme(tx, target),
      );
      return outcome.kind === 'not_found'
        ? notFound(reply, request)
        : sendView(reply, outcome.view);
    },

    put: async (request, reply, principal, tenantId) => {
      const target = targetOf(request, tenantId);
      // Fastify's validator already checked the body against the same schema.
      const body = request.body as PutThemeRequest;
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        saveDraft(tx, usecaseDeps, target, actorOf(principal), {
          body,
          ifMatch: ifMatchHeader(request),
        }),
      );
      switch (outcome.kind) {
        case 'not_found':
          return notFound(reply, request);
        case 'precondition_required':
          return sendProblem(
            reply,
            request,
            ifMatchRequired('the draft theme', request.headers['if-match']),
          );
        case 'precondition_failed':
          return sendProblem(reply, request, ifMatchStale());
        case 'invalid':
          return invalid(
            reply,
            request,
            outcome.errors,
            `the theme was not saved: ${String(outcome.errors.length)} problem(s), listed under errors`,
          );
        case 'saved':
          return sendView(reply, outcome.view);
      }
    },

    publish: async (request, reply, principal, tenantId) => {
      const target = targetOf(request, tenantId);
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        publishDraft(tx, usecaseDeps, target, actorOf(principal), {
          ifMatch: ifMatchHeader(request),
        }),
      );
      switch (outcome.kind) {
        case 'not_found':
          return notFound(reply, request);
        case 'no_draft':
          return sendProblem(
            reply,
            request,
            problem(409, 'about:blank#theme-no-draft', 'Conflict', 'there is no draft to publish'),
          );
        case 'nothing_to_publish':
          return sendProblem(
            reply,
            request,
            problem(
              409,
              'about:blank#theme-nothing-to-publish',
              'Conflict',
              'the draft matches the published theme, so there is nothing to publish',
            ),
          );
        case 'precondition_failed':
          return sendProblem(reply, request, ifMatchStale());
        case 'invalid':
          return invalid(
            reply,
            request,
            outcome.errors,
            `the theme was not published: ${String(outcome.errors.length)} problem(s), listed under errors`,
          );
        case 'published':
          deps.invalidateTenant(tenantId);
          return sendView(reply, outcome.view, outcome.warnings);
      }
    },

    versions: async (request, reply, _principal, tenantId) => {
      const target = targetOf(request, tenantId);
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        listVersions(tx, target),
      );
      if (outcome.kind === 'not_found') return notFound(reply, request);
      const body: ListThemeVersionsResponse = {
        items: outcome.items.map((item) => ({
          id: item.id,
          version: item.version,
          state: item.state,
          created_at: item.createdAt.toISOString(),
          published_at: item.publishedAt?.toISOString() ?? null,
        })),
      };
      return reply.code(200).send(body);
    },

    restore: async (request, reply, principal, tenantId) => {
      const target = targetOf(request, tenantId);
      const versionId = request.params.versionId;
      if (versionId === undefined) throw new Error('protocol-admin: restore received no version');
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        restoreVersion(tx, usecaseDeps, target, actorOf(principal), { versionId }),
      );
      switch (outcome.kind) {
        case 'not_found':
        case 'version_not_found':
          return notFound(reply, request);
        case 'assets_missing':
          return sendProblem(reply, request, {
            ...problem(
              409,
              'about:blank#theme-assets-missing',
              'Conflict',
              'the version names images that no longer exist, so it cannot be restored whole',
            ),
            errors: outcome.errors,
          });
        case 'fails_checks':
          return sendProblem(reply, request, {
            ...problem(
              409,
              'about:blank#theme-version-fails-checks',
              'Conflict',
              'the version has pieces that fail today’s checks, so it cannot be restored; errors lists them',
            ),
            errors: outcome.errors,
          });
        case 'restored':
          deps.invalidateTenant(tenantId);
          return sendView(reply, outcome.view);
      }
    },

    discard: async (request, reply, principal, tenantId) => {
      const target = targetOf(request, tenantId);
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        discardDraft(tx, usecaseDeps, target, actorOf(principal), {
          ifMatch: ifMatchHeader(request),
        }),
      );
      switch (outcome.kind) {
        case 'not_found':
          return notFound(reply, request);
        case 'precondition_required':
          return sendProblem(
            reply,
            request,
            ifMatchRequired('the draft theme', request.headers['if-match']),
          );
        case 'precondition_failed':
          return sendProblem(reply, request, ifMatchStale());
        case 'discarded':
          return sendView(reply, outcome.view);
      }
    },

    reset: async (request, reply, principal, tenantId) => {
      const target = targetOf(request, tenantId);
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        resetTheme(tx, usecaseDeps, target, actorOf(principal)),
      );
      if (outcome.kind === 'not_found') return notFound(reply, request);
      deps.invalidateTenant(tenantId);
      return sendView(reply, outcome.view);
    },
  };
}
