import { describe, expect, it } from 'vitest';
import {
  actingInOf,
  assistantView,
  conversationFor,
  mayUseAssistant,
} from '#/entities/assistant/services/gate';
import type { AssistantStatus } from '#/entities/assistant/types/assistant';
import type { Authority } from '#/shared/lib/services/principal';

const ON: AssistantStatus = {
  enabled: true,
  slots: { fast: 'f', standard: 's', deep: 'd' },
  modes: ['ask'],
  defaultMode: 'ask',
  modelChoices: ['s'],
  provider: { kind: 'anthropic' },
};

function authority(over: Partial<Authority>): Authority {
  return { capabilities: ['use-assistant'], crossTenant: false, assistantAvailable: true, ...over };
}

it('opens the gate only for a deployment with an assistant and a caller who may use it', () => {
  expect(mayUseAssistant(authority({}))).toBe(true);
  expect(mayUseAssistant(authority({ assistantAvailable: false }))).toBe(false);
  expect(mayUseAssistant(authority({ capabilities: ['read-assistant-activity'] }))).toBe(false);
  expect(mayUseAssistant(undefined)).toBe(false);
});

describe('a system administrator in another tenant', () => {
  const both = authority({ crossTenant: true, capabilities: ['use-assistant', 'manage-tenants'] });

  it('has the assistant when they hold use-assistant and manage-tenants', () => {
    expect(mayUseAssistant(both)).toBe(true);
  });

  it('has none without manage-tenants, or without use-assistant', () => {
    expect(mayUseAssistant(authority({ crossTenant: true }))).toBe(false);
    expect(
      mayUseAssistant(authority({ crossTenant: true, capabilities: ['manage-tenants'] })),
    ).toBe(false);
  });

  it('has none where the deployment has no assistant', () => {
    expect(mayUseAssistant({ ...both, assistantAvailable: false })).toBe(false);
  });

  it('is said to act in the tenant of the address, and nobody else is', () => {
    expect(actingInOf(both, 'demo')).toBe('demo');
    expect(actingInOf(authority({}), 'demo')).toBeNull();
    expect(actingInOf(undefined, 'demo')).toBeNull();
  });

  it('needs manage-tenants only across tenants', () => {
    expect(mayUseAssistant(authority({ capabilities: ['use-assistant'] }))).toBe(true);
  });
});

it('treats a deployment whoami did not describe as having no assistant', () => {
  expect(mayUseAssistant({ capabilities: ['use-assistant'], crossTenant: false })).toBe(false);
});

it('reports slots, modes and provider only for an assistant that is on', () => {
  expect(assistantView(true, ON)).toEqual({
    enabled: true,
    slots: ON.slots,
    modes: ['ask'],
    defaultMode: 'ask',
    modelChoices: ['s'],
    provider: { kind: 'anthropic' },
  });
  expect(assistantView(true, { enabled: false })).toEqual({ enabled: false });
  expect(assistantView(true, undefined)).toEqual({ enabled: false });
});

it('reports an assistant that is on as off while the gate is shut', () => {
  expect(assistantView(false, ON)).toEqual({ enabled: false });
});

it('offers the remembered conversation only in the tenant it was made in', () => {
  expect(conversationFor({ tenant: 'acme', id: 'c1' }, 'acme')).toBe('c1');
  expect(conversationFor({ tenant: 'acme', id: 'c1' }, 'other')).toBeNull();
  expect(conversationFor(null, 'acme')).toBeNull();
});
