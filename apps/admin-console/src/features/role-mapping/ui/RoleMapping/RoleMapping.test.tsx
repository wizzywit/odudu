import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RoleMapping } from '#/features/role-mapping/ui/RoleMapping';
import type { RoleMappingModel } from '#/features/role-mapping/use-cases/useRoleMapping';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { pickerState } from '#/testing/pickerState';

function save(): RoleMappingModel['save'] {
  return {
    status: 'idle',
    fieldErrors: {},
    refusals: {},
    conflicts: [],
    conflictSource: 'changed',
    blocked: undefined,
    reread: vi.fn(),
    keepMine: vi.fn(),
    takeTheirs: vi.fn(),
    values: { role_ids: [] },
    changed: [],
    dirty: false,
    saving: false,
    restored: false,
    message: null,
    edit: vi.fn(),
    discard: vi.fn(),
    submit: () => true,
  };
}

function view(overrides: Partial<RoleMappingModel> = {}, empty?: string) {
  const mapping: RoleMappingModel = {
    save: save(),
    offered: true,
    picker: pickerState([]),
    unavailableOf: () => null,
    choose: vi.fn(),
    mapped: [],
    kept: [],
    ...overrides,
  };
  return (
    <RoleMapping
      name="billing"
      description="A token granted billing carries these roles' claims."
      empty={empty}
      mapping={mapping}
      save={mapping.save}
    >
      <p>what only one side adds</p>
    </RoleMapping>
  );
}

it('says what the section is for, and what is mapped when nothing is', () => {
  render(view());
  expect(screen.getByText("A token granted billing carries these roles' claims.")).toBeVisible();
  expect(screen.getByText('billing carries no role.')).toBeVisible();
});

it('says its own words for an empty mapping, and shows what a side adds', () => {
  render(view({}, 'No roles mapped.'));
  expect(screen.getByText('No roles mapped.')).toBeVisible();
  expect(screen.getByText('what only one side adds')).toBeVisible();
});

it('says it is checking until the picker is offered', () => {
  render(view({ offered: false }));
  expect(screen.getByText('Checking what you may give or take here…')).toBeVisible();
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('explains a role that stays, only when there is one', () => {
  const { rerender } = render(view());
  expect(screen.queryByText(/cannot take away either/u)).toBeNull();
  rerender(view({ kept: ['r-keys'] }));
  expect(screen.getByText(/cannot take away either/u)).toBeVisible();
});

it('puts what follows the picker before the kept-roles note, and children after it', () => {
  const mapping: RoleMappingModel = {
    save: save(),
    offered: false,
    picker: pickerState([]),
    unavailableOf: () => null,
    choose: vi.fn(),
    mapped: [],
    kept: ['r-keys'],
  };
  render(
    <RoleMapping
      name="billing"
      description="d"
      mapping={mapping}
      save={mapping.save}
      afterPicker={<p>after the picker</p>}
    >
      <p>at the end</p>
    </RoleMapping>,
  );
  const order = [
    'Checking what you may give or take here…',
    'after the picker',
    /cannot take away either/u,
    'at the end',
  ].map((text) => screen.getByText(text));
  for (let i = 1; i < order.length; i += 1) {
    expect(order[i - 1]?.compareDocumentPosition(order[i] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => view({ offered: false }))).toEqual({ light: [], dark: [] });
});
