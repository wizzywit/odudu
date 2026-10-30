import { type FieldError, type PutThemeRequest } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { clientRepository } from '@odudu/domain-tenant';
import {
  assetIdsOf,
  assetPath,
  assetRepository,
  checkStylesheet,
  checkTemplate,
  contrastFailures,
  parseThemeBody,
  changedPieces,
  pieceSources,
  themeRepository,
  THEME_VERSION_LIMIT,
  type AssetRef,
  type BodyIssue,
  type DiffPiece,
  type PieceName,
  type ThemeBody,
  type ThemeScope,
  type ThemeVersionSummary,
} from '@odudu/domain-theme';
import { PAGE_KINDS, type PageKind } from '@odudu/kernel';
import { hasPrecondition, matches, requiredPrecondition } from '#/service/etag';
import { fieldPath } from '#/service/field-path';
import {
  contrastErrors,
  missingAssetErrors,
  stylesheetErrors,
  templateErrors,
  themeWarnings,
  type ThemeWarning,
} from '#/service/theme-issues';

export interface ThemeAuditEvent {
  readonly action:
    | 'theme.draft_saved'
    | 'theme.draft_discarded'
    | 'theme.published'
    | 'theme.restored'
    | 'theme.reset';
  readonly resourceType: 'theme';
  // The tenant for its own theme, the client's row id for a client's.
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts`: the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: ThemeAuditEvent) => Promise<void>;

export interface ThemeDeps {
  readonly audit: Audit;
  // Whether `{{t "key"}}` names an entry of the catalogue the kind's page is
  // filled from.
  readonly isMessageKey: (kind: PageKind, key: string) => boolean;
}

export interface ThemeTarget {
  readonly tenantId: string;
  readonly tenantName: string;
  // The client's row id, or null for the tenant's own theme.
  readonly clientRowId: string | null;
}

export interface Actor {
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

type Source = 'client' | 'tenant' | 'default';

export interface ThemeViewResult {
  readonly scope: 'tenant' | 'client';
  readonly draft: ThemeBody | null;
  readonly published: {
    readonly id: string;
    readonly version: number;
    readonly publishedAt: Date | null;
    readonly body: ThemeBody;
  } | null;
  readonly sources: Record<string, Source>;
  readonly draftSources: Record<string, Source> | null;
  // The parts of the draft that differ from the scope's own published body.
  readonly changed: DiffPiece[];
  // What the tenant's published theme supplies, for a client's view; null for the tenant's own.
  readonly tenantSources: Record<string, Source> | null;
  // The draft's validator, for the `ETag` header; null without a draft.
  readonly draftEtag: string | null;
}

// A refusal lists at most this many problems; the first are the ones to fix.
export const MAX_THEME_ERRORS = 100;

const MESSAGE_KINDS = new Set(Object.keys(PAGE_KINDS));

function scopeOf(target: ThemeTarget): ThemeScope {
  return { tenantId: target.tenantId, clientId: target.clientRowId };
}

export async function clientExists(
  tx: TenantScopedDatabase,
  target: ThemeTarget,
): Promise<boolean> {
  if (target.clientRowId === null) return true;
  return (await clientRepository(tx).byId(target.clientRowId)) !== null;
}

function sourcesOf(
  layers: readonly (ThemeBody | null)[],
  names: readonly Source[],
): Record<string, Source> {
  const sources = pieceSources(layers);
  const named: Record<string, Source> = {};
  for (const piece of Object.keys(sources) as PieceName[]) {
    const index = sources[piece];
    named[piece] = index === null ? 'default' : (names[index] ?? 'default');
  }
  return named;
}

async function viewOf(tx: TenantScopedDatabase, target: ThemeTarget): Promise<ThemeViewResult> {
  const themes = themeRepository(tx);
  const scope = scopeOf(target);
  const client = target.clientRowId !== null;
  const draft = await themes.draft(scope);
  const published = await themes.published(scope);
  const tenant = client
    ? await themes.published({ tenantId: target.tenantId, clientId: null })
    : null;
  const names: Source[] = client ? ['client', 'tenant'] : ['tenant'];
  const below = client ? [tenant?.body ?? null] : [];
  return {
    scope: client ? 'client' : 'tenant',
    draft: draft?.body ?? null,
    published:
      published === null
        ? null
        : {
            id: published.id,
            version: published.version,
            publishedAt: published.publishedAt,
            body: published.body,
          },
    sources: sourcesOf([published?.body ?? null, ...below], names),
    draftSources: draft === null ? null : sourcesOf([draft.body, ...below], names),
    changed: changedPieces(draft?.body ?? null, published?.body ?? null),
    tenantSources: client ? sourcesOf([tenant?.body ?? null], ['tenant']) : null,
    draftEtag: draft?.etag ?? null,
  };
}

export type ReadThemeOutcome = { kind: 'not_found' } | { kind: 'ok'; view: ThemeViewResult };

export async function readTheme(
  tx: TenantScopedDatabase,
  target: ThemeTarget,
): Promise<ReadThemeOutcome> {
  if (!(await clientExists(tx, target))) return { kind: 'not_found' };
  return { kind: 'ok', view: await viewOf(tx, target) };
}

// A body issue's pointer as the path every field error spells.
function bodyIssueErrors(issues: readonly BodyIssue[]): FieldError[] {
  const MESSAGES: Record<BodyIssue['code'], string> = {
    type: 'Has the wrong type.',
    format: 'Is not in the expected format.',
    required: 'Is required or may not be empty.',
    too_large: 'Is larger than the limit.',
    unknown_key: 'Is not a theme field.',
  };
  return issues.map((issue) => ({
    path: fieldPath(issue.path.split('/').slice(1)),
    message: MESSAGES[issue.code],
    code: issue.code,
  }));
}

const SLOTS = ['logo', 'darkLogo', 'favicon', 'background'] as const;

interface HeldAssets {
  readonly urls: Set<string>;
  readonly missing: { path: string; assetId: string }[];
}

// The images the body names, held against deletion until the transaction
// ends. An id the tenant has no image for is reported by its slot.
async function holdAssets(
  tx: TenantScopedDatabase,
  target: ThemeTarget,
  body: ThemeBody,
): Promise<HeldAssets> {
  const held: AssetRef[] = await assetRepository(tx).hold(target.tenantId, assetIdsOf(body.assets));
  const byId = new Map(held.map((asset) => [asset.id, asset]));
  const urls = new Set<string>();
  const missing: { path: string; assetId: string }[] = [];
  for (const slot of SLOTS) {
    const named = body.assets[slot];
    if (named === undefined) continue;
    const asset = byId.get(named.assetId);
    const url = asset === undefined ? null : assetPath(target.tenantName, asset.sha256, asset.mime);
    if (url === null) missing.push({ path: `assets.${slot}.assetId`, assetId: named.assetId });
    else urls.add(url);
  }
  return { urls, missing };
}

// The checks the renderer repeats when it reads the theme back: every
// template and the stylesheet, against the theme's own images and the
// catalogue of the package that fills the kind.
function pieceErrors(body: ThemeBody, held: HeldAssets, deps: ThemeDeps): FieldError[] {
  const isAssetUrl = (url: string): boolean => held.urls.has(url);
  const errors: FieldError[] = [];
  for (const [kind, template] of Object.entries(body.templates)) {
    if (!MESSAGE_KINDS.has(kind)) continue;
    const pageKind = kind as PageKind;
    const issues = checkTemplate(pageKind, template, {
      isAssetUrl,
      isMessageKey: (key) => deps.isMessageKey(pageKind, key),
    });
    errors.push(...templateErrors(kind, issues));
  }
  if (body.stylesheet !== null) {
    errors.push(...stylesheetErrors(checkStylesheet(body.stylesheet, { isAssetUrl })));
  }
  return errors;
}

export type SaveDraftOutcome =
  | { kind: 'not_found' }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'saved'; view: ThemeViewResult };

export async function saveDraft(
  tx: TenantScopedDatabase,
  deps: ThemeDeps,
  target: ThemeTarget,
  actor: Actor,
  input: { body: PutThemeRequest; ifMatch: string | undefined },
): Promise<SaveDraftOutcome> {
  if (!(await clientExists(tx, target))) return { kind: 'not_found' };
  const parsed = parseThemeBody(input.body);
  if (!parsed.ok) return { kind: 'invalid', errors: bodyIssueErrors(parsed.issues) };

  const themes = themeRepository(tx);
  const scope = scopeOf(target);
  const current = await themes.lockDraft(scope);
  // The first draft needs no version to name, and one that names a draft
  // which is gone names a version that no longer exists.
  if (current === null && input.ifMatch !== undefined) return { kind: 'precondition_failed' };
  if (current !== null) {
    const precondition = requiredPrecondition(input.ifMatch, `"${current.etag}"`);
    if (precondition === 'required') return { kind: 'precondition_required' };
    if (precondition === 'failed') return { kind: 'precondition_failed' };
  }

  const held = await holdAssets(tx, target, parsed.body);
  const errors = [...missingAssetErrors(held.missing), ...pieceErrors(parsed.body, held, deps)];
  if (errors.length > 0) return { kind: 'invalid', errors: errors.slice(0, MAX_THEME_ERRORS) };

  const saved = await themes.saveDraft(scope, parsed.body, current?.etag ?? null);
  if (saved === 'precondition_failed') return { kind: 'precondition_failed' };
  await deps.audit(tx, {
    action: 'theme.draft_saved',
    resourceType: 'theme',
    resourceId: target.clientRowId ?? target.tenantId,
    ...actor,
    outcome: 'allowed',
    detail: { scope: target.clientRowId === null ? 'tenant' : 'client' },
  });
  return { kind: 'saved', view: await viewOf(tx, target) };
}

export type PublishOutcome =
  | { kind: 'not_found' }
  | { kind: 'no_draft' }
  | { kind: 'nothing_to_publish' }
  | { kind: 'precondition_failed' }
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'published'; view: ThemeViewResult; warnings: ThemeWarning[] };

function auditDetail(
  target: ThemeTarget,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { scope: target.clientRowId === null ? 'tenant' : 'client', ...extra };
}

export async function publishDraft(
  tx: TenantScopedDatabase,
  deps: ThemeDeps,
  target: ThemeTarget,
  actor: Actor,
  input: { ifMatch: string | undefined },
): Promise<PublishOutcome> {
  if (!(await clientExists(tx, target))) return { kind: 'not_found' };
  const themes = themeRepository(tx);
  const scope = scopeOf(target);
  // Locked from here to the commit, so the draft checked is the draft
  // published and a second publish of it finds none.
  const draft = await themes.lockDraft(scope);
  if (draft === null) return { kind: 'no_draft' };
  if (hasPrecondition(input.ifMatch) && matches(input.ifMatch, `"${draft.etag}"`) !== 'match') {
    return { kind: 'precondition_failed' };
  }

  // A draft with the published content would be a second version of the
  // same theme.
  const current = await themes.published(scope);
  if (changedPieces(draft.body, current?.body ?? null).length === 0) {
    return { kind: 'nothing_to_publish' };
  }

  const parsed = parseThemeBody(draft.body);
  if (!parsed.ok) return { kind: 'invalid', errors: bodyIssueErrors(parsed.issues) };
  const held = await holdAssets(tx, target, parsed.body);
  const errors = [
    ...missingAssetErrors(held.missing),
    ...pieceErrors(parsed.body, held, deps),
    ...contrastErrors(contrastFailures(parsed.body.tokens)),
  ];
  if (errors.length > 0) return { kind: 'invalid', errors: errors.slice(0, MAX_THEME_ERRORS) };

  const published = await themes.publish(scope);
  await deps.audit(tx, {
    action: 'theme.published',
    resourceType: 'theme',
    resourceId: target.clientRowId ?? target.tenantId,
    ...actor,
    outcome: 'allowed',
    detail: auditDetail(target, { version: published.version }),
  });
  return {
    kind: 'published',
    view: await viewOf(tx, target),
    warnings: themeWarnings(parsed.body),
  };
}

export type DiscardDraftOutcome =
  | { kind: 'not_found' }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'discarded'; view: ThemeViewResult };

// Deletes the draft alone. Without one there is nothing to discard: the
// theme is answered as it is, unless an ETag names a draft that is gone.
export async function discardDraft(
  tx: TenantScopedDatabase,
  deps: ThemeDeps,
  target: ThemeTarget,
  actor: Actor,
  input: { ifMatch: string | undefined },
): Promise<DiscardDraftOutcome> {
  if (!(await clientExists(tx, target))) return { kind: 'not_found' };
  const themes = themeRepository(tx);
  const scope = scopeOf(target);
  const current = await themes.lockDraft(scope);
  if (current === null) {
    return input.ifMatch === undefined
      ? { kind: 'discarded', view: await viewOf(tx, target) }
      : { kind: 'precondition_failed' };
  }
  const precondition = requiredPrecondition(input.ifMatch, `"${current.etag}"`);
  if (precondition === 'required') return { kind: 'precondition_required' };
  if (precondition === 'failed') return { kind: 'precondition_failed' };

  await themes.deleteDraft(scope);
  await deps.audit(tx, {
    action: 'theme.draft_discarded',
    resourceType: 'theme',
    resourceId: target.clientRowId ?? target.tenantId,
    ...actor,
    outcome: 'allowed',
    detail: auditDetail(target),
  });
  return { kind: 'discarded', view: await viewOf(tx, target) };
}

export type RestoreOutcome =
  | { kind: 'not_found' }
  | { kind: 'version_not_found' }
  | { kind: 'assets_missing'; errors: FieldError[] }
  | { kind: 'fails_checks'; errors: FieldError[] }
  | { kind: 'restored'; view: ThemeViewResult };

export async function restoreVersion(
  tx: TenantScopedDatabase,
  deps: ThemeDeps,
  target: ThemeTarget,
  actor: Actor,
  input: { versionId: string },
): Promise<RestoreOutcome> {
  if (!(await clientExists(tx, target))) return { kind: 'not_found' };
  const themes = themeRepository(tx);
  const scope = scopeOf(target);
  const source = await themes.version(scope, input.versionId);
  if (source === null) return { kind: 'version_not_found' };

  const parsed = parseThemeBody(source.body);
  // A stored version that no longer parses names nothing it can be held to.
  if (!parsed.ok) return { kind: 'assets_missing', errors: bodyIssueErrors(parsed.issues) };
  const held = await holdAssets(tx, target, parsed.body);
  if (held.missing.length > 0) {
    return { kind: 'assets_missing', errors: missingAssetErrors(held.missing) };
  }
  // A version that passed the checks of its day may fail today's: restoring
  // it would publish a piece the renderer drops for the layer below.
  const failing = pieceErrors(parsed.body, held, deps);
  if (failing.length > 0) {
    return { kind: 'fails_checks', errors: failing.slice(0, MAX_THEME_ERRORS) };
  }

  const restored = await themes.restore(scope, input.versionId);
  await deps.audit(tx, {
    action: 'theme.restored',
    resourceType: 'theme',
    resourceId: target.clientRowId ?? target.tenantId,
    ...actor,
    outcome: 'allowed',
    detail: auditDetail(target, { version: restored.version, from_version: source.version }),
  });
  return { kind: 'restored', view: await viewOf(tx, target) };
}

export type ResetOutcome = { kind: 'not_found' } | { kind: 'reset'; view: ThemeViewResult };

export async function resetTheme(
  tx: TenantScopedDatabase,
  deps: ThemeDeps,
  target: ThemeTarget,
  actor: Actor,
): Promise<ResetOutcome> {
  if (!(await clientExists(tx, target))) return { kind: 'not_found' };
  await themeRepository(tx).reset(scopeOf(target));
  await deps.audit(tx, {
    action: 'theme.reset',
    resourceType: 'theme',
    resourceId: target.clientRowId ?? target.tenantId,
    ...actor,
    outcome: 'allowed',
    detail: auditDetail(target),
  });
  return { kind: 'reset', view: await viewOf(tx, target) };
}

export interface ThemeVersionRow {
  readonly id: string;
  readonly version: number;
  readonly state: 'published' | 'archived';
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

export type ListVersionsOutcome = { kind: 'not_found' } | { kind: 'ok'; items: ThemeVersionRow[] };

export async function listVersions(
  tx: TenantScopedDatabase,
  target: ThemeTarget,
): Promise<ListVersionsOutcome> {
  if (!(await clientExists(tx, target))) return { kind: 'not_found' };
  const rows: ThemeVersionSummary[] = await themeRepository(tx).listVersions(
    scopeOf(target),
    THEME_VERSION_LIMIT,
  );
  return {
    kind: 'ok',
    items: rows.map((row) => ({
      id: row.id,
      version: row.version,
      state: row.state === 'published' ? 'published' : 'archived',
      createdAt: row.createdAt,
      publishedAt: row.publishedAt,
    })),
  };
}
