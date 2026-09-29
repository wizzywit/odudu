import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { recordKey, type RecordEntry } from '#/shared/repository/useRecord.ts';
import { useSectionDraft } from '#/shared/repository/useSectionDraft.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { Conflict } from '#/shared/service/conflict.ts';
import { edit as editDraft, rebase, sameValue, type Values } from '#/shared/service/dirty.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface SectionField<V> {
  readonly value: V;
  readonly label: string;
  readonly kind: 'plain' | 'secret';
}

export type SectionFields<T extends Values> = { readonly [K in keyof T]: SectionField<T[K]> };

export interface SaveInput<T extends Values> {
  readonly changes: Partial<T>;
  readonly values: T;
  readonly ifMatch: string;
}

// `conflict` and `stale` both follow a 412: `conflict` while a field edited
// here was changed there too, `stale` when the edits sit on the fresh read
// untouched and only need saving again.
export type SaveStatus =
  'idle' | 'saving' | 'saved' | 'invalid' | 'conflict' | 'stale' | 'refused' | 'failed';

type Phase = Exclude<SaveStatus, 'conflict'>;

export interface SectionSave<T extends Values> {
  readonly status: SaveStatus;
  readonly fieldErrors: Readonly<Partial<Record<keyof T & string, string>>>;
  readonly conflicts: readonly Conflict[];
  // Re-saves every edit on the fresh ETag.
  readonly keepMine: () => void;
  // Drops the conflicting edits and keeps the rest.
  readonly takeTheirs: () => void;
  readonly values: T;
  readonly changed: readonly (keyof T & string)[];
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly restored: boolean;
  // A refusal that belongs beside the save, such as a guard's 409.
  readonly message: string | null;
  readonly edit: <K extends keyof T & string>(field: K, value: T[K]) => void;
  readonly discard: () => void;
  readonly submit: () => void;
}

interface State<T extends Values> {
  readonly base: T;
  readonly etag: string | null;
  readonly edits: Partial<T>;
  readonly conflicts: readonly (keyof T & string)[];
  readonly phase: Phase;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly message: string | null;
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
      if (result.problem.status === 403) {
        return `${label} was not saved: your role does not allow this change.`;
      }
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
  fields,
  save,
}: {
  readonly tenant: string;
  readonly record: string;
  readonly section: string;
  readonly label?: string;
  // The ETag the record was read with, or null before it is read.
  readonly etag: string | null;
  readonly fields: SectionFields<T>;
  readonly save: (gateway: Gateway, input: SaveInput<T>) => Promise<GatewayResult<R>>;
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
      update(() => ({ phase: 'stale' }));
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
    const refused = result.kind === 'problem' && result.problem.status === 403;
    update(() => ({ phase: refused ? 'refused' : 'failed' }));
    toast('error', problemMessage(label, result));
  };

  const run = async (from: State<T>): Promise<void> => {
    if (inFlight.current || from.etag === null || Object.keys(from.edits).length === 0) return;
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
  }));

  return {
    status: conflicts.length > 0 ? 'conflict' : current.phase,
    fieldErrors: current.fieldErrors as SectionSave<T>['fieldErrors'],
    conflicts,
    keepMine: () => {
      const from = latest.current;
      if (inFlight.current || from.conflicts.length === 0) return;
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
      if (from.conflicts.length > 0) return;
      run(from).catch(() => undefined);
    },
  };
}
