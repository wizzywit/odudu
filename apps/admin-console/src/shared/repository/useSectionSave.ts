import type { FieldError } from '@odudu/contracts/admin';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { recordKey } from '#/shared/repository/queryKeys';
import { useSaveRun, type RefusalReporter, type SaveInput } from '#/shared/repository/useSaveRun';
import { useSavingSections } from '#/shared/repository/useSavingSections';
import { useSectionDraft } from '#/shared/repository/useSectionDraft';
import type { Conflict } from '#/shared/service/conflict';
import { savingKey } from '#/shared/service/savingSections';
import type { Values } from '#/shared/service/dirty';
import { draftFieldsOf } from '#/shared/service/drafts';
import type { AdminCapability } from '#/shared/service/principal';
import {
  canKeepMine,
  canSubmit,
  canTakeTheirs,
  changedFields,
  conflictsOf,
  currentSection,
  discardedSection,
  editedSection,
  fieldValues,
  hasEdits,
  isSaving,
  mineKept,
  restoredShown,
  sectionBlocked,
  settlesAfter,
  statusOf,
  theirsTaken,
  valuesOf,
  type ConflictSource,
  type SaveStatus,
  type SectionField,
  type SectionFields,
  type SectionState,
} from '#/shared/service/sectionSave';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway';
import type { Problem } from '#/shared/transport/problem';
import { useLatest } from '#/shared/repository/useLatest';

export type { SectionField, SectionFields };

export type { RefusalReporter, SaveInput };

export type { ConflictSource, SaveStatus };

export interface SectionSave<T extends Values> {
  status: SaveStatus;
  fieldErrors: Readonly<Partial<Record<keyof T & string, string>>>;
  // What the server refused in each field, with the line and column it
  // named, until the field is edited or the section saved.
  refusals: Readonly<Partial<Record<keyof T & string, readonly FieldError[]>>>;
  conflicts: readonly Conflict[];
  conflictSource: ConflictSource;
  // Why Save is held, for Section's `blocked`.
  blocked: string | undefined;
  // Reads the record again, after a 412 whose fresh read failed.
  reread: () => void;
  // Re-saves every edit on the fresh ETag.
  keepMine: () => void;
  // Drops the conflicting edits and keeps the rest.
  takeTheirs: () => void;
  values: T;
  changed: readonly (keyof T & string)[];
  dirty: boolean;
  saving: boolean;
  restored: boolean;
  // A refusal that belongs beside the save: a guard's 409, or the
  // capability a 403 needed.
  message: string | null;
  edit: <K extends keyof T & string>(field: K, value: T[K]) => void;
  discard: () => void;
  // False when it declined to send, for Section's `onSave`.
  submit: () => boolean;
}

// One section of a record, from its first edit to its save: the If-Match it
// sends, one request at a time, errors under their fields, and a 412 shown
// as theirs beside yours. The record is read through `useRecord` under the
// same tenant and record, and `save` answers the record as that read does:
// the answer replaces it, which rebases the record's other dirty sections.
export function useSectionSave<T extends Values, R>({
  tenant,
  record,
  section,
  label = section,
  etag,
  capability,
  gone = false,
  refusal,
  onRefused,
  explain,
  fields,
  save,
}: {
  tenant: string;
  record: string;
  section: string;
  label?: string;
  // The ETag the record was read with: a section mounts once it is read.
  etag: string;
  // What the save needs, named when a 403 refuses it.
  capability: AdminCapability;
  // The record was found deleted since it was read (`useRecord`'s `gone`).
  gone?: boolean;
  // Told of a refusal with the capability it needed (`useRefusal`).
  refusal: RefusalReporter;
  // Told of a refusal after `refusal`, for whatever else it should set going.
  onRefused?: (failure: GatewayFailure) => void;
  // Says what a 403 or 409 means for this section, in place of the default.
  explain?: (problem: Problem) => string | null;
  fields: SectionFields<T>;
  save: (gateway: Gateway, input: SaveInput<T>) => Promise<GatewayResult<R>>;
}): SectionSave<T> {
  const client = useQueryClient();
  const fresh = fieldValues(fields);
  const [state, setState] = useState<SectionState<T> | null>(null);
  const draftEdits = state?.edits ?? {};
  const { restored, settle } = useSectionDraft({
    tenant,
    record,
    section,
    label,
    dirty: hasEdits(draftEdits),
    fields: draftFieldsOf(draftEdits, fields),
    etag,
  });

  const current = currentSection(state, fresh, etag, restored);
  if (current !== state) setState(current);

  const latest = useLatest(current);
  const update = (change: (was: SectionState<T>) => SectionState<T>): void => {
    setState((was) => (was === null ? was : change(was)));
  };
  const { run, running } = useSaveRun({
    tenant,
    record,
    label,
    capability,
    refusal,
    onRefused,
    explain,
    save,
    update,
    settle,
  });

  const report = useSavingSections((state) => state.report);
  const savingNow = isSaving(current);
  useEffect(() => {
    const key = savingKey(tenant, record, section);
    report(key, savingNow);
    return () => {
      report(key, false);
    };
  }, [report, tenant, record, section, savingNow]);

  const changed = changedFields(current);
  const conflicts: Conflict[] = conflictsOf(current, fields);

  return {
    status: statusOf(current),
    fieldErrors: current.fieldErrors as SectionSave<T>['fieldErrors'],
    refusals: current.refusals as SectionSave<T>['refusals'],
    conflicts,
    conflictSource: current.source,
    blocked: sectionBlocked(gone, conflicts.length, current.phase),
    reread: () => {
      client
        .refetchQueries({ queryKey: recordKey(tenant, record), exact: true })
        .catch(() => undefined);
    },
    keepMine: () => {
      const from = latest();
      if (!canKeepMine(from, gone, running())) return;
      update(mineKept);
      run(mineKept(from)).catch(() => undefined);
    },
    takeTheirs: () => {
      const from = latest();
      if (!canTakeTheirs(from, running())) return;
      update(theirsTaken);
      if (settlesAfter(theirsTaken(from))) settle();
    },
    values: valuesOf(current),
    changed,
    dirty: hasEdits(current.edits),
    saving: isSaving(current),
    restored: restoredShown(restored, current),
    message: current.message,
    edit: (field, value) => {
      update((was) => editedSection(was, field, value));
    },
    discard: () => {
      update(discardedSection);
      settle();
    },
    submit: () => {
      const from = latest();
      if (!canSubmit(from, gone, running())) return false;
      run(from).catch(() => undefined);
      return true;
    },
  };
}
