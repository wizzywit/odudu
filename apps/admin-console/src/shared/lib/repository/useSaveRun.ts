import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { recordKey } from '#/shared/lib/repository/queryKeys';
import type { RecordEntry } from '#/shared/lib/repository/useRecord';
import { useToasts } from '#/shared/lib/repository/useToasts';
import type { Values } from '#/shared/lib/services/dirty';
import type { AdminCapability } from '#/shared/lib/services/principal';
import {
  afterSave,
  rereadPhase,
  saveOutcome,
  savingSection,
  valuesOf,
  type SaveOutcome,
  type SectionState,
} from '#/shared/lib/services/sectionSave';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';
import type { Problem } from '#/shared/api/transport/problem';
import { useTransport } from '#/shared/api/transport/useTransport';

export interface SaveInput<T extends Values> {
  changes: Partial<T>;
  values: T;
  ifMatch: string;
}

// What `useRefusal.report` answers to: a 403 names the capability it needed.
export interface RefusalReporter {
  report: (failure: GatewayFailure, needed: AdminCapability) => boolean;
}

// One save from its request to what it leaves: the answer written to the
// cache, the state it folds into, the toast, and the refusal reported.
export function useSaveRun<T extends Values, R>({
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
}: {
  tenant: string;
  record: string;
  label: string;
  capability: AdminCapability;
  refusal: RefusalReporter;
  onRefused: ((failure: GatewayFailure) => void) | undefined;
  explain: ((problem: Problem) => string | null) | undefined;
  save: (gateway: Gateway, input: SaveInput<T>) => Promise<GatewayResult<R>>;
  update: (change: (was: SectionState<T>) => SectionState<T>) => void;
  settle: () => void;
}): { run: (from: SectionState<T>) => Promise<void>; running: () => boolean } {
  const { gateway } = useTransport();
  const client = useQueryClient();
  const push = useToasts((queue) => queue.push);
  const inFlight = useRef(false);

  const toast = (outcome: SaveOutcome): void => {
    if (outcome.toast !== undefined) push(outcome.toast);
  };

  const answer = async (from: SectionState<T>, result: GatewayResult<R>): Promise<void> => {
    const outcome = saveOutcome(result, {
      label,
      capability,
      explain,
      fields: Object.keys(from.base),
    });
    if (result.ok) {
      const entry: RecordEntry<R> = { result, by: 'save' };
      client.setQueryData(recordKey(tenant, record), entry);
      update((was) => afterSave(was, outcome, from.edits));
      settle();
      toast(outcome);
      return;
    }
    let phase = outcome.phase;
    if (outcome.refetch) {
      await client.refetchQueries({ queryKey: recordKey(tenant, record), exact: true });
      phase = rereadPhase(client.getQueryState(recordKey(tenant, record))?.status);
    }
    update((was) => afterSave(was, { ...outcome, phase }, from.edits));
    toast(outcome);
    if (outcome.refused) {
      refusal.report(result, capability);
      onRefused?.(result);
    }
  };

  const run = async (from: SectionState<T>): Promise<void> => {
    inFlight.current = true;
    update(savingSection);
    const attempt = async (): Promise<void> => {
      const values = valuesOf(from);
      await answer(from, await save(gateway, { changes: from.edits, values, ifMatch: from.etag }));
    };
    await attempt()
      .catch(() => {
        const failed = saveOutcome(
          { ok: false, kind: 'defect' },
          { label, capability, fields: [] },
        );
        update((was) => afterSave(was, failed, from.edits));
        toast(failed);
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  return { run, running: () => inFlight.current };
}
