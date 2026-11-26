import { ASSISTANT_SETTING_DEFAULTS, type AssistantSettings } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import {
  putAssistantSettings,
  type Audit,
  type AssistantSettingsStore,
} from '#/usecase/assistant-settings';

const TX = {} as TenantScopedDatabase;
const ACTOR = { actorSubjectId: 's', actorTenantId: 't', actorClientId: 'c' };
const NOW = new Date('2026-11-26T10:00:00.000Z');

function setup(stored: AssistantSettings) {
  const order: string[] = [];
  const writes: AssistantSettings[] = [];
  const events: Parameters<Audit>[1][] = [];
  const store: AssistantSettingsStore = {
    read: () => {
      order.push('read');
      return Promise.resolve(stored);
    },
    write: (_tx, _tenant, settings) => {
      writes.push(settings);
      return Promise.resolve();
    },
  };
  const audit: Audit = (_tx, event) => {
    events.push(event);
    return Promise.resolve();
  };
  const lock = (): Promise<void> => {
    order.push('lock');
    return Promise.resolve();
  };
  return { order, writes, events, deps: { store, audit, lock, now: () => NOW } };
}

describe('putAssistantSettings under concurrency', () => {
  it('takes the tenant lock before it reads what it compares and replaces', async () => {
    const { order, deps } = setup(ASSISTANT_SETTING_DEFAULTS);
    await putAssistantSettings(deps, TX, {
      tenantId: 'tenant',
      settings: { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
      ...ACTOR,
    });
    expect(order).toEqual(['lock', 'read']);
  });
});

describe('putAssistantSettings', () => {
  it('stores the document and audits each changed setting as before and after', async () => {
    const { writes, events, deps } = setup(ASSISTANT_SETTING_DEFAULTS);
    const next = {
      ...ASSISTANT_SETTING_DEFAULTS,
      assistant_default_mode: 'act' as const,
      assistant_trace_retention_days: 7,
    };
    const result = await putAssistantSettings(deps, TX, {
      tenantId: 'tenant',
      settings: next,
      ...ACTOR,
    });
    expect(result).toEqual({ kind: 'stored', settings: next, etag: etagOf(next) });
    expect(writes).toEqual([next]);
    expect(events).toEqual([
      {
        action: 'assistant.config',
        resourceType: 'assistant_settings',
        resourceId: 'tenant',
        outcome: 'allowed',
        ...ACTOR,
        detail: {
          assistant_default_mode: { before: 'ask', after: 'act' },
          assistant_trace_retention_days: { before: 30, after: 7 },
        },
      },
    ]);
  });

  it('writes and audits nothing for a save that changes nothing', async () => {
    const { writes, events, deps } = setup(ASSISTANT_SETTING_DEFAULTS);
    const result = await putAssistantSettings(deps, TX, {
      tenantId: 'tenant',
      settings: ASSISTANT_SETTING_DEFAULTS,
      ...ACTOR,
    });
    expect(result.kind).toBe('stored');
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });

  it('refuses a save over a version it did not read, and writes nothing', async () => {
    const { writes, events, deps } = setup(ASSISTANT_SETTING_DEFAULTS);
    const result = await putAssistantSettings(deps, TX, {
      tenantId: 'tenant',
      settings: { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
      ifMatch: '"stale"',
      ...ACTOR,
    });
    expect(result).toEqual({ kind: 'precondition_failed' });
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
  });

  it('saves over the version it read', async () => {
    const { writes, deps } = setup(ASSISTANT_SETTING_DEFAULTS);
    const result = await putAssistantSettings(deps, TX, {
      tenantId: 'tenant',
      settings: { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: false },
      ifMatch: etagOf(ASSISTANT_SETTING_DEFAULTS),
      ...ACTOR,
    });
    expect(result.kind).toBe('stored');
    expect(writes).toHaveLength(1);
  });
});
