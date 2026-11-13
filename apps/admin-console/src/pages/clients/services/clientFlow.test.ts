import { describe, expect, it } from 'vitest';
import { AUTO } from '#/pages/clients/services/choices';
import {
  flowChoices,
  FLOW_LABEL,
  FLOW_RULE,
  TENANT_DEFAULT,
} from '#/pages/clients/services/clientFlow';

const FLOWS = [
  { id: 'f-1', name: 'default', is_default: true },
  { id: 'f-2', name: 'staff', is_default: false },
];

describe('flowChoices', () => {
  it('offers the tenant default first, then each flow by name with the current default marked', () => {
    expect(flowChoices(FLOWS, null)).toEqual([
      { id: AUTO, label: TENANT_DEFAULT },
      { id: 'f-1', label: 'default (the current default)' },
      { id: 'f-2', label: 'staff' },
    ]);
  });

  it('keeps the flow a client already names choosable while the list is not read', () => {
    expect(flowChoices(undefined, null)).toEqual([{ id: AUTO, label: TENANT_DEFAULT }]);
    expect(flowChoices(undefined, 'f-9')).toEqual([
      { id: AUTO, label: TENANT_DEFAULT },
      { id: 'f-9', label: 'f-9' },
    ]);
  });

  it('does not offer the current flow twice', () => {
    expect(flowChoices(FLOWS, 'f-2').map((choice) => choice.id)).toEqual([AUTO, 'f-1', 'f-2']);
  });
});

describe('the words', () => {
  it('name the setting and say what the tenant default is', () => {
    expect(FLOW_LABEL).toBe('Sign-in flow');
    expect(FLOW_RULE).toMatch(/Tenant default/u);
  });
});
