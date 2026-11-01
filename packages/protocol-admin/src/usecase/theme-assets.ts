import { type ThemeAsset } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  assetRepository,
  uploadAsset,
  type AssetKind,
  type AssetReference,
  type UploadAssetDeps,
  type UploadRefusal,
} from '@odudu/domain-theme';
import { type Actor } from '#/usecase/theme';

export interface ThemeAssetAuditEvent {
  readonly action: 'theme.asset_uploaded' | 'theme.asset_deleted';
  readonly resourceType: 'theme_asset';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts`: the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: ThemeAssetAuditEvent) => Promise<void>;

export interface ThemeAssetDeps {
  readonly audit: Audit;
  // The image inspector `uploadAsset` runs; the process-wide bounded one
  // unless a test injects its own.
  readonly inspect?: UploadAssetDeps['inspect'];
}

// What a refusal lists of the versions that still name an image.
export const MAX_ASSET_REFERENCES = 20;

export type UploadOutcome =
  { kind: 'uploaded'; asset: ThemeAsset } | { kind: 'refused'; refusal: UploadRefusal };

// The transaction opens only once the image has been decoded, so a request
// waiting for the inspector holds no database connection.
export async function uploadThemeAsset(
  deps: ThemeAssetDeps,
  run: <T>(fn: (tx: TenantScopedDatabase) => Promise<T>) => Promise<T>,
  actor: Actor,
  input: { tenantId: string; kind: AssetKind; bytes: Uint8Array },
): Promise<UploadOutcome> {
  let storedBytes = 0;
  const upload = uploadAsset({
    ...(deps.inspect === undefined ? {} : { inspect: deps.inspect }),
    store: (asset) =>
      run(async (tx) => {
        const stored = await assetRepository(tx).put(asset);
        if (stored === 'over_cap') return stored;
        storedBytes = asset.bytes.length;
        await deps.audit(tx, {
          action: 'theme.asset_uploaded',
          resourceType: 'theme_asset',
          resourceId: stored.id,
          ...actor,
          outcome: 'allowed',
          detail: { sha256: stored.sha256, kind: input.kind, bytes: storedBytes },
        });
        return stored;
      }),
  });
  const result = await upload(input);
  if ('kind' in result) return { kind: 'refused', refusal: result };
  return { kind: 'uploaded', asset: { ...result, bytes: storedBytes, kind: input.kind } };
}

export type DeleteOutcome =
  | { kind: 'not_found' }
  | { kind: 'in_use'; references: AssetReference[]; more: boolean }
  | { kind: 'deleted' };

export async function deleteThemeAsset(
  tx: TenantScopedDatabase,
  deps: ThemeAssetDeps,
  actor: Actor,
  input: { tenantId: string; assetId: string },
): Promise<DeleteOutcome> {
  const assets = assetRepository(tx);
  // Locked first: a save that names the image waits for this transaction or
  // is already counted below, so the check cannot be outrun.
  const asset = await assets.lock(input.tenantId, input.assetId);
  if (asset === null) return { kind: 'not_found' };
  const found = await assets.references(input.tenantId, input.assetId, MAX_ASSET_REFERENCES + 1);
  if (found.length > 0) {
    return {
      kind: 'in_use',
      references: found.slice(0, MAX_ASSET_REFERENCES),
      more: found.length > MAX_ASSET_REFERENCES,
    };
  }
  await assets.delete(input.tenantId, input.assetId);
  await deps.audit(tx, {
    action: 'theme.asset_deleted',
    resourceType: 'theme_asset',
    resourceId: asset.id,
    ...actor,
    outcome: 'allowed',
    detail: { sha256: asset.sha256 },
  });
  return { kind: 'deleted' };
}

export type ContentOutcome = { kind: 'not_found' } | { kind: 'found'; mime: string; bytes: Buffer };

// An image the tenant uploaded, published or not: what the admin sees of it
// before any public address serves it. One statement.
export async function readThemeAssetContent(
  tx: TenantScopedDatabase,
  input: { tenantId: string; assetId: string },
): Promise<ContentOutcome> {
  const found = await assetRepository(tx).content(input.tenantId, input.assetId);
  return found === null ? { kind: 'not_found' } : { kind: 'found', ...found };
}
