import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { recordKey, type RecordEntry } from '#/shared/repository/useRecord.ts';
import { useSectionDraft } from '#/shared/repository/useSectionDraft.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { Conflict } from '#/shared/service/conflict.ts';
import {
  BLOCKED_BY_CONFLICT,
  BLOCKED_GONE,
  BLOCKED_UNREAD,
  type ConflictSource,
  type SaveStatus,
} from '#/shared/service/sectionSave.ts';
import { edit as editDraft, rebase, sameValue, type Values } from '#/shared/service/dirty.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface SectionField<V> {
  value: V;
  label: string;
  kind: 'plain' | 'secret';
  // How a conflict shows the value, where plain text would not do.
  describe?: (value: unknown) => string;
}

export type SectionFields<T extends Values> = { readonly [K in keyof T]: SectionField<T[K]> };

export interface SaveInput<T extends Values> {
  changes: Partial<T>;
  values: T;
  ifMatch: string;
}

export type { ConflictSource, SaveStatus };

type Phase = Exclude<SaveStatus, 'conflict'>;

export interface SectionSave<T extends Values> {
  status: SaveStatus;
  fieldErrors: Readonly<Partial<Record<keyof T & string, string>>>;
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

interface State<T extends Values> {
  base: T;
  etag: string;
  edits: Partial<T>;
  conflicts: readonly (keyof T & string)[];
  source: ConflictSource;
  phase: Phase;
  fieldErrors: Readonly<Record<string, string>>;
  message: string | null;
}

function valuesOf<T extends Values>(fields: SectionFields<T>): T {
  const names = Object.keys(fields) as (keyof T & string)[];
  return Object.fromEntries(names.map((name) => [name, fields[name].value])) as T;
}

function keysOf<T extends Values>(values: T): (keyof T & string)[] {
  return Object.keys(values);
}

function changedFrom<T extends Values>(base: T, values: Values): Partial<T> {
  return Object.fromEntries(
    keysOf(base)
      .filter((name) => Object.hasOwn(values, name) && !sameValue(values[name], base[name]))
      .map((name) => [name, values[name]]),
  ) as Partial<T>;
}

function without<T extends Values>(edits: Partial<T>, fields: readonly string[]): Partial<T> {
  return Object.fromEntries(
    Object.entries(edits).filter(([name]) => !fields.includes(name)),
  ) as Partial<T>;
}

function problemMessage(label: string, result: Exclude<GatewayResult<unknown>, { ok: true }>) {
  switch (result.kind) {
    case 'network':
      return `Could not confirm that ${label} was saved. Your changes are still here, and saving again is safe.`;
    case 'schema':
      return `${label} may have been saved, but its answer could not be read. Reload to check.`;
    case 'defect':
      return `The console could not save ${label}. This is a fault in the console, not something you did.`;
    case 'problem':
      if (result.problem.status === 404) return `${label} was not saved: it no longer exists.`;
      return `${label} was not saved: ${result.problem.detail ?? result.problem.title}`;
  }
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
  onRefused,
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
  capability: string;
  // The record was found deleted since it was read (`useRecord`'s `gone`).
  gone?: boolean;
  // Told of a 403, so the caller can re-read whoami (`useRefusal.report`).
  onRefused?: (failure: GatewayFailure) => void;
  fields: SectionFields<T>;
  save: (gateway: Gateway, input: SaveInput<T>) => Promise<GatewayResult<R>>;
}): SectionSave<T> {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const fresh = valuesOf(fields);
  const [state, setState] = useState<State<T> | null>(null);
  const draftEdits = state?.edits ?? {};
  const { restored, settle } = useSectionDraft({
    tenant,
    record,
    section,
    label,
    dirty: Object.keys(draftEdits).length > 0,
    fields: Object.fromEntries(
      Object.entries(draftEdits).map(([name, value]) => [
        name,
        { kind: fields[name]?.kind ?? 'secret', value },
      ]),
    ),
    etag: state?.etag ?? etag,
  });

  let current: State<T>;
  if (state === null) {
    // A kept draft made against an older version cannot be rebased, since
    // the values it was made against are gone: every edit is then shown
    // beside what the record holds now.
    const edits = restored === null ? {} : changedFrom(fresh, restored.values);
    const conflicts = restored !== null && restored.etag !== etag ? keysOf(edits) : [];
    current = {
      base: fresh,
      etag,
      edits,
      conflicts,
      source: 'kept',
      phase: 'idle',
      fieldErrors: {},
      message: null,
    };
    setState(current);
  } else if (!sameValue(fresh, state.base) || etag !== state.etag) {
    const rebased = rebase({ base: state.base, edits: state.edits }, fresh);
    const still = state.conflicts.filter((name) => Object.hasOwn(rebased.draft.edits, name));
    current = {
      ...state,
      base: fresh,
      etag,
      edits: rebased.draft.edits,
      conflicts: [...new Set([...still, ...rebased.conflicts])],
      source: rebased.conflicts.length > 0 ? 'changed' : state.source,
      phase: state.phase === 'unread' && etag !== state.etag ? 'stale' : state.phase,
    };
    setState(current);
  } else {
    current = state;
  }

  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });
  const inFlight = useRef(false);

  const update = (change: (was: State<T>) => Partial<State<T>>): void => {
    setState((was) => (was === null ? was : { ...was, ...change(was) }));
  };

  const toast = (tone: 'success' | 'error', message: string): void => {
    useToasts.getState().push({ tone, message });
  };

  const answer = async (from: State<T>, result: GatewayResult<R>): Promise<void> => {
    if (result.ok) {
      const entry: RecordEntry<R> = { result, by: 'save' };
      client.setQueryData(recordKey(tenant, record), entry);
      update((was) => ({
        edits: Object.fromEntries(
          Object.entries(was.edits).filter(([name, value]) => !sameValue(value, from.edits[name])),
        ) as Partial<T>,
        phase: 'saved',
        fieldErrors: {},
      }));
      settle();
      toast('success', `${label} saved`);
      return;
    }
    if (result.kind === 'problem' && result.problem.status === 412) {
      await client.refetchQueries({ queryKey: recordKey(tenant, record), exact: true });
      const unread = client.getQueryState(recordKey(tenant, record))?.status === 'error';
      update(() => ({ phase: unread ? 'unread' : 'stale' }));
      return;
    }
    if (result.kind === 'problem' && result.problem.status === 401) {
      update(() => ({ phase: 'idle' }));
      return;
    }
    if (result.kind === 'problem' && result.problem.status === 400) {
      const placed = fieldErrorsOf(result.problem, keysOf(from.base));
      update(() => ({ phase: 'invalid', fieldErrors: placed.fields }));
      if (placed.other.length > 0) {
        toast('error', `${label} was not saved: ${placed.other.join('; ')}`);
      }
      return;
    }
    if (result.kind === 'problem' && result.problem.status === 409) {
      const message = result.problem.detail ?? result.problem.title;
      update(() => ({ phase: 'refused', message }));
      return;
    }
    if (result.kind === 'problem' && result.problem.status === 403) {
      update(() => ({
        phase: 'refused',
        message: `${label} was not saved: it needs the ${capability} capability.`,
      }));
      onRefused?.(result);
      return;
    }
    update(() => ({ phase: 'failed' }));
    toast('error', problemMessage(label, result));
  };

  const startable = (from: State<T>): boolean =>
    !inFlight.current && !gone && from.phase !== 'unread' && Object.keys(from.edits).length > 0;

  const run = async (from: State<T>): Promise<void> => {
    inFlight.current = true;
    update(() => ({ phase: 'saving', message: null }));
    try {
      const values = { ...from.base, ...from.edits };
      await answer(from, await save(gateway, { changes: from.edits, values, ifMatch: from.etag }));
    } catch {
      update(() => ({ phase: 'failed' }));
      toast('error', problemMessage(label, { ok: false, kind: 'defect' }));
    } finally {
      inFlight.current = false;
    }
  };

  const values = { ...current.base, ...current.edits };
  const changed = keysOf(current.edits as T);
  const conflicts: Conflict[] = current.conflicts.map((name) => ({
    field: name,
    label: fields[name].label,
    theirs: current.base[name],
    yours: current.edits[name],
    secret: fields[name].kind === 'secret',
    describe: fields[name].describe,
  }));

  return {
    status: conflicts.length > 0 ? 'conflict' : current.phase,
    fieldErrors: current.fieldErrors as SectionSave<T>['fieldErrors'],
    conflicts,
    conflictSource: current.source,
    blocked: gone
      ? BLOCKED_GONE
      : conflicts.length > 0
        ? BLOCKED_BY_CONFLICT
        : current.phase === 'unread'
          ? BLOCKED_UNREAD
          : undefined,
    reread: () => {
      client
        .refetchQueries({ queryKey: recordKey(tenant, record), exact: true })
        .catch(() => undefined);
    },
    keepMine: () => {
      const from = latest.current;
      if (!startable(from) || from.conflicts.length === 0) return;
      update(() => ({ conflicts: [] }));
      run({ ...from, conflicts: [] }).catch(() => undefined);
    },
    takeTheirs: () => {
      const from = latest.current;
      if (inFlight.current || from.conflicts.length === 0) return;
      const edits = without(from.edits, from.conflicts);
      update(() => ({ edits, conflicts: [], phase: 'idle', message: null }));
      if (Object.keys(edits).length === 0) settle();
    },
    values,
    changed,
    dirty: changed.length > 0,
    saving: current.phase === 'saving',
    restored: restored !== null && changed.length > 0,
    message: current.message,
    edit: (field, value) => {
      update((was) => ({
        edits: editDraft({ base: was.base, edits: was.edits }, field, value).edits,
        fieldErrors: Object.fromEntries(
          Object.entries(was.fieldErrors).filter(([name]) => name !== field),
        ),
        phase: was.phase === 'saving' ? 'saving' : 'idle',
        message: null,
      }));
    },
    discard: () => {
      update(() => ({ edits: {}, conflicts: [], phase: 'idle', fieldErrors: {}, message: null }));
      settle();
    },
    submit: () => {
      const from = latest.current;
      if (from.conflicts.length > 0 || !startable(from)) return false;
      run(from).catch(() => undefined);
      return true;
    },
  };
}
