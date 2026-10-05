import type { ImportError } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { useImport } from '#/features/tenants/repository/useImport.ts';
import {
  chosenFileOf,
  fileChosenProblem,
  fileRequiredProblem,
  foundOf,
  importedLink,
  importedTenantOf,
  importErrors,
  importFileRefusal,
  importMessage,
  importNameError,
  importUnconfirmed,
  NAME_RULE,
  nameProblem,
  secretPlace,
  type ChosenFile,
  type Found,
  type ImportedSecret,
} from '#/features/tenants/service.ts';
import {
  useBeginAdministrator,
  type BeginAdministrator,
} from '#/features/tenants/usecase/useBeginAdministrator.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';

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
  const [found, setFound] = useState<Found | null>(null);

  const outcome = importer.outcome;
  const importedTenant = importedTenantOf(outcome, found);
  const secretsLeft = importer.secret !== null;
  const begin = useBeginAdministrator(importedTenant ?? '', 'imported');
  return {
    name,
    displayName,
    rule: NAME_RULE,
    file: chosenFileOf(file),
    nameError: nameError ?? importNameError(outcome),
    fileError: fileError ?? importFileRefusal(outcome),
    errors: importErrors(outcome),
    message: importMessage(outcome, found),
    unconfirmed: importUnconfirmed(outcome, found),
    busy: importer.busy,
    secret: importer.secret,
    secretPlace: secretPlace(outcome, importer.shown),
    imported: importedLink(importedTenant, secretsLeft),
    editName: (next) => {
      setName(next.trim());
      setNameError(undefined);
    },
    editDisplayName: setDisplayName,
    choose: (next) => {
      setFile(next);
      setFileError(fileChosenProblem(next) ?? undefined);
    },
    submit: () => {
      const named = nameProblem(name);
      const chosen = fileRequiredProblem(file);
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
          setFound(foundOf(result.data, name));
        })
        .catch(() => undefined);
    },
    closeSecret: importer.close,
    begin,
  };
}
