import {
  type FieldError,
  type ThemeAsset,
  type UploadThemeAssetQuery,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type AssetReference, type UploadRefusalCode } from '@odudu/domain-theme';
import { servedAssetHeaders } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { BUSY_RETRY_SECONDS, uploadLimitsFor, type UploadLimits } from '#/service/theme-assets';
import { type Actor } from '#/usecase/theme';
import {
  deleteThemeAsset,
  readThemeAssetContent,
  uploadThemeAsset,
  type Audit,
  type ThemeAssetDeps,
} from '#/usecase/theme-assets';
import { problem, sendProblem, type Problem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface ThemeAssetRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  readonly inspect?: ThemeAssetDeps['inspect'];
}

export interface ThemeAssetHandlers {
  readonly upload: AdminRouteHandler;
  readonly remove: AdminRouteHandler;
  readonly content: AdminRouteHandler;
}

// What a refusal says; never the decoder's own words, which could quote the
// file. The statuses are the ones `ADMIN_PROBLEM_TYPES` lists for each type.
function refusalProblem(code: UploadRefusalCode, limits: UploadLimits): Problem {
  switch (code) {
    case 'unsupported_type':
      return problem(
        415,
        'about:blank#asset-unsupported-type',
        'Unsupported Media Type',
        'the image is not a PNG, a JPEG or a WebP',
      );
    case 'animated':
      return problem(
        422,
        'about:blank#asset-animated',
        'Unprocessable Content',
        'an animated image is not accepted',
      );
    case 'corrupt':
    case 'empty':
      return problem(
        422,
        'about:blank#asset-corrupt',
        'Unprocessable Content',
        'the image could not be read',
      );
    case 'too_many_pixels':
    case 'too_wide':
      return problem(
        422,
        'about:blank#asset-dimensions',
        'Unprocessable Content',
        `the image is larger than ${String(limits.side)} pixels on its longer side, or has too many pixels`,
      );
    case 'timeout':
      return problem(
        422,
        'about:blank#asset-timeout',
        'Unprocessable Content',
        'the image took too long to decode',
      );
    case 'too_large':
      return problem(
        413,
        'about:blank#asset-too-large',
        'Content Too Large',
        `the image is larger than ${limits.bytes} for this kind, as uploaded or once re-encoded`,
      );
    case 'over_cap':
      return problem(
        409,
        'about:blank#asset-cap',
        'Conflict',
        'the tenant’s stored images would pass 8 MiB; delete one that no theme names',
      );
    case 'busy':
      return problem(
        503,
        'about:blank#asset-busy',
        'Service Unavailable',
        'the server is decoding as many images as it will at once; try again shortly',
      );
  }
}

function referenceErrors(references: readonly AssetReference[]): FieldError[] {
  return references.map((reference) => ({
    path: reference.clientId === null ? 'theme' : `clients/${reference.clientId}/theme`,
    message:
      reference.state === 'draft'
        ? `named by the draft ${reference.versionId}`
        : `named by published version ${String(reference.version)} (${reference.versionId})`,
  }));
}

function sendRefusal(
  reply: FastifyReply,
  request: AdminRequest,
  code: UploadRefusalCode,
  limits: UploadLimits,
): FastifyReply {
  if (code === 'busy') reply.header('retry-after', String(BUSY_RETRY_SECONDS));
  return sendProblem(reply, request, refusalProblem(code, limits));
}

export function themeAssetHandlers(deps: ThemeAssetRouteDeps): ThemeAssetHandlers {
  const usecaseDeps: ThemeAssetDeps = {
    audit: deps.audit,
    ...(deps.inspect === undefined ? {} : { inspect: deps.inspect }),
  };
  const actorOf = (principal: Parameters<AdminRouteHandler>[2]): Actor => ({
    actorSubjectId: principal.subjectId,
    actorTenantId: principal.issuerTenantId,
    actorClientId: principal.clientDbId,
  });

  return {
    upload: async (request, reply, principal, tenantId) => {
      const query = request.query as UploadThemeAssetQuery;
      const bytes: unknown = request.body;
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        return sendProblem(
          reply,
          request,
          problem(400, 'about:blank', 'Bad Request', 'the request body is the image, and is empty'),
        );
      }
      const outcome = await uploadThemeAsset(
        usecaseDeps,
        (fn) => adminTx(deps.database, request, tenantId, fn),
        actorOf(principal),
        { tenantId, kind: query.kind, bytes },
      );
      if (outcome.kind === 'refused') {
        return sendRefusal(reply, request, outcome.refusal.code, uploadLimitsFor(query.kind));
      }
      const asset: ThemeAsset = outcome.asset;
      return reply.code(201).send(asset);
    },

    content: async (request, reply, _principal, tenantId) => {
      const assetId = request.params.assetId;
      if (assetId === undefined) throw new Error('protocol-admin: asset read received no id');
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        readThemeAssetContent(tx, { tenantId, assetId }),
      );
      if (outcome.kind === 'not_found') {
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      }
      for (const [name, value] of servedAssetHeaders('same-origin')) reply.header(name, value);
      return reply
        .code(200)
        .header('content-type', outcome.mime)
        .header('cache-control', 'private, no-store')
        .send(outcome.bytes);
    },

    remove: async (request, reply, principal, tenantId) => {
      const assetId = request.params.assetId;
      if (assetId === undefined) throw new Error('protocol-admin: asset delete received no id');
      const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
        deleteThemeAsset(tx, usecaseDeps, actorOf(principal), { tenantId, assetId }),
      );
      switch (outcome.kind) {
        case 'not_found':
          return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
        case 'in_use':
          return sendProblem(reply, request, {
            ...problem(
              409,
              'about:blank#asset-in-use',
              'Conflict',
              outcome.more
                ? 'a theme still names the image, more than errors lists'
                : 'a theme still names the image',
            ),
            errors: referenceErrors(outcome.references),
          });
        case 'deleted':
          return reply.code(204).send();
      }
    },
  };
}
