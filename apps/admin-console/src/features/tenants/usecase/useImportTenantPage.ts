import type { ImportError } from '@odudu/contracts/admin';
import { useState } from 'react';
import { usePrincipal, useRefusal } from '#/features/session/index.ts';
import { beginAdministrator } from '#/features/tenants/repository/useCreation.ts';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { useImport, type ImportedSecret } from '#/features/tenants/repository/useImport.ts';
import {
  fileSize,
  importFileProblem,
  NAME_RULE,
  NEW_TENANT_HREF,
  nameProblem,
  tenantHref,
} from '#/features/tenants/service.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';

export interface ChosenFile {
  readonly name: string;
  readonly size: string;
}

export interface ImportTenantPage {
  readonly name: string;
  readonly displayName: string;
  readonly rule: string;
  readonly file: ChosenFile | null;
  readonly nameError: string | undefined;
  readonly fileError: string | undefined;
  // Every problem the import found in the document, each at its JSON path.
  readonly errors: readonly ImportError[];
  readonly message: string | null;
  readonly unconfirmed: boolean;
  readonly busy: boolean;
  readonly secret: ImportedSecret | null;
  readonly secretPlace: string;
  readonly imported: { readonly tenant: string; readonly recordHref: string } | null;
  readonly editName: (name: string) => void;
  readonly editDisplayName: (displayName: string) => void;
  readonly choose: (file: File | null) => void;
  readonly submit: () => void;
  readonly check: () => void;
  readonly closeSecret: () => void;
  readonly createAdministrator: () => void;
}

// Most often a reverse proxy's own limit, lower than the import route's.
const TOO_LARGE =
  'The server, or a proxy in front of it, refused a body this large; see the deployment note on body limits.';

const NETWORK =
  'Could not confirm the import. It was not sent again, since its client secrets are shown only once; check whether the tenant exists.';

export function useImportTenantPage(): ImportTenantPage {
  const principal = usePrincipal();
  const refusal = useRefusal(SYSTEM_TENANT);
  const importer = useImport((failure) => {
    refusal.report(failure, 'manage-tenants');
  });
  const go = useGo();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [found, setFound] = useState<{ tenant: string } | { missing: string } | null>(null);

  const outcome = importer.outcome;
  const failure =
    outcome !== null && !outcome.ok && outcome.kind === 'refused' ? outcome.failure : null;
  const problem = failure?.kind === 'problem' ? failure.problem : null;
  const errors = problem?.status === 400 ? (problem.errors ?? []) : [];
  const serverNameError =
    problem?.status === 409
      ? (problem.detail ?? problem.title)
      : errors.find((e) => e.path === 'name')?.message;

  let message: string | null = null;
  if (outcome !== null && !outcome.ok && outcome.kind === 'file') message = null;
  else if (failure?.kind === 'network') message = NETWORK;
  else if (failure !== null && problem === null)
    message =
      'The import could not be read back. This is a fault in the console; check whether the tenant exists.';
  else if (problem?.status === 403)
    message = 'Importing a tenant needs the manage-tenants capability.';
  else if (problem?.status === 413) message = TOO_LARGE;
  else if (problem !== null && problem.status !== 400 && problem.status !== 409)
    message = problem.detail ?? problem.title;
  else if (errors.length > 0 && problem !== null) message = problem.detail ?? problem.title;
  if (found !== null && 'missing' in found)
    message = `${found.missing} was not imported. Import it again.`;

  const fileRefusal =
    outcome !== null && !outcome.ok && outcome.kind === 'file' ? outcome.message : undefined;
  const importedTenant =
    outcome?.ok === true
      ? outcome.tenant.name
      : found !== null && 'tenant' in found
        ? found.tenant
        : null;
  const secretsLeft = importer.secret !== null;
  return {
    name,
    displayName,
    rule: NAME_RULE,
    file: file === null ? null : { name: file.name, size: fileSize(file.size) },
    nameError: nameError ?? serverNameError,
    fileError: fileError ?? fileRefusal,
    errors,
    message: importedTenant === null ? message : null,
    unconfirmed: failure?.kind === 'network' && importedTenant === null,
    busy: importer.busy,
    secret: importer.secret,
    secretPlace:
      outcome?.ok === true ? `${String(importer.shown + 1)} of ${String(outcome.secrets)}` : '',
    imported:
      importedTenant === null || secretsLeft
        ? null
        : { tenant: importedTenant, recordHref: tenantHref(importedTenant) },
    editName: (next) => {
      setName(next.trim());
      setNameError(undefined);
    },
    editDisplayName: setDisplayName,
    choose: (next) => {
      setFile(next);
      setFileError(next === null ? undefined : (importFileProblem(next.size) ?? undefined));
    },
    submit: () => {
      const named = nameProblem(name);
      const chosen =
        file === null ? 'Choose a tenant document to import.' : importFileProblem(file.size);
      setNameError(named ?? undefined);
      setFileError(chosen ?? undefined);
      setFound(null);
      if (named !== null || chosen !== null || file === null) return;
      importer.start({ name, displayName, file });
    },
    check: () => {
      importer
        .find(name)
        .then((result) => {
          if (!result.ok) return;
          setFound(result.data === null ? { missing: name } : { tenant: result.data.name });
        })
        .catch(() => undefined);
    },
    closeSecret: importer.close,
    createAdministrator: () => {
      if (importedTenant === null) return;
      beginAdministrator(`${principal.tenant}/${principal.subjectId}`, importedTenant, 'imported');
      go(NEW_TENANT_HREF);
    },
  };
}
