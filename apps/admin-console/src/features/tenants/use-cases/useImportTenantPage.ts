import type { ImportError } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { useImport } from '#/features/tenants/repository/useImport';
import {
  chosenFileOf,
  fileChosenProblem,
  fileRequiredProblem,
  type ChosenFile,
} from '#/features/tenants/services/document';
import {
  foundOf,
  importedLink,
  importedTenantOf,
  importErrors,
  importFileRefusal,
  importMessage,
  importNameError,
  importUnconfirmed,
  secretPlace,
  type Found,
  type ImportedSecret,
} from '#/features/tenants/services/import';
import { nameProblem } from '#/features/tenants/services/tenantName';
import { useBeginAdministrator, type BeginAdministrator } from '#/features/begin-administrator';
import { TENANT_NAME_RULE_TEXT } from '#/shared/services/labels';
import { SYSTEM_TENANT } from '#/shared/services/principal';

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
    rule: TENANT_NAME_RULE_TEXT,
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
