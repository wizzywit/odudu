import type { ImportError } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session/index.ts';
import { useImport, type ImportedSecret } from '#/features/tenants/repository/useImport.ts';
import {
  fileSize,
  importFileProblem,
  NAME_RULE,
  nameProblem,
  tenantHref,
} from '#/features/tenants/service.ts';
import {
  useBeginAdministrator,
  type BeginAdministrator,
} from '#/features/tenants/usecase/useBeginAdministrator.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';

export interface ChosenFile {
  name: string;
  size: string;
}

export interface ImportTenantPage {
  name: string;
  displayName: string;
  rule: string;
  file: ChosenFile | null;
  nameError: string | undefined;
  fileError: string | undefined;
  // Every problem the import found in the document, each at its JSON path.
  errors: readonly ImportError[];
  message: string | null;
  unconfirmed: boolean;
  busy: boolean;
  secret: ImportedSecret | null;
  secretPlace: string;
  imported: { tenant: string; recordHref: string } | null;
  editName: (name: string) => void;
  editDisplayName: (displayName: string) => void;
  choose: (file: File | null) => void;
  submit: () => void;
  check: () => void;
  closeSecret: () => void;
  // The first administrator's step, for the tenant just imported.
  begin: BeginAdministrator;
}

// Most often a reverse proxy's own limit, lower than the import route's.
const TOO_LARGE =
  'The server, or a proxy in front of it, refused a body this large; see the deployment note on body limits.';

const NETWORK =
  'Could not confirm the import. It was not sent again, since its client secrets are shown only once; check whether the tenant exists.';

export function useImportTenantPage(): ImportTenantPage {
  const refusal = useRefusal(SYSTEM_TENANT);
  const importer = useImport((failure) => {
    refusal.report(failure, 'manage-tenants');
  });
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
  else if (problem?.status === 400) message = problem.detail ?? problem.title;
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
  const begin = useBeginAdministrator(importedTenant ?? '', 'imported');
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
    begin,
  };
}
