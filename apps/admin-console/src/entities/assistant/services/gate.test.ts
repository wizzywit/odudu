import { expect, it } from 'vitest';
import { assistantView, mayUseAssistant } from '#/entities/assistant/services/gate';
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
